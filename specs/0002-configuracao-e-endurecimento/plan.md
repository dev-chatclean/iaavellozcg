# PLAN 0002 — Configuração validada e endurecimento mínimo

Plano técnico da [SPEC 0002](spec.md). **Aprovado por:** arquiteto-ddd e seguranca-lgpd.

## 1. Abordagem

Um módulo de configuração em `src/main/config.js` — o primeiro habitante do composition root da
arquitetura alvo. Ele lê `process.env`, valida com zod e devolve um objeto congelado. `index.js`
passa a consumir esse objeto em vez de ler variáveis soltas.

A validação acontece no **carregamento do módulo**, não numa função chamada depois: é o que garante
que o processo morre antes de `app.listen`. O defeito do D-23 não era a falta de validação, era a
**ordem** — o `OPENAI_API_KEY` já era verificado, mas depois de a porta estar aberta.

Mascaramento de PII entra como módulo puro em `src/shared/mascarar.js`, ao lado de `telefone.js`.

## 2. Arquivos

**Criados**
| Arquivo | Responsabilidade |
|---|---|
| `src/main/config.js` | Ler, validar e congelar a configuração; avisos operacionais |
| `src/shared/mascarar.js` | Mascarar telefone, CPF e conteúdo para log |
| `.dockerignore` | Impedir que `.env` e artefatos entrem na imagem |
| `test/unidade/config.test.js` | Padrões, coerção, faixas, produção, avisos |
| `test/unidade/mascarar.test.js` | Garantias do mascaramento |

**Alterados**
| Arquivo | Alteração |
|---|---|
| `index.js` | Consome `config`; digest SHA-256 no webhook; log sem PII; boot usa `avisos()`; `/diag` ampliado |
| `.env.example` | `NODE_ENV`, `LOG_PAYLOAD` e o novo contrato do `WEBHOOK_SECRET` |
| `test/unidade/protecoes.test.js` | Congelamento do S4 reescrito; casos de segredo longo |
| `package.json` | Dependência `zod` |

## 3. Portas e contratos

Nenhuma porta ainda. `config` é um objeto de dados, não uma abstração — e é assim que deve ser: a
configuração é injetada nos adapters pelo composition root na Fase 2.

```js
validar(env) -> { ok: true, config } | { ok: false, mensagem }
carregar(env) -> config            // encerra o processo se inválida
avisos(config) -> string[]          // legal, mas merece atenção
```

`validar` puro e `carregar` com efeito é o que permite testar a validação sem derrubar a suíte.

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|
| Fail-fast | `carregar()` no topo do módulo | Erro de configuração aparece no deploy, não num cliente sem resposta |
| Fail-closed | `WEBHOOK_SECRET` em produção | Segurança por omissão, não por lembrança |
| Parse, don't validate | Objeto congelado e tipado no lugar de `process.env` | Quem consome recebe número, boolean e lista, não string |
| Função pura + casca com efeito | `validar` / `carregar` | Testabilidade sem `process.exit` na suíte |

## 5. Estratégia de coexistência

`store.js`, `horario.js` e `pipeline.js` continuam lendo `process.env`. Suas variáveis já são
validadas centralmente, mas o consumo só migra quando eles virarem adapters (Fase 2). Fazer isso
agora significaria mexer em três módulos que serão reescritos — trabalho jogado fora.

## 6. Feature toggle

`LOG_PAYLOAD` funciona como toggle de depuração, não de fatia. Para o resto, o comportamento novo é
o desejado imediatamente; rollback é `git revert`.

## 7. Migração de dados

Nenhuma. Nada persistido muda.

## 8. Estratégia de teste

| Nível | O que cobre | Arquivo |
|---|---|---|
| Unidade | Validação, coerção, produção, avisos, mascaramento | `config.test.js`, `mascarar.test.js` |
| Unidade | Comparação por digest, segredo longo | `protecoes.test.js` |
| Execução real | Fail-fast com variável faltante, três erros juntos, produção sem segredo | registrado no resultado |
| Linha de base | Rotas e ausência de PII no log | `test/baseline/` |
| Imagem | `docker build` real com `.env` presente | registrado no resultado |

**Como provamos que não quebrou:** os 254 testes anteriores continuam verdes sem alteração, e a linha
de base só diverge no `/diag`, mudança declarada no escopo.

## 9. Plano de rollback

`git revert` do commit. Volta a ler `process.env` direto, o webhook volta a aceitar tudo e o payload
volta ao log. Menos de 2 minutos, sem estado a desfazer.

**Atenção operacional:** se o deploy já tiver `NODE_ENV=production` sem `WEBHOOK_SECRET`, o serviço
não sobe. Isso é o comportamento correto, mas quem faz o deploy precisa saber antes — está no
checklist de go-live.

## 10. Impacto em performance e custo

Nenhum. A validação roda uma vez no boot. O mascaramento é manipulação de string em linha de log.

## 11. Sequência de PRs

Um só: as cinco correções compartilham o mesmo módulo de configuração e os mesmos testes de
verificação.
