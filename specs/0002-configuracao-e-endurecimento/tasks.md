# TASKS 0002 — Configuração validada e endurecimento mínimo

Execução da [SPEC 0002](spec.md) conforme o [PLAN 0002](plan.md).

## Preparação
- [x] T01 — Confirmar suíte verde (254 testes) antes de começar
- [x] T02 — Instalar `zod` (também será usado pela spec 0003, no ACL do payload)

## Configuração (D-23)
- [x] T03 — `src/main/config.js`: esquema das 21 variáveis com coerção e padrões
- [x] T04 — Mensagem de erro listando todos os problemas com o valor recebido
- [x] T05 — `validar()` puro e `carregar()` com `process.exit`
- [x] T06 — Esquema mais rígido em `NODE_ENV=production`
- [x] T07 — `avisos()` para o que é legal mas merece atenção
- [x] T08 — `index.js` consome `config` em vez de `process.env`

## Segurança
- [x] T09 — S5: comparação por digest SHA-256 em `webhookAutorizado`
- [x] T10 — S4: `WEBHOOK_SECRET` obrigatório em produção (via esquema)
- [x] T11 — S1: `src/shared/mascarar.js`
- [x] T12 — S1: payload bruto atrás de `LOG_PAYLOAD`
- [x] T13 — S1: mascarar telefone nas 11 linhas de log que o expunham
- [x] T14 — S8: `.dockerignore`

## Testes
- [x] T15 — `config.test.js` (22 testes)
- [x] T16 — `mascarar.test.js` (13 testes)
- [x] T17 — Reescrever o congelamento do S4 em `protecoes.test.js`
- [x] T18 — Casos de segredo longo (CA-006, CA-007)

## Verificação na aplicação
- [x] T19 — CA-001/002/003/004: executar `node index.js` com configurações inválidas
- [x] T20 — CA-008: coletar linha de base e contar payloads e telefones em claro
- [x] T21 — CA-009: subir com `LOG_PAYLOAD=true` e confirmar o payload no log
- [x] T22 — CA-010: `docker build` real com `.env` presente na máquina
- [x] T23 — CA-011: diff da linha de base (só `/diag` divergiu, como previsto)
- [x] T24 — `npm test` (294) e `npm run lint` (6 avisos, sem erro)

## Encerramento
- [x] T25 — `.env.example`: `NODE_ENV`, `LOG_PAYLOAD` e o novo contrato do `WEBHOOK_SECRET`
- [x] T26 — Atualizar a referência da linha de base (mudança do `/diag` é intencional)
- [x] T27 — Marcar D-23, S1, S4, S5 e S8 em `docs/09-divida-tecnica.md`
- [x] T28 — Atualizar o checklist de go-live com `NODE_ENV=production`
- [x] T29 — `resultado.md` e status no `BACKLOG.md`

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
| 2026-08-11 | T04 | Primeira versão lia `process.env` para mostrar o valor recebido, ignorando o objeto passado a `validar()`. Os testes pegaram: a mensagem dizia "(não definida)" para valores que existiam. |
| 2026-08-11 | T10 | Segredo vazio em produção caía na mensagem genérica de tamanho mínimo, sem explicar o risco. Mensagem unificada para citar o webhook aberto nos dois casos. |
| 2026-08-11 | T22 | O `docker build` confirmou que `test/`, `docs/`, `specs/`, `.git/` e `.claude/` também ficam fora da imagem — não só o `.env`. |
