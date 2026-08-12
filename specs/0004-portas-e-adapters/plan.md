# PLAN 0004 — Portas e adapters

Plano técnico da [SPEC 0004](spec.md). **Aprovado por:** arquiteto-ddd.

## 1. Abordagem

Em JavaScript não existe interface de linguagem. As portas viram **contratos documentados** em
`src/application/portas/index.js` (JSDoc) mais uma **suíte de contrato** compartilhada entre o adapter
real e o fake — quem garante conformidade é o teste, não o compilador.

Cada função do `index.js` que hoje fala com o mundo vira uma chamada de uma linha à porta
correspondente. O corpo migra para o adapter **sem alteração**: mesmos modelos, temperaturas,
timeouts, mensagens de erro e valores de retorno.

`src/main/container.js` monta tudo a partir da configuração já validada. `index.js` recebe o
resultado numa variável `deps`.

## 2. A costura para os testes

O teste dourado precisa injetar fakes. Com `processarMensagem` ainda dentro do `index.js`, não há
construtor onde injetar. Três opções foram consideradas:

| Opção | Por que não / por que sim |
|---|---|
| Manter `vi.mock` / `require.cache` | É o que a spec vem eliminar |
| Extrair `processarMensagem` para caso de uso agora | É a Fase 4 inteira; misturaria duas fatias |
| **`usarDependencias(deps)` exportado** | Escolhida: cinco linhas, honesta, e morre na Fase 4 |

A costura fica documentada no código como temporária, com a spec que a remove.

## 3. Arquivos

**Criados**
| Arquivo | Papel |
|---|---|
| `src/application/portas/index.js` | Contratos (JSDoc) de 10 portas |
| `src/infrastructure/chatclean/CanalChatClean.js` | `CanalDeMensagem` + `NotificadorDeEquipe` |
| `src/infrastructure/redis/RepositorioRedis.js` | `RepositorioDeAtendimento` |
| `src/infrastructure/memoria/RepositorioMemoria.js` | idem, em memória |
| `src/infrastructure/openai/ExtratorOpenAI.js` | `ExtratorDeInformacoes` |
| `src/infrastructure/openai/RedatorOpenAI.js` | `RedatorDeResposta` |
| `src/infrastructure/openai/TranscritorWhisper.js` | `TranscritorDeAudio` (SDK, D-26) |
| `src/infrastructure/openai/LeitorDeImagemOpenAI.js` | `LeitorDeImagem` |
| `src/infrastructure/midia/BaixadorHttp.js` | `BaixadorDeMidia` |
| `src/infrastructure/relogio/RelogioDoSistema.js` | `Relogio` |
| `src/infrastructure/relogio/RelogioDeExpedienteLocal.js` | `RelogioDeExpediente` |
| `src/main/container.js` | Composition root |
| `test/contrato/repositorio.test.js` | Suíte de contrato |

**Alterados**
| Arquivo | Alteração |
|---|---|
| `index.js` | Consome `deps`; exporta `usarDependencias`; imports de infra removidos |
| `test/apoio/fakes.js` | Reescrito: fakes de porta no lugar do truque de `require.cache` |
| `test/integracao/turno.test.js` | Rename mecânico dos handles; asserções intactas |
| `eslint.config.js` | Fronteiras viram erro, com seletor que funciona em CommonJS |

**Removidos:** `store.js`.

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|
| Ports & Adapters | Todo o contorno | Testar sem rede; trocar provedor sem tocar no núcleo |
| Composition root manual | `container.js` | Mais fácil de ler e depurar que resolução automática |
| Suíte de contrato | `test/contrato/` | LSP verificado: fake e real se comportam igual |
| ISP | Canal e notificador separados, mesmo adapter | Quem só envia texto não depende de nota interna |
| Costura de teste declarada | `usarDependencias` | Melhor que mock de módulo, e com data de morte |

## 5. Estratégia de coexistência

Sem coexistência: cada porta substitui seu trecho de uma vez, protegida pelos 320 testes. Manter dois
caminhos exigiria comparar resultados em produção — desnecessário quando o teste prova equivalência.

## 6. Feature toggle

Nenhuma. Rollback é `git revert`.

## 7. Migração de dados

Nenhuma. O formato do estado no Redis é o mesmo; só mudou quem o lê e escreve.

## 8. Estratégia de teste

| Nível | O que cobre |
|---|---|
| Contrato | Repositório em duas implementações (28 casos) |
| Integração | Teste dourado, agora com fakes de porta |
| Caracterização e unidade | Inalterados — são o contrato de não-regressão |
| Lint | Fronteiras, **testadas com violação proposital** |
| Linha de base | Rotas HTTP e log do servidor |

## 9. Ordem de execução

1. Portas (contratos) · 2. Relógio · 3. Canal e notificador · 4. Repositórios + contrato ·
5. Adapters OpenAI · 6. Baixador de mídia · 7. Container e `index.js` · 8. Fakes e teste dourado ·
9. Fronteiras do lint · 10. Remoção do `store.js`

## 10. Plano de rollback

`git revert` do commit. Menos de 2 minutos, sem estado a desfazer.

## 11. Impacto em performance e custo

Nenhum: mesmas chamadas, mesmos destinos. Uma indireção de função por operação.
