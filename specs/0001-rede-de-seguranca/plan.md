# PLAN 0001 — Rede de segurança

Plano técnico da [SPEC 0001](spec.md). **Aprovado por:** arquiteto-ddd.

## 1. Abordagem

Adicionar Vitest, ESLint e Prettier sem tocar em lógica de produção. Os testes atacam três frentes,
da mais barata para a mais valiosa: unitários no que já é puro (`flow`, `horario`, `data`),
caracterização no que é complexo e frágil (`parsePayload`, `montarResumo`), e um teste de integração
("dourado") que exercita `processarMensagem` inteira com todas as dependências externas falsificadas
por `vi.mock`.

O uso de `vi.mock` é **deliberadamente temporário**: é a única forma de injetar fakes antes da Fase 2.
Esse teste será reescrito sobre o caso de uso real na spec 0008 — e o fato de precisar de `vi.mock`
hoje é a própria evidência do acoplamento que a Fase 2 resolve.

## 2. Arquivos

**Criados**
| Arquivo | Responsabilidade |
|---|---|
| `vitest.config.js` | Config da suíte, thresholds de cobertura |
| `.eslintrc.json` | Regras de lint + `no-restricted-imports` (aviso, por ora) |
| `.prettierrc` | 4 espaços, aspas simples, largura 120 (estilo já usado no projeto) |
| `.github/workflows/ci.yml` | lint → test → build docker |
| `src/shared/telefone.js` | `normalizarPhone`, `nucleoNumero`, `contatoPermitido` |
| `test/unidade/flow.test.js` | RN-002, RN-003, RN-005 |
| `test/unidade/horario.test.js` | RN-060, RN-061, RN-062 |
| `test/unidade/data.test.js` | RN-041 (`lojaParaDepartamento`) |
| `test/unidade/telefone.test.js` | CA-002, CA-010 |
| `test/unidade/protecoes.test.js` | `webhookAutorizado`, `dentroDoLimite` |
| `test/caracterizacao/parsePayload.test.js` | CA-002, CA-003, CA-004 |
| `test/caracterizacao/montarResumo.test.js` | RN-043 |
| `test/caracterizacao/proximoCampo.test.js` | RN-002 nos 8 estados |
| `test/integracao/turno.test.js` | **Teste dourado** — 15 cenários |
| `test/fixtures/payloads/*.json` | Payloads reais anonimizados |
| `test/apoio/fakes.js` | Fakes de OpenAI, axios (Push) e store |
| `test/apoio/relogio.js` | Clock controlável |

**Alterados**
| Arquivo | Alteração |
|---|---|
| `package.json` | devDependencies + scripts `test`, `test:watch`, `coverage`, `lint`, `format` |
| `index.js` | Importa telefone de `src/shared/telefone.js`; exporta internos para teste (guardado) |

**Removidos** — nenhum.

## 3. Portas e contratos

Nenhuma porta é criada nesta spec (é a Fase 2). Os fakes de `test/apoio/fakes.js` são mocks de
módulo, não adapters — e serão descartados na spec 0004.

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|
| Characterization Test | `test/caracterizacao/` | Congela o comportamento atual como contrato |
| Test Data Builder | `test/apoio/` | Montar `leadData` em qualquer estado sem repetição |
| Fake (não mock de verificação) | `test/apoio/fakes.js` | Assertar sobre o resultado, não sobre a chamada |
| Clock injetado | `test/apoio/relogio.js` | Testar 30min e 24h sem esperar |

## 5. Estratégia de coexistência

Não se aplica — nada de produção é substituído. A única mudança estrutural (extração de
`src/shared/telefone.js`) mantém `index.js` funcionando por importação, com os testes escritos antes.

## 6. Feature toggle

Nenhuma. Refatoração aditiva; rollback é `git revert`.

## 7. Migração de dados

Nenhuma. O formato do estado no Redis não muda.

## 8. Estratégia de teste

| Nível | O que cobre | Arquivo |
|---|---|---|
| Unidade | Fluxo, expediente, departamento, telefone, proteções | `test/unidade/` |
| Caracterização | `parsePayload`, `montarResumo`, `determinarProximoCampo` | `test/caracterizacao/` |
| Integração | Turno completo com fakes — 15 cenários | `test/integracao/turno.test.js` |
| Contrato | — (spec 0004) | — |
| Eval | — (spec 0011) | — |

**Como provamos que não quebrou:** a própria suíte é a prova. Adicionalmente, `npm run sim` deve
produzir uma conversa qualitativamente equivalente à de antes (verificação manual única).

### Detalhes de implementação relevantes

**Exportar internos do `index.js` sem efeito colateral.** O arquivo chama `app.listen()` no topo do
módulo. Para testar `parsePayload` e `webhookAutorizado`, envolva o bootstrap:
```js
if (require.main === module) { iniciar(); }
module.exports = { parsePayload, webhookAutorizado, dentroDoLimite, montarResumo, processarMensagem };
```
Isso não muda o comportamento em produção (`node index.js` continua iniciando) e é revertido na
Fase 10, quando `index.js` vira só bootstrap.

**Fixtures.** Antes de escrever os testes, colete payloads reais do log do servidor
(`PAYLOAD RAW`), anonimize telefone, nome e conteúdo, e salve em `test/fixtures/payloads/`.
Cubra: aninhado com `SenderAlt`, aninhado sem `SenderAlt` (só `contact.number`), WABA com
`raw.from`, plano, grupo, `fromMe`, ticket com `userId`, ticket `closed`,
`numero_cliente`, payload desconhecido, imagem, áudio.

**Cenários do teste dourado** (15): os listados em `.claude/agents/qa-testes.md`.

## 9. Plano de rollback

`git revert` do merge. Nenhum artefato de produção depende dos testes. Tempo: < 2 minutos.

## 10. Impacto em performance e custo

Nenhum em produção. Em desenvolvimento, **redução** de custo: cenários hoje verificados com
`npm run chat` (que gasta OpenAI) passam a rodar de graça.

## 11. Sequência de PRs

1. **PR 1** — Ferramental: Vitest, ESLint, Prettier, scripts, CI. Um teste trivial verde.
2. **PR 2** — Unitários de `flow.js`, `horario.js`, `data.js`.
3. **PR 3** — Extração de `src/shared/telefone.js` + seus testes (nesta ordem: teste primeiro).
4. **PR 4** — Fixtures reais + caracterização de `parsePayload`.
5. **PR 5** — Caracterização de `montarResumo` e `determinarProximoCampo`; unitários das proteções.
6. **PR 6** — Teste dourado com os 15 cenários; thresholds de cobertura ligados no CI.
