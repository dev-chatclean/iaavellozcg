# 01 — Arquitetura Atual (as-is)

Retrato fiel do código como ele está hoje. Serve de base para a estrangulação — não é modelo a seguir.

## Inventário de arquivos

| Arquivo | Linhas | Responsabilidades (quantas cabem num arquivo só) |
|---|---:|---|
| `index.js` | 1040 | config por env, servidor Express, autenticação de webhook, parse de payload, dedup, rate-limit, blindagem anti-loop, fila+debounce por chat, lock de processamento, download e transcrição de mídia, visão, chamadas OpenAI, state machine, montagem de resumo, notificação de equipe, transbordo, follow-up de reativação, endpoints admin, bootstrap e shutdown |
| `prompts.js` | 195 | `SYSTEM_SDR` (prompt-mestre) + `promptExtracao()` + `promptResposta()` |
| `data.js` | 178 | empresa, catálogo, pagamento, lojas, perfis, objeções, departamentos, mapeamento loja→departamento |
| `flow.js` | 73 | state machine de qualificação (pura, exceto por um efeito colateral), aplicação de campos, detecção de perfil |
| `store.js` | 124 | estado no Redis + fallback em memória, lock distribuído, histórico de leads |
| `horario.js` | 100 | expediente, feriados, modo plantão |
| `pipeline.js` | 111 | oportunidades no CRM — **desligado e nunca chamado** (só aparece no `/diag`) |
| `test-chat.js` | 116 | REPL de teste local — reimplementa o turno |
| `sim-lead.js` | 140 | simulação de roteiro — reimplementa o turno **de novo** |

## Diagrama de dependências (real)

```
                  ┌──────────────┐
                  │   index.js   │  ← God Object
                  └──────┬───────┘
        ┌────────┬───────┼────────┬─────────┬──────────┐
        ▼        ▼       ▼        ▼         ▼          ▼
     data.js  prompts  flow.js  horario  store.js  pipeline.js
                 │                                  (morto)
                 └── data.js

     test-chat.js ──> prompts, data, flow          (duplica index.js)
     sim-lead.js  ──> prompts, data, flow, horario (duplica index.js)

   externos: express, axios, openai, ioredis, form-data, dotenv, crypto
```

Não há camadas. `index.js` conhece HTTP, OpenAI, Redis, ChatClean e regra de negócio ao mesmo tempo.

## Pipeline de uma mensagem (caminho real do código)

```
POST /webhook  ou  /webhook/:token
  │
  ├─ res.status(200) IMEDIATO (evita retry do ChatClean)  ← resposta antes do processamento
  ├─ webhookAutorizado(req)         .......... WEBHOOK_SECRET vazio ⇒ passa direto
  ├─ console.log('PAYLOAD RAW', …)  .......... loga PII
  ├─ parsePayload(body)             .......... 3 formatos + filtros:
  │     · fromMe               → descarta (eco do próprio bot)
  │     · ehGrupo()            → descarta se IGNORAR_GRUPOS
  │     · deveResponderTicket()→ descarta se humano assumiu (ticket.userId)
  │     · extrai: chatId, contactId, msgId, texto, tipo, mídia, quotedText, nomeContato
  ├─ contatoPermitido(chatId)       .......... allow-list de teste (tolera 9º dígito)
  ├─ dentroDoLimite(chatId)         .......... rate-limit em memória (20/60s)
  ├─ dedup por msgId                .......... Set em memória (máx 500)
  ├─ tipo suportado?                .......... senão pede texto
  └─ enfileirar(parsed)
        ├─ tipo 'text' → debounce AGRUPAR_MS (2s) e agrupa mensagens seguidas
        └─ mídia       → drena imediatamente
             │
             ▼
        drenarFila(chatId) → proximaUnidade(fila) → processarMensagem(unidade)
```

### `processarMensagem` — ordem das decisões

```
 1. lock em memória (processandoMensagem) + timeout de 60s
 2. lock Redis cross-instância (fail-open)
 3. carrega leadData; reset se inativo > RESET_INATIVIDADE_HORAS (24h)
 4. marca ultimaInteracao; cancela follow-up pendente
 5. "/reset" → apaga estado e responde
 6. blindagem anti-loop (turnos na janela + mensagem repetida) → PAUSA
 7. se leadData.finalizado → gerarRespostaPosEncaminhamento e SAI
 8. mídia:
      image    → analisarImagem (gpt-4o visão) → descrição vai pro histórico
      document → acusa recebimento e SAI (encerra o turno)
      video    → baixa + Whisper (mp4) → texto
      audio/ptt→ baixa + Whisper → texto; se falhar, pede texto e SAI
 9. quotedText prefixado ao texto
10. exp = estaEmExpediente()
11. proximoCampoAntes = determinarProximoCampo(leadData)   ← muta o lead (bug de CQS)
12. extrairInformacoesComIA(texto, campo, histórico[-4])   ← gpt-4o-mini, temp 0, json_object
13. aplicarCampos + objecao + perguntou + tipoContato + detectarPerfil
14. desvios:
      tipoContato === 'cliente'  → transbordo Pós-venda e SAI
      querFalarComHumano         → encaminhar() e SAI
15. proximoCampoDepois = determinarProximoCampo(leadData)
16. gerarRespostaIA(...)  ← gpt-4o-mini, temp 0.7, SYSTEM_SDR + histórico[-10] + rodapé dinâmico
      · em erro: mensagem de instabilidade e SAI
17. enviarMensagensQuebradas() → quebra por linha com sleep(900 + len*18)ms
18. histórico atualizado (podado em 100 entradas)
19. se qualificacaoCompleta → notificarEquipe + finalizado = true
    senão                   → agendarFollowUpReativacao (30 min)
20. finally: salva leadData, libera locks
```

## Máquina de estados da qualificação (`flow.js`)

Ordem fixa; o primeiro campo vazio define a próxima "dica" enviada ao modelo:

```
finalidade → transporteAtual → gastoMensal → situacaoMoto
          → modeloInteresse → formaPagamento → loja → [qualificacaoCompleta]
```

Campos extras coletados em bloco, fora da ordem: `nome`, `nomeCompleto`, `cpf`, `dataNascimento`,
`telefone`, `cnh`, `corModelo`.

Campos **mutáveis** (último valor vence): `modeloInteresse`, `formaPagamento`, `loja`, `corModelo`,
`cnh`. Os fatos do diagnóstico, uma vez preenchidos, não são sobrescritos — exceto correção explícita
sinalizada pela extração (`correcao: [...]`).

## Camada de IA

| Uso | Modelo | Temp | Observação |
|---|---|---:|---|
| Extração de campos | `gpt-4o-mini` | 0 | `response_format: json_object`; histórico[-4] |
| Geração de resposta | `gpt-4o-mini` | 0.7 | `SYSTEM_SDR` + histórico[-10] + rodapé dinâmico |
| Pós-transbordo | `gpt-4o-mini` | 0.6 | system curto próprio, sem `SYSTEM_SDR` |
| Visão (imagem) | `gpt-4o` | 0.3 | `max_tokens: 300`, recebe `mediaUrl` direta |
| Transcrição áudio/vídeo | `whisper-1` | — | via `axios` + `form-data`, **não** pelo SDK |

O `SYSTEM_SDR` é estático e monta catálogo/lojas/pagamento a partir do `data.js` — bom para prompt
caching. Todo o estado variável vai no turno do usuário (`promptResposta`).

## Persistência (`store.js`)

- Redis quando `REDIS_URL` existe; **fallback silencioso para `Map` em memória** caso contrário.
- `avellozcg:lead:<chatId>` — JSON do atendimento, TTL 30 dias.
- `avellozcg:leads` — lista append-only de leads qualificados, **sem TTL**.
- `avellozcg:lock:<chatId>` — lock `SET NX PX` de 60s, fail-open.
- `scanLeadIds()` — SCAN por prefixo, usado pelo varredor de follow-up.

## Estado em memória (perde no restart, quebra com múltiplas instâncias)

`processandoMensagem`, `filaPorChat`, `debounceTimers`, `mensagensProcessadas`, `rateHits`,
e o `setInterval` do varredor de follow-up (roda em toda instância).

## Superfície HTTP

| Rota | Auth | Função |
|---|---|---|
| `POST /webhook` · `POST /webhook/:token` | `WEBHOOK_SECRET` (opcional!) | Recebe mensagens |
| `GET /webhook` · `GET /webhook/:token` | — | Ping de validação do painel |
| `GET /health` | — | `{status, uptime, timestamp}` |
| `GET /diag` | `ADMIN_KEY` (fail-closed) | Expediente, Redis, push, pipeline |
| `GET /leads` | `ADMIN_KEY` (fail-closed) | Atendimentos ativos |

## Configuração (21 variáveis de ambiente)

Lidas diretamente por `process.env` espalhado em 4 arquivos, sem validação no boot. Única exceção
tratada: `OPENAI_API_KEY` ausente derruba o processo — mas só **depois** do `listen`.

## Onde vive cada regra de negócio hoje

| Regra | Onde está | Problema |
|---|---|---|
| Bloqueio de diagnóstico | texto do `SYSTEM_SDR` + flag `diagnosticoCompleto` em `promptResposta` | Duplicada em dois lugares, sem teste |
| Ordem do funil | `flow.js` | OK, mas com efeito colateral |
| Preços e catálogo | `data.js` | OK (fonte única) |
| Nunca informar parcela | texto do `SYSTEM_SDR` | Só no prompt; não verificável |
| Loja obrigatória | `flow.js` + prompt + `lojaParaDepartamento` | Espalhada |
| Objeções | `data.js` (`OBJECOES`) + extração + prompt | OK |
| Pós-venda vira Pós-venda | `if` solto no `index.js` com string hardcoded | Regra escondida em código |
| Horário/plantão | `horario.js` | **Diverge** de `EMPRESA_INFO.horarioSuporte` (ver dívida D-19) |
