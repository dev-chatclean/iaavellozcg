# 07 — Estado e Persistência

## O objeto `leadData` (estado do atendimento)

Não existe schema declarado — o formato emerge do uso. Reconstruído a partir do código:

```jsonc
{
  // Identidade
  "nome": "João",                    // primeiro nome (do contato ou extraído)
  "contactId": 123,                  // id do contato no CRM ChatClean

  // Funil de qualificação (flow.js: CAMPOS) — ordem oficial
  "finalidade":      "app",          // trabalho | app | economia | passeio | esposa | outros
  "transporteAtual": "moto alugada",
  "gastoMensal":     "250 por semana de aluguel",
  "situacaoMoto":    "alugada",
  "modeloInteresse": "AZ125",        // AZ1 | AZ125 | AZX160  (mutável)
  "formaPagamento":  "financiamento",// cartao | financiamento | consorcio | avista (mutável)
  "loja":            "Malvinas",     // Matriz | Malvinas | Monteiro (mutável)

  // Dados de simulação (flow.js: CAMPOS_EXTRAS) — coletados em bloco
  "nomeCompleto": "João da Silva",
  "cpf": "12345678900",              // ATENÇÃO: PII em claro
  "dataNascimento": "10/05/1995",    // ATENÇÃO: PII
  "telefone": "83999998888",
  "cnh": "sim",                      // (mutável)
  "corModelo": "AZ125 vermelha",     // (mutável)

  // Classificação
  "perfilKey": "app_aluga",          // um dos 8 perfis
  "tipoContato": "lead",             // lead | cliente | outros

  // Sinais TRANSITÓRIOS (valem só para a resposta do turno; zerados a cada turno)
  "objecaoAtiva": null,
  "perguntouAgora": null,
  "analiseImagem": null,

  // Controle de fluxo
  "qualificacaoCompleta": false,     // ATENÇÃO: setado por determinarProximoCampo (efeito colateral)
  "finalizado": false,               // transbordo executado

  // Histórico (máx. 100 entradas)
  "conversationHistory": [ { "role": "user|assistant", "content": "…" } ],

  // Temporal
  "ultimaInteracao": 1754900000000,  // epoch ms — base do reset de 24h
  "followUpDueAt": 1754901800000,    // epoch ms — vencimento da reativação (null = sem pendência)
  "followUpUltimo": "Oi João, ainda por aí? …",  // anti-repetição da reativação

  // Blindagem anti-loop
  "turnosTs": [1754900000000],       // timestamps na janela de 3 min
  "ultimasMsgs": ["oi", "quanto custa"], // últimas 6 mensagens normalizadas
  "loopAvisado": false               // equipe já foi avisada nesta ocorrência
}
```

### Problemas do modelo atual

| # | Problema |
|---|---|
| 1 | **Sem schema nem versão.** Mudar um campo quebra os estados já gravados no Redis, sem migração. |
| 2 | **Sem separação de responsabilidades.** Identidade, funil, PII, histórico, controle de loop e agendamento no mesmo objeto plano. |
| 3 | **Sinais transitórios persistidos.** `objecaoAtiva`, `perguntouAgora`, `analiseImagem` vão para o Redis mesmo valendo só um turno. |
| 4 | **Primitive obsession.** Tudo string; CPF, dinheiro e telefone sem tipo. |
| 5 | **Campo fantasma.** `/leads` expõe `l.empresa`, que **não existe** no domínio Avelloz — resquício do projeto `iachatclean`. |
| 6 | **Estado implícito.** Não há campo de estado; ele é inferido de `qualificacaoCompleta` + `finalizado` + campos vazios. |
| 7 | **Histórico serializado inteiro a cada turno.** Até 100 turnos de JSON reescritos no Redis por mensagem. |
| 8 | **PII em claro**, sem criptografia nem mascaramento (RN-091). |

---

## Chaves no Redis

| Chave | Tipo | TTL | Escrita | Leitura |
|---|---|---|---|---|
| `avellozcg:lead:<chatId>` | string JSON | 30 dias | fim de cada turno | início de cada turno, varredor |
| `avellozcg:leads` | list | **nenhum** ATENÇÃO: | a cada transbordo | ninguém (nem `/leads` lê!) |
| `avellozcg:lock:<chatId>` | string | 60s | início do turno | — |

Notas:
- O TTL de 30 dias é renovado a cada `saveLead` — conversas ativas não expiram.
- `avellozcg:leads` cresce indefinidamente e **não é lido por nenhum endpoint**: `/leads` lista os
  atendimentos ativos via `scanLeadIds`, não o histórico. É write-only na prática (dívida D-21).
- O lock é fail-open: erro de Redis ⇒ processa mesmo assim (decisão deliberada, evita travar o
  atendimento por instabilidade de infra).

---

## Estado que NÃO é persistido (some no restart, quebra em multi-instância)

| Estrutura | Onde | Consequência de perder | Consequência com 2+ instâncias |
|---|---|---|---|
| `processandoMensagem` | `index.js` | Lock local liberado | Coberto pelo lock Redis |
| `filaPorChat` | `index.js` | **Mensagens em fila são perdidas** | Fila fragmentada por instância |
| `debounceTimers` | `index.js` | Agrupamento pendente perdido | Agrupamento quebrado |
| `mensagensProcessadas` | `index.js` | Dedup zerado ⇒ possível resposta duplicada | **Dedup não funciona** |
| `rateHits` | `index.js` | Rate-limit zerado | **Limite multiplicado pelo nº de instâncias** |
| `setInterval` follow-up | `index.js` | — | **Follow-up disparado N vezes** |
| `mem` / `memLeads` | `store.js` | **Todo o estado**, quando não há Redis | Estados divergentes por instância |

Conclusão: **o sistema hoje só é seguro rodando em uma única instância.** Escalar horizontalmente
exige mover essas estruturas para o Redis — Fase 8 do plano.

---

## Ciclo de vida do estado

```
   mensagem nova
        │
        ├─ não existe estado ────────────────> cria { conversationHistory: [] }
        ├─ existe e ultimaInteracao > 24h ───> DELETE + cria novo         (RN-071)
        └─ existe e recente ─────────────────> carrega
                                                   │
                       ┌───────────────────────────┤
                       │                           │
              turno processado             30 min sem interação
                       │                           │
              saveLead (TTL 30d)          follow-up de reativação (RN-070)
                       │
              transbordo ⇒ finalizado = true + rpush em avellozcg:leads
                       │
              30 dias sem escrita ⇒ expira sozinho (TTL)
```

---

## Modelo alvo

```
Repositorio de Atendimento (porta)
  ├── RedisAtendimentoRepository     ← produção
  ├── MemoriaAtendimentoRepository   ← dev/teste (explícito, NÃO fallback silencioso)
  └── (mesma suíte de teste de contrato roda nos dois)

Persistência:
  · Schema versionado (`schemaVersion`) + migração na leitura
  · Serialização explícita (Atendimento ⇄ DTO), não JSON.stringify do objeto vivo
  · Sinais transitórios NÃO persistidos
  · PII criptografada em repouso ou tokenizada
  · Histórico em chave separada (lista com trim), não reescrito inteiro a cada turno
  · Idempotência (`msgId`), rate-limit e fila movidos para o Redis
  · TTL na lista de leads + rota de expurgo por titular (LGPD, RN-092)
```
