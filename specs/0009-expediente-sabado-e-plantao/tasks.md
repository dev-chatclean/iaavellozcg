# TASKS 0009 — Expediente aos sábados e plantão que chega à resposta

Execução da [SPEC 0009](spec.md) conforme o [PLAN 0009](plan.md).

## Preparação
- [x] T01 — Confirmar o horário do sábado com o negócio (08h-18h)
- [x] T02 — Verificar que a suíte da Fase 0 está verde antes de começar

## Implementação
- [x] T03 — `horario.js`: substituir `ABRE`/`FECHA` por `EXPEDIENTE_SEMANAL` por dia da semana
- [x] T04 — `horario.js`: `horarioDoDia` e `ehDiaDeExpediente` sobre a tabela
- [x] T05 — `horario.js`: rótulo usa a hora de abertura do dia alvo (não mais constante global)
- [x] T06 — `horario.js`: preposição por gênero do dia ("no sábado" / "na segunda-feira")
- [x] T07 — `horario.js`: remover comentários herdados do `iachatclean`
- [x] T08 — `prompts.js`: montar e injetar `linhaPlantao` a partir do `expediente`

## Inversão dos congelamentos
- [x] T09 — `horario.test.js`: inverter "CONGELA BUG D-19" para CA-001 (sábado aberto)
- [x] T10 — `horario.test.js`: atualizar virada de ano e Natal (o sábado agora é alcançável)
- [x] T11 — `turno.test.js`: inverter "CONGELA BUG D-28" para CA-007
- [x] T12 — `turno.test.js`: cenário de plantão passa de sábado para domingo

## Verificação
- [x] T13 — Todos os CA (001 a 010) cobertos por teste
- [x] T14 — `npm test` verde (254 testes) e `npm run lint` sem erro (6 avisos, era 7)
- [x] T15 — Execução real de `estaEmExpediente` sobre 10 instantes-chave
- [x] T16 — Linha de base HTTP idêntica à referência (CA-010, sem regressão em dia útil)

## Encerramento
- [x] T17 — Atualizar RN-060 e RN-061 em `docs/03-regras-de-negocio.md`
- [x] T18 — Marcar D-19 e D-28 como resolvidas em `docs/09-divida-tecnica.md`
- [x] T19 — Atualizar `docs/02-funcionalidades.md` (RF-040) e `docs/08-glossario.md`
- [x] T20 — Escrever `resultado.md` e marcar a spec como Implementada no `BACKLOG.md`

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
| 2026-08-11 | T06 | Não estava previsto: com o sábado alcançável, o rótulo produzia "na sábado". O defeito existia desde sempre, mas era inatingível. Corrigido com teste. |
| 2026-08-11 | T12 | O cenário de plantão do teste dourado usava sábado. Como sábado passou a ser dia útil, migrou para domingo. |
