# SPEC 0004 — Portas e adapters

| | |
|---|---|
| **Status** | Rascunho — revisar antes de implementar |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 |
| **Fase do plano** | Fase 2 — Portas e adapters |
| **Dívida endereçada** | D-02, D-18, D-26, S7 |
| **Depende de** | SPEC 0001, SPEC 0002, SPEC 0003 |

## 1. Contexto de negócio

O sistema depende de três fornecedores externos: OpenAI (inteligência), ChatClean (transporte) e
Redis (estado). Hoje essas dependências estão soldadas ao código: trocar de provedor de LLM, ou o
ChatClean por outro canal, significa reescrever o núcleo do atendimento.

Isso não é hipótese distante. A `CC_PUSH_URL` já é regenerada sozinha quando a sessão de WhatsApp
reconecta; o preço e a qualidade dos modelos de LLM mudam a cada poucos meses.

## 2. Problema

`index.js` instancia `OpenAI`, `axios` e o `store` no próprio módulo (D-02). As consequências são
concretas:

- **Nenhum teste do fluxo roda sem fraude.** O teste dourado da Fase 0 só existe porque
  `test/apoio/fakes.js` injeta dependências pelo `require.cache` — uma dívida assumida de propósito,
  e a prova viva do acoplamento.
- **O Redis degrada em silêncio** (D-18): sem `REDIS_URL`, o estado cai para memória sem alarme. Em
  produção isso significa perder tudo a cada restart, e ninguém percebe até um cliente reclamar.
- **Dois caminhos de autenticação** para o mesmo fornecedor (D-26): a transcrição monta multipart na
  mão com axios, enquanto o resto usa o SDK.
- **A `mediaUrl` do webhook é baixada e repassada à OpenAI sem validação de host** (S7).

## 3. Resultado esperado

Todo acesso ao mundo externo passa por uma porta definida por nós. O teste dourado roda injetando
adapters fake pelo composition root, sem `vi.mock` e sem `require.cache`.

## 4. Escopo

**Dentro** — as portas, seus adapters reais e fakes, a suíte de contrato compartilhada, e o
composition root em `src/main/container.js`:

| Porta | Substitui | Adapters |
|---|---|---|
| `CanalDeMensagem` | `ccPush`, `enviarMensagem` | ChatClean, memória, terminal |
| `RepositorioDeAtendimento` | `store.js` | Redis, memória (**explícito**) |
| `ExtratorDeInformacoes` | `extrairInformacoesComIA` | OpenAI, fake determinístico |
| `RedatorDeResposta` | `gerarRespostaIA`, `gerarRespostaPosEncaminhamento` | OpenAI, fake |
| `TranscritorDeAudio` | bloco Whisper | OpenAI (SDK), fake |
| `LeitorDeImagem` | `analisarImagem` | OpenAI, fake |
| `NotificadorDeEquipe` | `notificarEquipe` | ChatClean, memória |
| `Relogio` / `RelogioDeExpediente` | `Date.now()`, `estaEmExpediente` | real, controlável |

**Fora de escopo**
- Modelar o domínio (`Atendimento`, VOs, políticas) — spec 0006.
- Substituir `processarMensagem` por caso de uso — spec 0008.
- Retry, backoff e circuit breaker — spec 0013 (as portas preparam o terreno).
- Mover fila, dedup e rate-limit para o Redis — spec 0012.

## 5. Regras de negócio aplicáveis

Nenhuma muda. A fatia é estrutural: mesma lógica, outro caminho de dependência.

## 6. Critérios de aceite

- **CA-001** — Nenhum `require` de `openai`, `axios` ou `ioredis` fora de `src/infrastructure/`.
  Verificado por lint, com a regra elevada de aviso para **erro**.
- **CA-002** — O teste dourado (41 cenários) roda **sem `vi.mock` e sem manipular `require.cache`**,
  injetando fakes pelo container, e continua passando.
- **CA-003** — `test/apoio/fakes.js` é **deletado**.
- **CA-004** — A mesma suíte de contrato passa no `RepositorioRedis` e no `RepositorioMemoria`.
- **CA-005** — Sem `REDIS_URL`, o repositório de memória é escolhido **explicitamente** pelo container
  e o boot emite alarme claro; não há mais fallback silencioso dentro do adapter (D-18).
- **CA-006** — A transcrição usa o SDK da OpenAI (D-26).
- **CA-007** — `mediaUrl` de host fora da allow-list é recusada antes de qualquer download (S7).
- **CA-008** — Saída de extração inválida vira extração vazia, sem lançar e sem objeto malformado.
- **CA-009** — Suíte completa continua verde, e a linha de base HTTP permanece idêntica.
- **CA-010** — A suíte continua rodando em menos de 10 segundos.

## 7. Comportamento observável

**Nada muda** para o lead, para o vendedor ou para as rotas — exceto o alarme de Redis ausente
(CA-005) e a recusa de mídia de host desconhecido (CA-007), ambos desejados.

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Fatia grande demais para um passo | **Alta** | Alto | Dividir em PRs por porta, na ordem do §4; cada PR entrega porta + adapter real + fake + contrato |
| Perder um detalhe de tratamento de erro do legado | Média | Alto | Teste dourado e caracterização como contrato; o comportamento de fallback está coberto |
| Allow-list de host bloquear mídia legítima | Média | Alto | Levantar os hosts reais no log de produção **antes**; começar permissivo com alarme |

## 9. Ordem de execução sugerida

1. `Relogio` (menor, destrava testes de tempo)
2. `CanalDeMensagem`
3. `RepositorioDeAtendimento` + suíte de contrato
4. `ExtratorDeInformacoes` e `RedatorDeResposta`
5. `TranscritorDeAudio` e `LeitorDeImagem`
6. `NotificadorDeEquipe`
7. `container.js` e remoção do `fakes.js`
8. Elevar as regras de fronteira do lint para erro

## 10. Questões em aberto

- [ ] **De quais sites vêm as fotos e áudios que os clientes enviam?** Quando alguém manda uma foto no
      WhatsApp, o ChatClean nos passa um link e o bot baixa o arquivo de lá. Para o CA-007 precisamos
      da lista de endereços confiáveis — qualquer outro será recusado. Essa lista tem que sair do log
      do servidor de produção **antes** de a regra ser ligada; ligar às cegas bloquearia mídia
      legítima e o cliente ficaria sem resposta.
- [ ] **O `RelogioDeExpediente` deve ser uma porta separada, ou o `horario.js` já vira serviço de
      domínio nesta fatia?** Sugestão: porta agora, domínio na Fase 3.
