# RESULTADO 0002 — Configuração validada e endurecimento mínimo

**Status:** Implementada · **Concluída em:** 2026-08-11 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

### `src/main/config.js` (novo) — D-23
Fonte única das 21 variáveis, validada com zod **uma vez, no carregamento do módulo**, antes de
qualquer efeito colateral. Configuração inválida derruba o processo com uma mensagem que lista
**todos** os problemas de uma vez e mostra o valor recebido.

`validar()` é puro (devolve o erro) e `carregar()` o embrulha com `process.exit` — assim os testes
exercitam a validação sem derrubar a suíte.

Em `NODE_ENV=production` o esquema fica mais rígido: `WEBHOOK_SECRET` (mínimo 16 caracteres) e
`CC_PUSH_URL` passam a ser obrigatórios.

### `src/shared/mascarar.js` (novo) — S1
`telefone()` preserva país, DDD e os quatro últimos dígitos (`5583*****8888`) — o suficiente para
correlacionar um atendimento numa investigação, sem expor o número. `cpf()` e `conteudo()` ficam
prontos para a spec 0016.

### `index.js`
- Consome `config` em vez de ler `process.env` espalhado.
- **S5**: `webhookAutorizado` compara digests SHA-256 em vez de `padEnd(128)`. Segredos longos
  deixam de colidir e o comprimento não é mais comparado em texto claro.
- **S1**: o payload bruto só é registrado com `LOG_PAYLOAD=true`; no lugar entra a lista de chaves do
  corpo. Todas as 11 linhas de log que traziam o telefone passaram a mascará-lo.
- O boot deixou de repetir avisos hardcoded: usa `avisos(config)`.
- `/diag` passou a informar `ambiente`, `webhookProtegido`, `logDePayload` e `avisosDeConfiguracao`.

### `.dockerignore` (novo) — S8

## Verificação na aplicação real

**Fail-fast (CA-001, CA-002, CA-003, CA-004)** — executado de verdade:

```
$ env -u OPENAI_API_KEY node index.js
Configuração inválida — o servidor não vai subir:
  - OPENAI_API_KEY: é obrigatória (chave da OpenAI com crédito) — recebido (não definida)
exit code: 1

$ PORT=abc RATE_LIMIT_MSGS=xx LOOP_MAX_TURNOS=yy node index.js
  - PORT: precisa ser um número inteiro — recebido "abc"
  - RATE_LIMIT_MSGS: precisa ser um número inteiro — recebido "xx"
  - LOOP_MAX_TURNOS: precisa ser um número inteiro — recebido "yy"
exit code: 1

$ NODE_ENV=production CC_PUSH_URL=https://x/y node index.js
  - WEBHOOK_SECRET: é obrigatório em produção (sem ele /webhook fica ABERTO)
exit code: 1
```

Em todos os casos o processo morre **antes** de abrir a porta — era exatamente o defeito do D-23,
onde o `app.listen` acontecia primeiro.

**PII no log (CA-008)** — comparando a mesma coleta de linha de base:

| | Antes | Depois |
|---|---|---|
| Payloads brutos no log | 13 | **0** |
| Linhas com telefone em claro | várias | **0** |
| Formato da linha de recebimento | `Webhook de 5583988887777 [text]: "oi"` | `Webhook de 5583*****7777 [text] (2 caracteres)` |

**Modo de depuração (CA-009)** — com `LOG_PAYLOAD=true` o payload volta ao log, e o boot avisa em
destaque que dados pessoais estão sendo registrados.

**Imagem Docker (CA-010)** — `docker build` real, com um `.env` presente na máquina:

```
/app: .env.example Dockerfile data.js flow.js horario.js index.js node_modules
      package.json package-lock.json pipeline.js prompts.js sim-lead.js src store.js test-chat.js
.env presente na imagem? ok: .env NAO entrou
```

`test/`, `docs/`, `specs/`, `.git/` e `.claude/` também ficaram de fora.

**Linha de base (CA-011)** — única diferença nas rotas: `/diag` ganhou os campos novos, mudança
declarada no escopo. Todo o resto saiu idêntico. A referência foi atualizada.

## Testes

**294 no total** (eram 254). Novos:
- `test/unidade/config.test.js` — 22 testes: padrões, coerção, faixas, fail-closed de produção, avisos.
- `test/unidade/mascarar.test.js` — 13 testes, incluindo a garantia de que o CPF inválido **não vaza
  o valor** e que o conteúdo da mensagem nunca aparece.
- `test/unidade/protecoes.test.js` — 5 testes novos para o segredo longo (CA-006, CA-007).

O teste que congelava o risco S4 foi reescrito: em vez de documentar "aceita qualquer requisição",
agora afirma o compromisso — permissivo fora de produção (CA-005), impossível em produção (CA-004).

## Critérios de aceite

CA-001 a CA-011: todos atendidos, cada um com verificação executada e registrada acima.

## Riscos que se confirmaram

O risco previsto na spec — "deploy em produção quebrar por variável faltante" — **é real e
intencional**. Se o servidor atual não define `NODE_ENV=production`, o fail-closed do CA-004 não
dispara e o webhook continua aberto. Isso precisa entrar no comando do PM2:

```bash
NODE_ENV=production pm2 start index.js --name iaavellozcg
# ou: pm2 start index.js --name iaavellozcg --env production
```

## Pendências declaradas

- `store.js`, `horario.js` e `pipeline.js` continuam lendo `process.env` diretamente. Suas variáveis
  já são **validadas** pelo módulo de configuração, mas o consumo só migra na Fase 2, quando esses
  módulos viram adapters.
- Mascarar o CPF no resumo enviado à equipe (S2) e criptografia em repouso (S3) seguem abertos —
  spec 0016.
