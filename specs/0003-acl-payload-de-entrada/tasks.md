# TASKS 0003 — Anti-Corruption Layer do payload de entrada

Execução da [SPEC 0003](spec.md) conforme o [PLAN 0003](plan.md).

## Preparação
- [x] T01 — Confirmar suíte verde (294 testes) antes de começar
- [x] T02 — Reler os 50 testes de caracterização: eles são o contrato desta fatia

## Domínio
- [x] T03 — `MotivoDeDescarte.js` com os 7 motivos e suas descrições
- [x] T04 — `MensagemRecebida.js` congelada, com os mesmos nomes de campo do legado

## Infraestrutura
- [x] T05 — `esquemas.js`: contrato dos formatos aninhado, plano e duplicado
- [x] T06 — `classificar()` replicando a ordem de reconhecimento do legado
- [x] T07 — `tradutor.js`: filtros de negócio (eco, grupo, ticket) devolvendo motivo
- [x] T08 — Cadeias de fallback de telefone, contactId, msgId, nome e mídia
- [x] T09 — Tolerância: divergência de esquema registra, não barra

## Integração com o legado
- [x] T10 — `parsePayload` vira casca que injeta políticas e adapta o retorno
- [x] T11 — `ehGrupo`, `ticketStatus` e `deveResponderTicket` viram cascas do ACL
- [x] T12 — Remover as 75 linhas do parse legado e as auxiliares
- [x] T13 — `drenarFila` deixa de mutar o objeto congelado

## Verificação
- [x] T14 — **CA-001**: os 50 testes de caracterização passam sem alteração
- [x] T15 — `tradutor-payload.test.js` cobrindo CA-002 a CA-010
- [x] T16 — `npm test` (320) e `npm run lint` (6 avisos, sem erro)
- [x] T17 — CA-012: linha de base HTTP idêntica
- [x] T18 — Conferir o log do servidor e atualizar a referência

## Encerramento
- [x] T19 — Marcar D-29 como resolvida em `docs/09-divida-tecnica.md`
- [x] T20 — Registrar o progresso parcial do D-01 (index.js: 1040 -> 990 linhas)
- [x] T21 — `resultado.md` e status no `BACKLOG.md`

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
| 2026-08-11 | T13 | `MensagemRecebida` congelada revelou que `drenarFila` mutava o objeto do parse. Em CommonJS não-estrito isso falha em silêncio — o valor já era o correto, então ninguém notaria até uma migração para ESM. |
| 2026-08-11 | T18 | A linha de payload irreconhecível despejava o corpo inteiro no log: mais um vazamento de PII, no espírito do S1. Agora registra só o motivo. |
| 2026-08-11 | T16 | `getTicket` ficou órfão após a delegação; removido (o lint apontou). |
