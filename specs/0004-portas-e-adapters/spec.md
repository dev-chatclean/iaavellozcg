# SPEC 0004 — Portas e adapters

| | |
|---|---|
| **Status** | Aprovada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 · revisada em 2026-08-12 |
| **Fase do plano** | Fase 2 — Portas e adapters |
| **Dívida endereçada** | D-02, D-26 |
| **Depende de** | SPEC 0001, SPEC 0002, SPEC 0003 |

> **Revisão de escopo (2026-08-12).** Dois critérios saíram por mudarem comportamento: o alarme de
> Redis ausente (D-18) e a recusa de mídia de endereço desconhecido (S7). Esta fatia é **estritamente
> estrutural**: as mesmas chamadas, para os mesmos destinos, com as mesmas respostas — só que atrás
> de interfaces. Os dois itens viram spec própria, para quando o negócio quiser.

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
- **Qualquer mudança de comportamento.** Mesmas chamadas, mesmos destinos, mesmas respostas.
- Alarme quando o Redis está ausente (D-18) — muda o boot; spec 0019.
- Recusar mídia de endereço fora de uma lista (S7) — muda o atendimento; spec 0019.
- Corrigir o `mediaMimetype` vazio e o `nomeContato` vazio no formato WABA — dívida documentada,
  não corrigida nesta fatia.
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
- **CA-003** — `test/apoio/fakes.js` deixa de manipular `require.cache`: passa a construir **adapters
  fake das portas**, injetados pelo container.
- **CA-004** — A mesma suíte de contrato passa no `RepositorioRedis` e no `RepositorioMemoria`.
- **CA-005** — A escolha entre Redis e memória passa a ser feita **no container**, não dentro do
  adapter. O comportamento observável é o mesmo de hoje: sem `REDIS_URL`, usa memória.
- **CA-006** — A transcrição usa o SDK da OpenAI em vez de `axios` + `form-data` montado à mão (D-26),
  enviando a mesma requisição para o mesmo endpoint.
- **CA-007** — Todos os 320 testes existentes continuam verdes **sem alteração**.
- **CA-008** — A linha de base HTTP permanece idêntica, e o log do servidor também.
- **CA-009** — A suíte continua rodando em menos de 10 segundos.

## 7. Comportamento observável

**Nada muda.** Nem para o lead, nem para o vendedor, nem para as rotas, nem para o log. Se algum
teste precisar ser ajustado, a fatia está errada.

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Fatia grande demais para um passo | **Alta** | Alto | Executar na ordem do §9, rodando a suíte a cada porta |
| Perder um detalhe de tratamento de erro do legado | Média | Alto | Teste dourado e caracterização como contrato; o comportamento de fallback está coberto |
| Mudar comportamento sem perceber ao mover código | Média | Alto | CA-007 e CA-008: nenhum teste alterado, linha de base idêntica |

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

- [ ] O `RelogioDeExpediente` deve ser uma porta separada, ou o `horario.js` já vira serviço de
      domínio nesta fatia? Sugestão: porta agora, domínio na Fase 3.
