# TASKS 0001 — Rede de segurança

Execução da [SPEC 0001](spec.md) conforme o [PLAN 0001](plan.md).

## Preparação
- [x] T01 — Ler spec e plano; resolver as questões em aberto (fixtures reais? qual CI?)
- [x] T02 — Criar branch `spec/0001-rede-de-seguranca`
- [x] T03 — Coletar payloads reais do log de produção e anonimizar → `test/fixtures/payloads/`

## PR 1 — Ferramental
- [x] T04 — `npm i -D vitest @vitest/coverage-v8 eslint prettier eslint-plugin-import`
- [x] T05 — `vitest.config.js` (ambiente node, cobertura v8, sem globals)
- [x] T06 — `.eslintrc.json` + `.prettierrc` no estilo já usado (4 espaços, aspas simples, 120 col)
- [x] T07 — Scripts no `package.json`: `test`, `test:watch`, `coverage`, `lint`, `format`
- [x] T08 — `.github/workflows/ci.yml`: lint → test → build docker (sem chave de API)
- [x] T09 — Teste trivial verde; CI verde → **merge do PR 1**

## PR 2 — Unitários do que já é puro
- [x] T10 — `flow.test.js`: `determinarProximoCampo` nos 8 estados (RN-002)
- [x] T11 — `flow.test.js`: `aplicarCampos` — não sobrescreve fato; sobrescreve mutável; respeita
  `correcao[]`; ignora `null`/`''` (RN-003)
- [x] T12 — `flow.test.js`: `detectarPerfil` — os 8 perfis + **precedência** (app antes de genérico)
- [x] T13 — `horario.test.js`: dia útil dentro/fora do horário; sábado; domingo; feriado fixo;
  feriado por env em `YYYY-MM-DD` e em `MM-DD`; virada de ano; rótulos "hoje/amanhã/na sexta" (CA-009)
- [x] T14 — `data.test.js`: `lojaParaDepartamento` para cada loja, variações de escrita e fallback
- [x] T15 — CI verde → **merge do PR 2**

## PR 3 — Extração dos utilitários de telefone
- [x] T16 — `telefone.test.js` **antes de mover o código**: sufixo `:24@s.whatsapp.net`,
  9º dígito, allow-list vazia, allow-list com formato diferente (CA-002, CA-010)
- [x] T17 — Criar `src/shared/telefone.js` com as três funções, sem alterar lógica
- [x] T18 — `index.js` importa de `src/shared/telefone.js`; remover as definições locais
- [x] T19 — Suíte verde + `npm start` sobe → **merge do PR 3**

## PR 4 — Caracterização do `parsePayload`
- [x] T20 — Tornar `index.js` importável: `if (require.main === module) iniciar();` + `module.exports`
- [x] T21 — Casos de formato: aninhado com `SenderAlt`; aninhado só com `contact.number`; WABA com
  `raw.from`; plano; `numero_cliente`; payload desconhecido
- [x] T22 — Casos de descarte: `fromMe`; grupo pelos **5 sinais**; ticket com `userId`;
  ticket `closed` (CA-003, CA-004)
- [x] T23 — Campos derivados: `contactId` na ordem de precedência; `tipo` normalizado
  (`chat`/`''`→`text`); `nomeContato`; `quotedText`; mídia
- [x] T24 — ≥ 12 casos verdes → **merge do PR 4**

## PR 5 — Caracterização restante e proteções
- [x] T25 — `montarResumo`: com e sem dados de simulação; com e sem `proximoExpediente`;
  com e sem `tagExtra`; loja não identificada → `Comercial`
- [x] T26 — `proximoCampo.test.js`: os 8 estados + `qualificacaoCompleta` ao final
  (**anotar o efeito colateral D-06 como `// CONGELA BUG D-06`**)
- [x] T27 — `protecoes.test.js`: `webhookAutorizado` (secret vazio, header, query, path, token
  errado, token de tamanho diferente) e `dentroDoLimite` (dentro, no limite, acima, desativado)
- [x] T28 — CI verde → **merge do PR 5**

## PR 6 — Teste dourado
- [x] T29 — `test/apoio/fakes.js`: OpenAI fake (extração e resposta determinísticas), Push fake
  (coleta mensagens enviadas), store fake em memória
- [x] T30 — `test/apoio/relogio.js` + builders de `leadData`
- [x] T31 — Cenários 1–5: preço na 1ª mensagem (CA-005); fluxo feliz até transbordo (CA-006);
  correção de modelo; pedido de humano; cliente atual → Pós-venda
- [x] T32 — Cenários 6–10: fora de expediente; falha de transcrição; documento encerra o turno;
  grupo/`fromMe`/ticket assumido ignorados; `msgId` duplicado
- [x] T33 — Cenários 11–15: rate-limit; anti-loop (CA-007); reset 24h (CA-008); follow-up 30min sem
  repetir; mensagem após transbordo (UC-010)
- [x] T34 — Ligar thresholds de cobertura no CI (CA-012) e confirmar suíte < 10s (CA-001)
- [x] T35 — CI verde → **merge do PR 6**

## Encerramento
- [x] T36 — Abrir issue para cada bug congelado pelos testes (D-06 e o que mais aparecer)
- [x] T37 — Registrar os payloads que **não** casaram com nenhum formato conhecido (insumo da spec 0003)
- [x] T38 — Revisão do `revisor-codigo` sem BLOQUEANTE em aberto
- [x] T39 — Atualizar `README.md` (seção de testes) e `docs/09-divida-tecnica.md` (D-12, D-13 → resolvidas)
- [x] T40 — Marcar SPEC 0001 como `Implementada` no `specs/BACKLOG.md`; liberar as specs 0002 e 0003

## Registro de execução

| Data | Tarefa | Observação |
|---|---|---|
