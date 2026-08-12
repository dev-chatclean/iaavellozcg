# 12 — Linha de Base (comportamento verificado antes da refatoração)

Executado em **2026-08-11**, no commit `2a95c43`, **antes de qualquer alteração em código de
produção**. Este documento é a referência de "não quebrou": ao final de cada fatia, o mesmo roteiro é
re-executado e o resultado precisa bater.

## Como reproduzir

```bash
bash test/baseline/coletar-baseline.sh <rotulo>
# gera test/baseline/<rotulo>-requisicoes.log e <rotulo>-servidor.log
diff test/baseline/antes-da-refatoracao-requisicoes.log test/baseline/<rotulo>-requisicoes.log
```

**Ambiente controlado — nenhum efeito externo:**
`CC_PUSH_URL` vazio (nenhuma mensagem sai), `REDIS_URL` vazio (estado em memória),
`OPENAI_API_KEY` falsa (nenhum crédito gasto; as chamadas falham de propósito e exercitam o caminho de
fallback), `ADMIN_KEY=chave-baseline`, `PORT=3999`, `AGRUPAR_MENSAGENS_MS=200`.

## Boot

O processo **sobe normalmente** com push e Redis ausentes — só emite avisos:

```
IA Avelloz Campina - Realliza Motos — VIA CHATCLEAN (Webhook + Push)
Servidor rodando na porta 3999
CC_PUSH_URL nao configurado — a IA nao conseguira responder.
EQUIPE_NUMERO nao configurado — resumo de lead so ira como nota interna.
WEBHOOK_SECRET vazio — /webhook esta ABERTO.
Estado das conversas: memoria
```

Confirma D-23 (configuração não é validada) e D-18 (a degradação para memória é apenas mais um aviso
entre outros, não um alarme).

## Endpoints

| Requisição | Resposta | Confere com |
|---|---|---|
| `GET /health` | `200 {"status":"ok","uptime":...,"timestamp":...}` | RF-060 |
| `GET /diag` (sem chave) | `401 {"erro":"não autorizado"}` | RF-061 |
| `GET /diag?key=errada` | `401` | RF-061 |
| `GET /diag?key=<válida>` | `200` com expediente, redis, push, pipeline | RF-061 |
| `GET /leads?key=<válida>` | `200 {"total":0,"ativos":[]}` | RF-062 |
| `GET /webhook` | `200 {"status":"ok"}` | RF-001 |
| `GET /webhook/<qualquer>` | `200 {"status":"ok"}` | RF-001 |
| `POST /webhook` (qualquer corpo) | **sempre** `200 {"status":"ok"}` | RF-001, **D-27** |

Corpo real do `/diag` na baseline:
```json
{"ok":true,"expediente":{"aberto":true,"motivo":null,"proximoExpediente":null},
 "resetInatividadeHoras":24,"redis":false,"pushConfigurado":false,"equipeNumero":false,
 "pipeline":{"configurado":false,"pushUrlOk":false,"stepId":5,"stepNome":"REUNIÃO MARCADA",
 "userIdSet":false,"responsibleIdSet":false,"oppNome":"REUNIÃO MARCADA","valor":1,"enabled":"(auto)"}}
```

ATENÇÃO: **`/diag` expõe "REUNIÃO MARCADA"** — nomenclatura do projeto `iachatclean` vazando num
endpoint administrativo do cliente Avelloz. Confirma D-05; sai com a spec 0007.

## Payloads aceitos, atendimento criado

| Cenário | Origem do número | `chatId` resultante |
|---|---|---|
| Aninhado com `SenderAlt` e sufixo de dispositivo | `"558491756446:24@s.whatsapp.net"` | `558491756446` — o `:24` é corretamente descartado |
| Aninhado sem `SenderAlt` | `contact.number` | `5583988887777` |
| WABA | `message.raw.from` | `5583977776666` |
| Formato plano | `body.number` | `5583966665555` |

`GET /leads` após o tráfego confirmou os 4 atendimentos:
```json
{"total":4,"ativos":[
 {"chatId":"558491756446","nome":"Joao Baseline","finalizado":false},
 {"chatId":"5583988887777","nome":"Maria","finalizado":false},
 {"chatId":"5583977776666","nome":"Pedro","finalizado":false},
 {"chatId":"5583966665555","nome":"Ana","finalizado":false}]}
```

Note a **ausência do campo `empresa`** na resposta: o código o inclui (`l.empresa`), mas ele é sempre
`undefined` e some na serialização. Confirma D-22.

## Payloads descartados (comportamento correto)

| Cenário | Log observado |
|---|---|
| `fromMe: true` | *(silencioso — nenhum log)* |
| Grupo por `ticket.isGroup` | `Mensagem de grupo ignorada` |
| Grupo por JID `@g.us` em `raw.Info.Chat` | `Mensagem de grupo ignorada` |
| Ticket `open` **com `userId`** | `Ticket "open" (aceito/atendido por humano) — IA nao responde` |
| Ticket `closed` | `Ticket "closed" ... — IA nao responde` |
| `{numero_cliente, mensagem_cliente}` | `Ignorando disparo duplicado (formato numero_cliente)` |
| Payload desconhecido | `Payload nao reconhecido: {...` |
| `msgId` repetido (`MSG-A2`) | `Mensagem duplicada (MSG-A2) ignorada` |

Confirma RN-050, RN-051, RN-052, RN-055. Ticket `open` **sem** `userId` **é atendido** (o caso WABA
acima) — RN-052 está correta.

ATENÇÃO: o `fromMe` é descartado em silêncio absoluto, sem nenhum log. Se um dia o bot parar de
responder por má detecção de `fromMe`, não haverá rastro. Insumo para o log estruturado (D-20).

## Ordem real de execução (achado útil)

O log mostra `Webhook de 5583988887777 [text]: "oi de novo"` **antes** de
`Mensagem duplicada (MSG-A2) ignorada` — ou seja, **o log de recebimento acontece antes da
deduplicação**. Idem para o sticker: é logado como recebido (`[sticker]`) e só depois cai no fallback
de tipo não suportado.

Consequência prática: contar as linhas de "Webhook de" no log **superestima** as mensagens
efetivamente processadas. Qualquer métrica construída sobre esse log hoje está errada.

## Caminho de falha da OpenAI (exercitado de propósito)

Com chave inválida, cada turno produz:
```
Erro ao extrair informacoes: 401 Incorrect API key provided: sk-basel*****alsa.
Erro ao gerar resposta IA para <chatId>: 401 Incorrect API key provided: ...
CC_PUSH_URL nao configurado no .env — envio ignorado
```

Comportamento confirmado (RF-006): a extração falha e retorna `null` **sem derrubar o turno**; a
geração falha e o sistema tenta enviar a mensagem de instabilidade; **o estado é preservado** (o
atendimento aparece em `/leads`).

ATENÇÃO: a chave da OpenAI aparece parcialmente mascarada (`sk-basel*****alsa`) — a máscara é do
provedor, não nossa. Com outra mensagem de erro, o segredo poderia vazar inteiro no log. Insumo
para S1.

## PII no log (S1 confirmado na prática)

O log de payload bruto imprimiu **13 payloads completos**, incluindo nome do contato, telefone e
conteúdo integral da mensagem. Numa conversa real, esse mesmo log conteria CPF, data de nascimento
e CNH.

## O que esta baseline NÃO cobre

Ficou de fora por exigir chave real da OpenAI (custo). Será coberto pelo teste dourado (PR6) com
adapters falsos e pelos evals da spec 0011:

- Conteúdo das respostas geradas e o bloqueio de diagnóstico (RN-001)
- Extração de campos e avanço do funil
- Transbordo, resumo e roteamento por loja
- Transcrição de áudio/vídeo e visão
- Reativação (30 min) e reset (24h)
- Blindagem anti-loop e rate-limit sob carga

## Determinismo da coleta (aprendizado da Fase 0)

A primeira versão deste roteiro era **instável**: `GET /leads` às vezes devolvia 3 atendimentos, às
vezes 4, e o lead ausente mudava a cada execução. Investigação (6 execuções no código atual e 6 no
commit original `255c13b`) mostrou que **o comportamento já era assim antes de qualquer alteração** —
não era regressão.

Causa: o estado do atendimento só é persistido no `finally`, ao fim do turno, **depois** das chamadas
à OpenAI. Como nesta coleta essas chamadas vão de verdade à rede (e voltam 401), a duração do turno
varia com a latência. Se `/leads` for consultado antes de o turno terminar, o atendimento ainda não
existe. Ver D-16.

Duas correções foram aplicadas ao roteiro:

1. A espera de drenagem passou de 3s para **10s**.
2. A listagem de `/leads` é **ordenada por `chatId`** antes de gravar, porque a ordem natural depende
   de qual turno terminou primeiro.
3. O campo `expediente` do `/diag` é **normalizado**: ele reflete a hora em que a coleta rodou.
   Coletar às 10h e às 20h da mesma terça produzia diff sem nenhuma regressão por trás.

Com isso, três execuções seguidas produzem arquivos byte a byte idênticos. **Se o diff acusar
diferença, é regressão de verdade** — foi esse o ponto de todo o exercício.

## Critério de regressão

Ao final de cada fatia:

1. `bash test/baseline/coletar-baseline.sh depois-fase-N`
2. `diff` contra `antes-da-refatoracao-requisicoes.log` — divergência só é aceitável se estiver
   **escrita na spec** da fatia.
3. `npm test` verde.
