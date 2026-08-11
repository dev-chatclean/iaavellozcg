# TASKS NNNN — <Título>

Execução da [SPEC NNNN](spec.md) conforme o [PLAN NNNN](plan.md).
Cada tarefa cabe em uma sessão e tem resultado verificável.

## Preparação
- [ ] T01 — Ler spec e plano; confirmar que nenhuma questão em aberto bloqueia o início
- [ ] T02 — Criar branch `spec/NNNN-nome`

## Rede de segurança
- [ ] T03 — Teste que cobre o comportamento atual (caracterização) — **falha se o comportamento mudar**
- [ ] T04 — Confirmar suíte verde antes de qualquer alteração

## Implementação
- [ ] T05 — …
- [ ] T06 — …

## Coexistência
- [ ] T07 — Legado passa a delegar ao caminho novo
- [ ] T08 — Feature toggle (se aplicável) e valor padrão definido

## Verificação
- [ ] T09 — Todos os CA da spec cobertos por teste automatizado
- [ ] T10 — `npm test` verde · `npm run lint` sem erro
- [ ] T11 — `npm start`, `npm run chat` e `npm run sim` funcionando
- [ ] T12 — Revisão do `revisor-codigo` (sem BLOQUEANTE em aberto)

## Encerramento
- [ ] T13 — Remover o caminho legado **ou** registrar a spec futura que o removerá
- [ ] T14 — Atualizar docs afetados (`docs/`, `.env.example`, `README.md`)
- [ ] T15 — Marcar a spec como `Implementada` e atualizar `specs/BACKLOG.md`

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
