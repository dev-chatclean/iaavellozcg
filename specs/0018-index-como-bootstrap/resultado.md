# RESULTADO 0018 — `index.js` como bootstrap

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O fim da estrangulação estrutural

```
                    1040 linhas                    95 linhas
index.js  ─────────────────────────────────>  index.js (bootstrap)
  configuração                                   montar(config, deps)
  servidor HTTP                                  iniciar(sistema)
  autenticação                                        |
  parse de payload                                    v
  dedup, rate-limit, anti-loop            src/main/          config, container
  fila e agrupamento                      src/application/   casos de uso, fila, mídia
  processamento de mídia                  src/domain/        regras de negócio
  chamadas à OpenAI                       src/infrastructure/ HTTP, OpenAI, ChatClean,
  máquina de estados                                          Redis, terminal, relógio
  resumo, notificação, transbordo
  follow-up
  endpoints administrativos
  bootstrap
```

## O que saiu nesta fatia

| Peça | Para onde |
|---|---|
| Fila, debounce e agrupamento | `src/application/fila/FilaDeTurnos.js` |
| Autenticação, vazão, idempotência, guarda admin | `src/infrastructure/http/protecoes.js` |
| Log e política do parse | `src/infrastructure/http/traduzirPayload.js` |
| Servidor, rotas e `handleWebhook` | `src/infrastructure/http/servidor.js` |

## A costura morreu

`usarDependencias` — introduzida na spec 0004 como ponto de injeção para os testes — **não existe
mais**. O teste monta o sistema pela mesma função que o bootstrap usa:

```js
const sistema = montar(config, deps);   // deps = fakes das portas
```

Sem `vi.mock`, sem `require.cache`, sem estado global. A evolução foi:

| Spec | Como o teste injetava |
|---|---|
| 0001 | Manipulando o `require.cache` do Node — a prova viva do acoplamento (D-02) |
| 0004 | `usarDependencias`, uma costura declaradamente temporária |
| 0018 | `montar(config, fakes)`, o mesmo caminho da produção |

## Verificação

| | |
|---|---|
| Testes | **428**, todos verdes |
| Teste dourado (44 cenários) | passou **sem alterar uma linha** |
| Linha de base | requisições **e** log do servidor idênticos |
| Lint | **0 erros, 0 avisos** — pela primeira vez |
| `index.js` | **95 linhas** |

Nos demais arquivos de teste mudaram apenas as **linhas de import**: as funções agora vêm dos módulos
onde passaram a morar. Nenhuma asserção foi tocada. O `protecoes.test.js` ficou mais simples de
quebra — as proteções recebem a configuração por parâmetro, então sumiu todo o vaivém de
`process.env` e recarregamento de módulo.

## O ratchet do lint foi encerrado

Começou na spec 0001 com **9 arquivos** em modo aviso, porque a Fase 0 era zero-mudança-de-comportamento
e não dava para corrigir o legado ali. A regra era: a lista só encolhe.

| Spec | Saiu da lista |
|---|---|
| 0004 | `store.js` |
| 0007 | `pipeline.js` |
| 0008 | `index.js` (o turno saiu) |
| 0010 | `test-chat.js`, `sim-lead.js` |
| 0018 | o que restava |

Hoje o projeto passa no lint sem nenhuma exceção.

## D-22 fechado de passagem

O `/leads` expunha `l.empresa`, campo que não existe no domínio Avelloz (resquício do `iachatclean`).
Era sempre `undefined` e sumia na serialização — por isso a saída HTTP continua **idêntica**, e a
linha de base confirma.

## O que ainda vive na raiz

`data.js`, `flow.js`, `horario.js` e `prompts.js`. São conteúdo de negócio e fachadas finas, não
lógica misturada:

- `flow.js` — 51 linhas de fachada sobre o domínio; morre quando o efeito colateral do D-06 for
  corrigido (spec 0021).
- `horario.js` — vira `domain/expediente` numa fatia própria.
- `data.js` — vira `domain/catalogo`.
- `prompts.js` — vira `infrastructure/openai/prompts/` com versionamento (spec 0011).

## Dívida que continua aberta, e é operacional

Nada disso mudou nesta fatia, por serem mudanças de comportamento:

| ID | O que é |
|---|---|
| D-15 | Fila, dedup e rate-limit em memória: o sistema só é seguro com **uma instância** |
| D-16 | Shutdown abrupto: turnos em voo e fila são perdidos a cada deploy |
| D-17 | Sem retry nas chamadas externas |
| D-06 | Consulta do funil ainda marca o lead como qualificado |
| S2, S3 | CPF completo no resumo à equipe e em claro no Redis |
