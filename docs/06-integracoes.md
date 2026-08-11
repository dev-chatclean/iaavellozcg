# 06 — Integrações Externas

## Mapa

| Sistema | Direção | Protocolo | Criticidade | Se cair… |
|---|---|---|---|---|
| ChatClean — Webhook | entrada | HTTP POST | 🔴 Crítica | Nenhuma mensagem chega |
| ChatClean — Push API | saída | HTTP POST | 🔴 Crítica | O bot não fala |
| ChatClean — Oportunidades | saída | HTTP POST | ⚪ Inerte | Nada (não é chamado) |
| OpenAI Chat Completions | saída | HTTPS/SDK | 🔴 Crítica | Fallback de instabilidade |
| OpenAI Whisper | saída | HTTPS/axios | 🟡 Média | Bot pede texto |
| OpenAI Vision | saída | HTTPS/SDK | 🟢 Baixa | Registra "enviou uma imagem" |
| Redis | saída | TCP | 🟡 Média | Degrada silenciosamente para memória |

---

## 1. ChatClean — Webhook de entrada

**Endpoint:** `POST /webhook` ou `POST /webhook/<secret>`
**Autenticação:** header `x-webhook-token` / `Authorization: Bearer`, query `?token=` ou path.
Comparação com `crypto.timingSafeEqual`. **Com `WEBHOOK_SECRET` vazio, aceita qualquer requisição.**
**Resposta:** `200 {status:'ok'}` **antes** do processamento (evita retry do provedor).
Consequência: falha de processamento é invisível para o ChatClean — o erro só existe no log local.

### Formatos aceitos (o parser suporta três — origem do ACL)

**A) Aninhado (WhatsApp Web / whatsmeow)**
```jsonc
{
  "contact": { "id": 123, "name": "João", "number": "5583999998888" },
  "ticket":  { "status": "pending", "userId": null, "isGroup": false, "contactId": 123 },
  "message": {
    "id": "3EB0…", "body": "quanto custa a AZ1?", "type": "chat", "fromMe": false,
    "mediaUrl": null, "mimetype": null,
    "quotedMsg": { "body": "…" },
    "raw": { "Info": { "SenderAlt": "558494610845@s.whatsapp.net", "PushName": "João", "IsGroup": false, "Chat": "…@s.whatsapp.net" } }
  }
}
```
**B) WABA (WhatsApp Oficial)** — igual, mas o remetente vem em `message.raw.from` (não há `SenderAlt`).
**C) Plano (n8n / webhook simples)** — `{ number, body, type, contactName, id, contactId, mediaUrl, mimetype, quotedText, fromMe, isGroup }`.
**D) `{ numero_cliente, mensagem_cliente }`** — disparo duplicado do ChatBot, **ignorado de propósito**.

### Campos derivados

| Campo | Origem (em ordem de precedência) |
|---|---|
| `chatId` | `contact.number` → `contact.phone` → `body.number` → `raw.Info.SenderAlt` → `raw.from` → `message.number`, normalizado (só dígitos, sem sufixo `:device@server`) |
| `contactId` | `message.contactId` → `contact.id` → `ticket.contactId` → `body.contactId` |
| `tipo` | `message.type` / `mediaType`, normalizado (`chat`/`''` → `text`) |
| `nomeContato` | `contact.name` → `raw.Info.PushName` → `body.contactName` |

### Filtros aplicados no parse (curto-circuito)
`fromMe` · grupo (`ticket.isGroup`, `raw.Info.IsGroup`, JID com `@g.us`) · ticket com `userId`
atribuído ou `closed` (RN-052).

### Armadilhas conhecidas
- O número real **não** está sempre em `contact.number`; em alguns fluxos só existe em
  `raw.Info.SenderAlt` — daí a cadeia de fallbacks.
- Sufixo de dispositivo (`:24`) precisa ser cortado **antes** de remover não-dígitos, senão o `24`
  gruda no telefone.
- O 9º dígito de celular varia entre payloads — comparações usam o núcleo canônico.
- Nenhum schema é validado: campo faltante vira `undefined` silencioso.

---

## 2. ChatClean — Push API (saída)

```
POST {CC_PUSH_URL}          # https://host/v1/api/external/{uuid}/?token=JWT
Content-Type: application/json
{ "number": "5583999998888", "body": "texto", "externalKey": "<uuid v4>" }
```

Variação para **nota interna** no ticket: `{ ..., "onlyNote": true, "note": { "body": "…" } }`.

- Timeout 30s, **sem retry**, sem backoff, sem circuit breaker.
- Falha ⇒ `console.error` e `false`. O cliente simplesmente não recebe a mensagem.
- ⚠️ **A `CC_PUSH_URL` é regenerada quando a sessão de WhatsApp reconecta** no painel ChatClean.
  Depois de reconectar, é preciso atualizar a variável — hoje sem alerta automático.
- `externalKey` (UUID) dá idempotência do lado do ChatClean.

---

## 3. ChatClean — Oportunidades (`pipeline.js`) — **inerte**

```
POST {base}/opportunities?token={JWT}
{ name, contactId, pipelineStepId, userId, responsibleId, value, description }
```

`base` e `token` são derivados da própria `CC_PUSH_URL`. Contrato obtido por engenharia reversa
(2026-08-05): `pipelineStepId` já define o funil; a API externa não tem `DELETE`; `PUT` edita.

**Status:** `criarOportunidade()` **nunca é chamado no código**. Só `diag()` aparece em `/diag`.
Os comentários ainda descrevem "REUNIÃO MARCADA" e "responsável Roni" — herança do projeto
`iachatclean`. Decisão pendente na spec `0007`.

---

## 4. OpenAI

| Uso | Modelo | Via | Parâmetros |
|---|---|---|---|
| Extração | `gpt-4o-mini` | SDK | `temperature: 0`, `response_format: json_object`, histórico[-4] |
| Resposta | `gpt-4o-mini` | SDK | `temperature: 0.7`, system `SYSTEM_SDR`, histórico[-10] |
| Pós-transbordo | `gpt-4o-mini` | SDK | `temperature: 0.6`, system curto próprio |
| Visão | `gpt-4o` | SDK | `temperature: 0.3`, `max_tokens: 300`, `image_url` = `mediaUrl` |
| Transcrição | `whisper-1` | **axios + form-data** | multipart; áudio `.ogg`, vídeo `.mp4` |

**Observações**
- A transcrição **não** usa o SDK — monta multipart na mão e passa `Authorization` manualmente.
  Padronizar no SDK é fatia da refatoração.
- Não há retry, backoff nem tratamento de `429`/`Retry-After`.
- Não há orçamento nem limite de gasto por conversa. `sim-lead.js` estima o custo (US$ 0,15/1M
  entrada + US$ 0,60/1M saída) — os únicos números de custo do projeto.
- `SYSTEM_SDR` é byte-idêntico entre chamadas: bom para prompt caching, **preserve essa propriedade**.
- A visão recebe a `mediaUrl` **crua vinda do webhook**, sem validação de host (risco S7). Se a URL
  exigir autenticação, a chamada falha.

---

## 5. Redis

| Chave | Tipo | TTL | Uso |
|---|---|---|---|
| `avellozcg:lead:<chatId>` | string (JSON) | 30 dias | Estado do atendimento |
| `avellozcg:leads` | list | **nenhum** | Histórico append-only de leads qualificados |
| `avellozcg:lock:<chatId>` | string | 60s (`PX`) | Lock de processamento distribuído |

- Prefixo configurável por `REDIS_PREFIX` (padrão `avellozcg`).
- **Sem `REDIS_URL`, o sistema cai para `Map` em memória sem alarme** — o estado some no restart.
- Todas as operações são fail-safe: erro de Redis ⇒ log + fallback para memória. O lock é
  **fail-open** (erro ⇒ deixa processar), decisão deliberada para não travar o atendimento.
- `scanLeadIds()` faz `SCAN MATCH prefixo* COUNT 200` — usado pelo varredor de follow-up a cada 2 min.

---

## Resiliência: situação atual × alvo

| Aspecto | Hoje | Alvo |
|---|---|---|
| Retry | Nenhum | Backoff exponencial + jitter (OpenAI, Push) |
| Timeout | 30s push, 60s vídeo, 30s áudio, padrão SDK no chat | Explícito e por operação |
| Circuit breaker | Não existe | Por dependência |
| Idempotência | `msgId` em `Set` na memória | Chave no Redis com TTL |
| Fallback | Mensagem de instabilidade | Idem + fila de retentativa |
| Alerta | `console.error` | Log estruturado + métrica + alerta |
| Degradação Redis | Silenciosa | Alarme explícito no `/diag` e no boot |
