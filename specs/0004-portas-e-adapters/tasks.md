# TASKS 0004 — Portas e adapters

Execução da [SPEC 0004](spec.md) conforme o [PLAN 0004](plan.md).

## Preparação
- [x] T01 — Revisar o escopo: retirar os critérios que mudavam comportamento (D-18, S7)
- [x] T02 — Confirmar suíte verde (320 testes) antes de começar

## Portas e adapters
- [x] T03 — `src/application/portas/index.js`: contratos das 10 portas
- [x] T04 — `RelogioDoSistema` e `RelogioDeExpedienteLocal`
- [x] T05 — `CanalChatClean` (canal + notificador)
- [x] T06 — `RepositorioRedis` e `RepositorioMemoria`
- [x] T07 — `ExtratorOpenAI`, `RedatorOpenAI`, `LeitorDeImagemOpenAI`
- [x] T08 — `TranscritorWhisper` pelo SDK (D-26)
- [x] T09 — `BaixadorHttp`
- [x] T10 — `src/main/container.js`

## Ligação com o legado
- [x] T11 — `index.js` consome `deps` em vez de instanciar
- [x] T12 — `usarDependencias` como costura de teste, documentada como temporária
- [x] T13 — Remover imports de `openai`, `axios`, `form-data`, `store`, `horario`, `prompts`
- [x] T14 — Deletar `store.js` e tirá-lo do ratchet do lint

## Testes
- [x] T15 — Reescrever `test/apoio/fakes.js` como fakes de porta
- [x] T16 — Rename mecânico dos handles no teste dourado, sem tocar em asserções
- [x] T17 — `test/contrato/repositorio.test.js` parametrizado por implementação

## Fronteiras
- [x] T18 — Elevar as regras de arquitetura para erro
- [x] T19 — **Verificar com violação proposital** que cada barreira realmente bloqueia
- [x] T20 — Conferir que não há falso positivo (`domain` contém "main")

## Verificação
- [x] T21 — `npm test`: 348 verdes
- [x] T22 — `npm run lint`: 0 erros, 4 avisos
- [x] T23 — Linha de base: requisições idênticas; log com as mesmas linhas
- [x] T24 — Nenhum `require` de infra no `index.js`

## Encerramento
- [x] T25 — `resultado.md`, status no `BACKLOG.md`, dívida atualizada

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
| 2026-08-12 | T19 | **A barreira não barrava.** `no-restricted-imports` só enxerga `import` de ESM; o projeto é CommonJS. A regra existia desde a spec 0001 dando sensação de proteção. Trocada por `no-restricted-syntax` sobre a chamada `require()` e testada com violação proposital. |
| 2026-08-12 | T11 | O aviso de loop à equipe usava `ccPush` dentro de um `catch` mudo. Ao remover o `ccPush`, o erro foi engolido em silêncio e só o teste dourado percebeu — exemplo prático do custo do D-24. |
| 2026-08-12 | T16 | O rename foi validado com um `diff` que normaliza os nomes dos handles: nenhuma outra linha mudou. |
| 2026-08-12 | T23 | O log do servidor tem as mesmas linhas em ordem diferente — turnos de chats distintos são concorrentes e a latência de rede varia. Conferido com `sort`. |
