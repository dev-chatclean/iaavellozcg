# RESULTADO 0004 — Portas e adapters

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

```
ANTES                                  DEPOIS
index.js                               index.js
  new OpenAI(...)                        deps.extrator.extrair(...)
  axios.post(CC_PUSH_URL, ...)           deps.canal.enviarTexto(...)
  require('./store')                     deps.repositorio.salvar(...)
  axios.post('.../transcriptions')       deps.transcritor.transcrever(...)
  axios.get(mediaUrl)                    deps.baixadorDeMidia.baixar(...)
  estaEmExpediente()                     deps.expediente.consultar()
                                              |
                                              v
                                       src/application/portas/  (contratos)
                                              ^
                                              |
                                       src/infrastructure/
                                         chatclean/CanalChatClean
                                         openai/{Extrator,Redator,Transcritor,LeitorDeImagem}
                                         redis/RepositorioRedis
                                         memoria/RepositorioMemoria
                                         midia/BaixadorHttp
                                         relogio/{DoSistema,DeExpedienteLocal}
                                              ^
                                              |
                                       src/main/container.js  (composition root)
```

`index.js` não importa mais `openai`, `axios`, `ioredis` nem `form-data`. **Nenhuma.**

## Critérios de aceite

| CA | Situação | Evidência |
|---|---|---|
| CA-001 sem infra fora de `src/infrastructure` | Atendido | Verificado por lint **e** por arquivo de violação proposital |
| CA-002 teste dourado sem `vi.mock`/`require.cache` | Atendido | `fakes.js` injeta pelo `usarDependencias` |
| CA-003 fim da manipulação do `require.cache` | Atendido | Só resta o `delete` do próprio `index.js` para reler a configuração |
| CA-004 suíte de contrato do repositório | Atendido | 28 casos rodando em duas implementações |
| CA-005 escolha Redis/memória no container | Atendido | `container.montarRepositorio`; comportamento observável idêntico |
| CA-006 transcrição pelo SDK (D-26) | Atendido | `TranscritorWhisper` usa `cliente.audio.transcriptions.create` |
| CA-007 testes existentes verdes | Atendido com ressalva | Ver abaixo |
| CA-008 linha de base idêntica | Atendido | Requisições HTTP idênticas; log com as mesmas linhas |
| CA-009 suíte < 10s | Atendido | 2,3s com 348 testes |

**Ressalva do CA-007.** Os 300 testes de unidade, contrato e caracterização passaram **sem tocar em
nada**. O teste dourado precisou de um *rename mecânico* dos identificadores dos fakes
(`s.openai` para `s.ia`, `s.axios` para `s.canal`/`s.midia`, `s.store` para `s.repositorio`), porque
o mecanismo de injeção mudou. Nenhuma asserção foi alterada: verificado com um `diff` que normaliza
os nomes dos handles e não acusa nenhuma outra diferença.

## A barreira que não barrava

Ao elevar as fronteiras de aviso para erro, escrevi a regra com `no-restricted-imports` — como está
no plano original — e o lint passou. Antes de comemorar, criei um arquivo em `src/domain/` fazendo
`require('axios')` de propósito: **passou também.**

`no-restricted-imports` só enxerga `import` de ESM. Este projeto é CommonJS. A regra estava lá desde
a spec 0001, dando a sensação de proteção sem proteger nada.

Trocada por `no-restricted-syntax` sobre a chamada `require()`, e as três barreiras foram testadas
com violação proposital:

| Barreira | Violação testada | Resultado |
|---|---|---|
| Camada pura não importa infra | `require('axios')` em `src/domain/` | Bloqueado |
| Camada pura não lê `process.env` | `process.env.X` em `src/domain/` | Bloqueado |
| Adapter não conhece o composition root | `require('../../main/container')` em `src/infrastructure/` | Bloqueado |
| *(falso positivo)* | `require('../../domain/...')` — contém "main" dentro de "domain" | Passa, como deve |

Guardrail que não foi visto falhar não é guardrail.

## Legado removido

`store.js` (124 linhas) ficou órfão e foi deletado — a regra do Strangler Fig cumprida: o novo nasce,
o legado delega, o legado morre. Saiu também do ratchet do lint, que agora tem 8 arquivos em vez de 9.

## Números

| Indicador | Antes | Depois |
|---|---:|---:|
| Testes | 320 | **348** |
| `index.js` | 990 linhas | **907** |
| Código em `src/` | 717 linhas | **1.489** |
| Arquivos legados na raiz | 9 | **8** |
| Avisos de lint | 6 | **4** |
| `require` de infra no `index.js` | 4 | **0** |

## O que ficou pendente de propósito

- **`usarDependencias` é uma costura temporária.** Enquanto `processarMensagem` viver no `index.js`,
  os testes precisam de um ponto de injeção. É melhor que manipular o `require.cache`, mas não é o
  destino: morre na Fase 4 (spec 0008), quando o turno virar caso de uso com injeção por construtor.
- **O adapter Redis não entra na suíte de contrato** — exigiria um servidor. Quando houver container
  efêmero no CI, ele entra sem alterar nenhum caso de teste; é para isso que a suíte é parametrizada.
- **D-18 (alarme de Redis ausente) e S7 (endereço de mídia)** saíram do escopo por mudarem
  comportamento. Viram spec 0019.
