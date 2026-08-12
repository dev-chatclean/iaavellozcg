# RESULTADO 0022 — Catálogo e expediente no domínio

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

| De | Para | O que é |
|---|---|---|
| `data.js` | `src/domain/catalogo/Catalogo.js` | Empresa, modelos, preços, pagamento, lojas, perfis, objeções, departamentos |
| `horario.js` | `src/domain/expediente/Expediente.js` | Tabela de expediente por dia, feriados, modo plantão |

Os dois eram conhecimento de negócio morando na raiz junto com código de infraestrutura. Agora são
domínio.

## A mudança que a fronteira forçou

`horario.js` lia `process.env.FERIADOS` no carregamento do módulo. A regra de lint do domínio —
`no-restricted-globals: process`, erro desde a spec 0004 — não permite isso, e com razão: uma regra
de negócio não deve saber que existe ambiente.

Então o módulo virou factory com os feriados injetados:

```js
Expediente.criar({ feriadosExtras: ['2026-02-17', '06-24'] })
```

Quem lê o ambiente é o adapter `RelogioDeExpedienteLocal`, que recebe `config.FERIADOS` do container.
A configuração encontra a regra na infraestrutura, não dentro dela.

**Ganho colateral nos testes:** os seis casos de feriado extra precisavam mexer em `process.env` e
recarregar o módulo a cada um. Agora são chamadas diretas — e ganharam um caso novo que antes era
impossível escrever: *"instâncias diferentes não compartilham feriados"*.

## Verificação

| | |
|---|---|
| Testes | **430** (eram 428) |
| Linha de base | requisições **e** log idênticos |
| Lint | 0 erros, 0 avisos |
| Arquivos `.js` na raiz | **6** (eram 9 no início; 4 são configuração e testers) |

## O que resta na raiz

```
index.js         95 linhas — bootstrap
flow.js          51 linhas — fachada sobre o domínio (some com a spec 0021)
prompts.js      204 linhas — texto dos prompts (vai para infrastructure/openai na spec 0011)
test-chat.js     78 linhas — tester local
sim-lead.js      80 linhas — simulação
eslint.config.js, vitest.config.js — configuração de ferramenta
```

O ratchet do lint ficou com dois arquivos: `flow.js` e `prompts.js`, ambos com data marcada.
