# 11 — Plano de Refatoração (Strangler Fig)

## A estratégia em uma frase

O código novo **nasce ao lado** do legado, o legado **passa a delegar** para ele, e só quando a fatia
estiver validada em produção o caminho antigo **é removido**. Nunca os três passos no mesmo commit.

```
   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
   │   LEGADO    │        │   LEGADO    │        │             │
   │             │   →    │  ↓ delega   │   →    │    NOVO     │
   │             │        │    NOVO     │        │             │
   └─────────────┘        └─────────────┘        └─────────────┘
    1. coexiste            2. delega              3. legado removido
```

## Regras do jogo (inegociáveis)

1. **Fase 0 é pré-requisito de tudo.** Sem rede de testes, não é refatoração — é reescrita às cegas.
2. **Uma fatia por PR.** Não misture extração, correção de bug e renomeação.
3. **Comportamento observável preservado.** Se muda, está escrito na spec e foi aprovado.
4. **Feature toggle onde houver risco real.** Rollback em uma variável de ambiente.
5. **Cada fatia termina com o legado correspondente morto** (ou com a data marcada para matá-lo).
6. **Bug encontrado durante a refatoração vira issue separada.** Não conserte de contrabando — o
   teste de caracterização congelou o comportamento atual de propósito.

## Visão geral das fases

| Fase | Nome | Entrega | Risco | Esforço |
|---|---|---|---|---|
| **0** | Rede de segurança | Testes, lint, CI, config validada, segurança mínima | Nulo | G |
| **1** | ACL da borda | Payload validado e traduzido fora do `index.js` | Baixo | M |
| **2** | Portas e adapters | OpenAI, ChatClean, Redis atrás de interfaces | Médio | G |
| **3** | Domínio | `Atendimento`, VOs, políticas, estado explícito | Médio | GG |
| **4** | Casos de uso | `ProcessarMensagemRecebida` e irmãos | Alto | G |
| **5** | Mídia e envio | Strategy de mídia, política de quebra de mensagem | Baixo | M |
| **6** | Unificação dos testers | Fim do drift triplo | Baixo | P |
| **7** | Prompts como artefato | Versionamento e evals de conversa | Médio | M |
| **8** | Resiliência e escala | Redis para tudo, retry, shutdown, observabilidade | Médio | G |
| **9** | Tipagem (opcional) | JSDoc → TypeScript incremental | Baixo | G |
| **10** | Fim do legado | `index.js` vira bootstrap de 30 linhas | Baixo | P |

Ordem sugerida de entrega em produção: **0 → 1 → 2 → 5 → 3 → 4 → 6 → 7 → 8 → 10** (a Fase 5 vem
cedo porque é isolada e dá confiança no processo; a 9 é opcional e pode rodar em paralelo a partir da 6).

---

# FASE 0 — Rede de segurança

**Objetivo:** poder mexer no código sem medo. **Nada de comportamento muda nesta fase.**

### 0.1 — Ferramental
```bash
npm i -D vitest @vitest/coverage-v8 eslint prettier eslint-plugin-import
```
- `package.json`: scripts `test`, `test:watch`, `coverage`, `lint`, `format`.
- `.eslintrc` com `no-restricted-imports` já preparado para as fronteiras futuras (só avisa por ora).
- **Entregável:** `npm test` roda (mesmo com 1 teste trivial) e `npm run lint` passa.

### 0.2 — Testes unitários do que já é puro
Alvos, em ordem de valor: `flow.js` (state machine, `aplicarCampos` com todos os casos de RN-003,
`detectarPerfil` com precedência), `horario.js` (dia útil, feriado fixo, feriado por env em ambos os
formatos, virada de ano, rótulo "hoje/amanhã/na sexta"), `data.js: lojaParaDepartamento`,
`normalizarPhone`/`nucleoNumero`/`contatoPermitido` (o caso `558491756446:24@s.whatsapp.net` é
obrigatório), `webhookAutorizado`, `dentroDoLimite`.
> `normalizarPhone` e amigos estão dentro do `index.js`. Para testá-los **sem mover nada ainda**,
> exporte-os no final do arquivo (`module.exports = { ... }` guardado por
> `if (require.main !== module)`), ou extraia para `src/shared/telefone.js` já nesta fase — é a única
> extração permitida na Fase 0, por ser trivialmente verificável.

### 0.3 — Testes de caracterização
`parsePayload` é o alvo número um: monte fixtures reais para cada formato (aninhado, WABA, plano,
`numero_cliente`), cada filtro (`fromMe`, grupo por 5 sinais diferentes, ticket com `userId`, ticket
`closed`) e cada campo derivado. Depois `montarResumo` (com e sem dados de simulação, com e sem
expediente) e `determinarProximoCampo` em cada um dos 8 estados.
**Congele o comportamento atual, inclusive o que parecer errado** — anote os achados como issue.

### 0.4 — Testes de integração com fakes (o "teste dourado")
Crie `test/integracao/turno.test.js`: um harness que injeta OpenAI, Push e Redis falsos e roda
`processarMensagem` diretamente. Cenários mínimos: os 15 listados em `.claude/agents/qa-testes.md`.
> Para injetar sem refatorar, use `vi.mock` do Vitest nos módulos `openai`, `axios` e `./store`.
> É feio de propósito — esse teste será reescrito na Fase 4 sobre o caso de uso real.

### 0.5 — Config validada e segurança mínima
- `src/main/config.js`: lê e valida **todas** as 21 variáveis com zod, uma vez, **antes** do
  `app.listen`. Falha rápido com mensagem clara. (Resolve D-23.)
- `.dockerignore` com `.env`, `node_modules`, `.git`, `prints`, `docs`, `test`. (Resolve S8.)
- `LOG_PAYLOAD=false` por padrão em produção — o `PAYLOAD RAW` só sai em desenvolvimento. (S1.)
- `WEBHOOK_SECRET` obrigatório quando `NODE_ENV=production` (fail-closed). (S4.)
- Corrigir `padEnd(128)` em `webhookAutorizado`: hash SHA-256 dos dois lados e `timingSafeEqual`
  sobre os digests — resolve comprimento variável e vazamento de tamanho. (S5.)

### 0.6 — CI
GitHub Actions: `lint` → `test` → `build docker`. Sem chave de API no CI.

**Critério de saída da Fase 0**
- [ ] Cobertura ≥ 70% em `flow.js`, `horario.js`, `data.js` e nos utilitários de telefone
- [ ] `parsePayload` com ≥ 12 casos de caracterização verdes
- [ ] Teste dourado cobrindo os 15 cenários
- [ ] CI verde no `main`
- [ ] `npm start`, `npm run chat` e `npm run sim` funcionando como antes

---

# FASE 1 — ACL da borda (payload de entrada)

**Objetivo:** o formato do ChatClean para de contaminar o resto do sistema.

**Passos**
1. `src/infrastructure/chatclean/acl/PayloadChatCleanSchema.js` — schema zod para os 3 formatos.
2. `src/infrastructure/chatclean/acl/TradutorDePayload.js` — recebe o body, devolve
   `MensagemRecebida | MotivoDeDescarte`. Descarte é **valor tipado**
   (`grupo`, `eco`, `ticket-assumido`, `formato-duplicado`, `desconhecido`), não `null` — hoje todos
   os motivos colapsam em `null` e o log precisa adivinhar.
3. `src/domain/mensageria/MensagemRecebida.js` — VO com `chatId: ChatId`, `contactId`, `msgId`,
   `texto`, `tipo`, `midia`, `citacao`, `nomeContato`.
4. `index.js`: `parsePayload` vira uma casca de 3 linhas que chama o tradutor.
5. Os testes de caracterização da Fase 0 rodam **sem alteração** contra a nova implementação. Esse é
   o critério de sucesso.
6. Deletar o `parsePayload` antigo.

**Ganho imediato:** payload malformado passa a ser rejeitado com motivo claro em vez de virar
`undefined` silencioso; o motivo do descarte vira métrica.

**Risco/mitigação:** — a suíte de caracterização é o contrato. Se algum payload de produção não
casar com o schema, logue e **aceite** (modo permissivo por 1 semana) antes de rejeitar de fato.

---

# FASE 2 — Portas e adapters

**Objetivo:** o sistema para de depender de bibliotecas concretas. É a fase que **destrava todas as
outras** — sem ela, testar o domínio exige mock de módulo.

### 2.1 — `CanalDeMensagem` (saída para o cliente)
Porta: `enviarTexto(chatId, texto)`, `enviarNotaInterna(chatId, texto)`.
Adapters: `CanalChatClean` (extrai `ccPush`/`enviarMensagem`), `CanalEmMemoria` (teste),
`CanalDeTerminal` (usado na Fase 6).
`index.js` passa a chamar a porta. `ccPush` sai do `index.js`.

### 2.2 — `RepositorioDeAtendimento`
Porta: `buscar`, `salvar`, `remover`, `listarIds`, `adquirirLock`, `liberarLock`.
Adapters: `RepositorioRedis`, `RepositorioMemoria` (**explícito**, escolhido pelo `container`, não
mais fallback silencioso — resolve D-18). Suíte de contrato única para os dois.
`store.js` vira o `RepositorioRedis` e sai do caminho crítico.

### 2.3 — `ExtratorDeInformacoes` e `RedatorDeResposta`
Portas: `extrair(mensagem, etapa, historico): Extracao` e `redigir(contexto): string`.
Adapters: `ExtratorOpenAI`, `RedatorOpenAI` — e os fakes determinísticos que tornam o teste dourado
**rápido e sem rede**.
**Aqui entra a validação de schema da extração** (zod): saída inválida do LLM vira `Extracao.vazia()`
em vez de exceção ou objeto torto.

### 2.4 — `TranscritorDeAudio` e `LeitorDeImagem`
`TranscritorWhisper` passa a usar o **SDK oficial** em vez de axios+form-data (D-26).
`LeitorDeImagemOpenAI` valida o host da `mediaUrl` contra uma allow-list (S7).

### 2.5 — `NotificadorDeEquipe`, `RegistroDeLeads`, `RelogioDeExpediente`, `Relogio`
`Relogio` é o que permite testar reativação e reset de 24h sem `setTimeout` real.

### 2.6 — `container.js`
Composition root: instancia todos os adapters conforme a config e injeta. `index.js` para de fazer
`new OpenAI(...)` e `require('./store')`.

**Critério de saída**
- [ ] Nenhum `require('openai'|'axios'|'ioredis')` fora de `src/infrastructure/`
- [ ] Teste dourado roda **sem `vi.mock`**, injetando fakes pelo container
- [ ] Suíte de contrato verde no Redis (via `ioredis-mock` ou container efêmero) e em memória
- [ ] Tempo da suíte de integração < 5s

---

# FASE 3 — O domínio

**Objetivo:** as regras de negócio ganham nome, casa e teste.

### 3.1 — Value Objects primeiro (baixo risco, alto retorno)
`ChatId` (absorve `normalizarPhone`/`nucleoNumero`), `Telefone`, `Cpf` (**com `mascarado()`** — S2),
`Dinheiro`, `Instante`, `ModeloId`, `LojaId`, `Departamento`, `Perfil`, `Objecao`, `EtapaDoFunil`.

### 3.2 — `Atendimento` (agregado raiz)
Nasce com duas factories: `Atendimento.novo(chatId)` e `Atendimento.aPartirDe(dto)` (reidratação do
Redis, com `schemaVersion` e migração dos estados já gravados). Métodos conforme
[05-modelo-de-dominio.md](05-modelo-de-dominio.md).

**Correção obrigatória de bug (D-06):** `proximaEtapa()` é **pura**. A conclusão da qualificação vira
`Atendimento.qualificacaoEstaCompleta()` — consulta sem efeito colateral. Hoje
`montarMsgReativacao` pode marcar um lead como qualificado só por montar um follow-up.
> Este é o único ponto do plano em que uma correção de bug entra junto com a refatoração, porque o
> comportamento atual não é reproduzível de forma sã. Documente na spec e teste os dois caminhos.

### 3.3 — Políticas e serviços de domínio
`PoliticaDeDiagnostico` (RN-001, a regra mais importante do produto — 100% de cobertura),
`PoliticaDeTransbordo` (RN-040..042), `PoliticaDeSobrescrita` (RN-003, migra `aplicarCampos`),
`PoliticaDeReativacao` (RN-070), `ClassificadorDePerfil` (migra `detectarPerfil`),
`MontadorDeResumo` (migra `montarResumo`), `CalculadoraDeEconomia` (**novo** — tira a aritmética das
mãos do LLM).

### 3.4 — `EstadoAtendimento` explícito
Enum + tabela de transições válidas. Transição inválida lança. Resolve D-09.

### 3.5 — `Catalogo`
`data.js` vira o `domain/catalogo`. Conteúdo puro continua onde está; ganha tipos e invariantes
(RN-011: só três modelos; RN-012: preço sempre com emplacamento).

**Estratégia de coexistência:** `flow.js` continua existindo e passa a **delegar** ao domínio novo:
```js
// flow.js — fachada temporária
function determinarProximoCampo(leadData) {
  const a = Atendimento.aPartirDe(leadData);
  const etapa = a.proximaEtapa();
  if (!etapa) leadData.qualificacaoCompleta = true;  // preserva o efeito colateral legado
  return etapa ? { campo: etapa.campo, pergunta: etapa.instrucao } : null;
}
```
Assim os testes de caracterização da Fase 0 continuam verdes enquanto o domínio novo já é o dono da
regra. `flow.js` morre na Fase 4.

---

# FASE 4 — Casos de uso

**A fase mais arriscada.** É onde o `processarMensagem` de 290 linhas é substituído.

**Passos**
1. `ProcessarMensagemRecebida` implementado **em paralelo** ao legado, atrás da flag `FF_USE_CASE`.
2. Teste de equivalência: o mesmo input roda nos dois caminhos com adapters fake determinísticos e o
   estado final é comparado campo a campo.
3. **Shadow mode em produção (1 semana):** o caminho novo executa junto com o antigo, mas
   **não envia mensagem** — só registra divergência de estado no log. Divergência > 0 bloqueia o
   avanço.
4. Vira a chave: `FF_USE_CASE=on`. Monitorar por 1 semana.
5. Remover o `processarMensagem` legado, `flow.js` e o que sobrou de lógica no `index.js`.
6. Extrair os casos de uso satélites: `TransferirParaConsultor`, `ReativarAtendimentoInativo`,
   `ResponderAposTransbordo`, `ResetarAtendimento`.

**Decomposição de `processarMensagem`** (as 290 linhas viram):
| Trecho legado | Vai para |
|---|---|
| lock local + Redis | `ProcessarMensagemRecebida` (guard de entrada) |
| reset por 24h | `Atendimento.expirouPorInatividade()` + `ResetarAtendimento` |
| blindagem anti-loop | `Atendimento.detectarLoop()` + `ControleDeLoop` |
| ramo `finalizado` | `ResponderAposTransbordo` (UC-010) |
| blocos de imagem/áudio/vídeo/documento | `ManipuladorDeMidia` (Fase 5) |
| extração + `aplicarCampos` | `ExtratorDeInformacoes` + `Atendimento.aplicarExtracao()` |
| desvios (cliente atual, pediu humano) | `PoliticaDeTransbordo` + `TransferirParaConsultor` |
| geração + envio | `RedatorDeResposta` + `CanalDeMensagem` |
| notificação de equipe | evento `TransbordoSolicitado` + assinantes |
| agendamento de follow-up | `PoliticaDeReativacao` |

**Rollback:** `FF_USE_CASE=off` e restart. Por isso o legado só morre uma semana depois.

---

# FASE 5 — Mídia e política de envio

*Pode ser antecipada para logo após a Fase 2 — é isolada e dá confiança rápida no processo.*

1. **Strategy de mídia:** `ManipuladorDeTexto`, `ManipuladorDeImagem`, `ManipuladorDeAudio`,
   `ManipuladorDeVideo`, `ManipuladorDeDocumento`, `ManipuladorNaoSuportado`. Cada um decide o texto
   resultante do turno, o que entra no histórico e **se o turno encerra ali**. Resolve o encadeamento
   de `if`s e o acoplamento entre "que mídia é" e "o que fazer" (OCP).
2. **Política de quebra de mensagem (D-08):** substituir a regex frágil por decisão explícita do
   domínio — a resposta carrega a intenção (`resposta-conversacional` vs. `mensagem-de-transbordo`),
   e a política decide quebrar ou não. Não depende mais de a palavra "consultor" aparecer no texto.
3. **Envio fora do lock (D-25):** o `sleep` de digitação sai do bloco crítico do atendimento.

---

# FASE 6 — Unificação dos testers

**Objetivo:** matar D-04 — a dívida mais insidiosa, porque faz as ferramentas de teste mentirem.

`test-chat.js` e `sim-lead.js` passam a ser **~40 linhas cada**: montam um container com
`CanalDeTerminal`, `RepositorioMemoria` e `Relogio` controlável, e chamam
`ProcessarMensagemRecebida`. Zero lógica de conversa própria.

**Ganho:** o que você testa no terminal passa a ser **exatamente** o que roda em produção. Além disso,
`sim-lead.js` vira a base natural da suíte de evals (Fase 7).

---

# FASE 7 — Prompts como artefato versionado

1. Prompts saem de `prompts.js` para `src/infrastructure/openai/prompts/`, com versão explícita
   (`sistema-sdr.v3.js`) e changelog.
2. O conteúdo de negócio continua vindo do catálogo — nenhum preço ou endereço digitado em prompt.
3. **Suíte de evals** (`npm run eval`): roteiros de conversa (o de `sim-lead.js` é o primeiro) rodados
   contra o sistema real, avaliados por LLM-as-judge nas métricas de
   [`.claude/agents/qa-testes.md`](../.claude/agents/qa-testes.md).
4. **Gate:** mudança de prompt exige eval antes/depois no PR. Vazamento de preço antes do diagnóstico
   (RN-001) e "sou uma IA" (RN-020) precisam ficar em 0%.
5. Verificação pós-resposta em produção: a resposta gerada contém `R$` com o diagnóstico incompleto?
   Contém a palavra "parcela" com valor? ⇒ log de alerta + métrica (defesa em profundidade).

---

# FASE 8 — Resiliência, escala e observabilidade

### 8.1 — Estado compartilhado vai para o Redis (D-15)
Idempotência de `msgId`, rate-limit (`INCR` + `EXPIRE`), fila de turnos por chat e o agrupamento.
**Follow-up:** o varredor passa a usar lock distribuído para rodar em uma instância só.
Só depois disso o sistema pode rodar com 2+ instâncias.

### 8.2 — Resiliência (D-17)
`ClienteOpenAI` decorado com retry exponencial + jitter, respeito a `Retry-After` em 429, timeout por
operação e circuit breaker. Mesmo tratamento para o Push do ChatClean, **com alerta** quando a
`CC_PUSH_URL` responde 401/403 (sinal de que a sessão de WhatsApp reconectou e a URL foi regenerada).

### 8.3 — Graceful shutdown (D-16)
Parar de aceitar webhooks → drenar a fila → liberar locks → fechar Redis → sair, com timeout máximo.

### 8.4 — Observabilidade (D-20)
`pino` com JSON, níveis, `requestId`/`chatId` como campos e **redaction de PII nativa** (S1).
Métricas: mensagens recebidas, respostas enviadas, leads qualificados, transbordos por loja, latência
p95 da OpenAI, tokens/custo por dia, taxa de erro do Push, descartes por motivo.

### 8.5 — LGPD (S2, S3, S9, RN-092)
CPF mascarado em log e no resumo interno; PII criptografada em repouso ou tokenizada; TTL na lista de
leads; rota administrativa de expurgo/anonimização por titular.

---

# FASE 9 — Tipagem (opcional, recomendada)

Incremental, sem big bang: `checkJs` no `jsconfig.json` → JSDoc nas portas e VOs → `.d.ts` para os
contratos → migração arquivo a arquivo para `.ts` começando pelo `domain/` (que não tem I/O e é o mais
fácil). Pode rodar em paralelo às fases 6–8.

---

# FASE 10 — Fim do legado

`index.js` fica assim:
```js
require('dotenv').config();
const config = require('./src/main/config');
const container = require('./src/main/container');
const { iniciarServidor } = require('./src/infrastructure/http/servidor');
const { registrarAgendadores } = require('./src/main/agendadores');
const { instalarShutdownGracioso } = require('./src/main/shutdown');

const app = container.criar(config);
const servidor = iniciarServidor(app, config);
registrarAgendadores(app);
instalarShutdownGracioso(servidor, app);
```
Deletar: `flow.js`, `store.js`, o `pipeline.js` legado e o que restar de `data.js`/`prompts.js` fora
de `src/`. Atualizar `README.md` e `CLAUDE.md`.

---

## Métricas de progresso

| Indicador | Antes | Meta |
|---|---|---|
| Linhas em `index.js` | 1040 | < 30 |
| Maior arquivo | 1040 | < 250 |
| Cobertura de testes | 0% | > 80% (domínio: 95%) |
| Implementações do turno de conversa | 3 | 1 |
| Tempo da suíte de testes | — | < 10s |
| `require` de infra no domínio | n/a | 0 (garantido por lint) |
| Instâncias suportadas | 1 | N |
| Regras de negócio com ID e teste | 0 | 100% das |

## Riscos do projeto e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Regressão silenciosa na conversa (o LLM "responde diferente") | Alta | Evals com métricas de taxa; shadow mode na Fase 4 |
| Refatoração longa demais, negócio pede feature no meio | Alta | Fatias pequenas e entregáveis; feature nova entra pelo caminho novo |
| Estado no Redis incompatível após mudança de schema | Média | `schemaVersion` + migração na leitura, desde a Fase 3 |
| Custo de OpenAI subir com os evals | Média | Evals em CI só no PR que toca prompt; `gpt-4o-mini` como juiz |
| Perda de conhecimento tácito do dev original | Média | Esta documentação; testes de caracterização como especificação executável |
| "Já que estamos mexendo, vamos melhorar X" | **Alta** | Escopo da spec é contrato; melhoria vira issue nova |

## Sugestões que valem mais do que parecem

1. **Comece pela Fase 0 mesmo com pressa.** Cada dia refatorando sem teste é dívida com juros.
2. **Faça a Fase 5 logo depois da 2.** É pequena, isolada, e a equipe ganha confiança no ritual
   (spec → teste → fatia → revisão) antes de encarar o domínio.
3. **`CalculadoraDeEconomia` é melhoria de produto, não de código.** Hoje o LLM faz a conta anual —
   e LLM erra aritmética. Uma conta certa é o argumento central da venda.
4. **Meça a taxa de vazamento de RN-001 antes de refatorar.** Você provavelmente vai descobrir que
   não é 0% hoje. Ter o número de partida transforma "achamos que melhorou" em "caiu de 4% para 0%".
5. **`pipeline.js`: decida antes de refatorar.** Ligar a criação de oportunidade no CRM é uma feature
   de negócio com valor real (o vendedor vê o card no funil). Se não for ligar, delete — código morto
   com comentários de outro projeto envenena a leitura.
6. **Resolva o conflito de horário (D-19) com o cliente antes da Fase 3.** É a única dívida que exige
   decisão externa, e ela trava a modelagem do contexto de Expediente.
7. **Grave payloads reais de produção** (anonimizados) desde já. Eles são as melhores fixtures da
   Fase 1 e você não vai conseguir inventá-los depois.
8. **Não migre para TypeScript antes da Fase 6.** Tipar três implementações divergentes do mesmo turno
   é tipar a bagunça.
