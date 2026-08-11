# 10 — Arquitetura Alvo

Destino da estrangulação. **Não é para ser construída de uma vez** — cada fase do
[plano](11-plano-refatoracao-strangler.md) constrói um pedaço.

## Princípios

1. **Dependências apontam para dentro.** `domain` ← `application` ← `infrastructure` ← `main`.
2. **O domínio não sabe que existe internet.** Nenhum `require('openai'|'axios'|'ioredis'|'express')`,
   nenhum `process.env`, `Date.now()`, `Math.random()` ou `console.*` dentro de `domain/`.
3. **Portas finas por capacidade**, não por sistema. `ChatCleanPort` que faz tudo viola ISP.
4. **Toda porta nasce com um fake.** Mesma suíte de contrato roda no real e no fake.
5. **Composition root manual.** DI explícita em `main/`, sem container mágico nem decorators.
6. **Erros esperados são valores** (`Result`), erros inesperados são exceções.
7. **Simplicidade proporcional.** Sem CQRS, sem event sourcing, sem microsserviços. O volume não
   justifica e a complexidade custaria mais do que resolve.

## Estrutura de diretórios

```
src/
├── domain/                              ← puro, testável sem mocks
│   ├── atendimento/
│   │   ├── Atendimento.js               (agregado raiz)
│   │   ├── Qualificacao.js
│   │   ├── DadosSimulacao.js
│   │   ├── HistoricoConversa.js
│   │   ├── ControleDeLoop.js
│   │   ├── EstadoAtendimento.js         (VO/enum + transições válidas)
│   │   ├── EtapaDoFunil.js              (ordem oficial + instrução por etapa)
│   │   ├── Perfil.js · Objecao.js
│   │   ├── politicas/
│   │   │   ├── PoliticaDeDiagnostico.js (RN-001)
│   │   │   ├── PoliticaDeTransbordo.js  (RN-040..042)
│   │   │   ├── PoliticaDeReativacao.js  (RN-070)
│   │   │   └── PoliticaDeSobrescrita.js (RN-003)
│   │   ├── servicos/
│   │   │   ├── ClassificadorDePerfil.js (RN-005)
│   │   │   ├── CalculadoraDeEconomia.js ← NOVO: projeção anual no domínio
│   │   │   └── MontadorDeResumo.js      (RN-043)
│   │   └── eventos/                     (TransbordoSolicitado, LoopDetectado, …)
│   ├── catalogo/
│   │   ├── Modelo.js · Preco.js · FormaPagamento.js · Loja.js
│   │   └── Catalogo.js                  (hoje: data.js)
│   ├── expediente/
│   │   ├── Expediente.js · CalendarioDeFeriados.js
│   ├── crm/
│   │   └── Departamento.js              (RN-041)
│   └── shared/
│       ├── ChatId.js · Telefone.js · Cpf.js · Dinheiro.js · Instante.js
│       ├── Result.js
│       └── DomainEvent.js
│
├── application/                         ← orquestra, não decide regra
│   ├── casos-de-uso/
│   │   ├── ProcessarMensagemRecebida.js     (UC-001, 009, 011, 015, 016)
│   │   ├── TransferirParaConsultor.js       (UC-005, 006, 007)
│   │   ├── ReativarAtendimentoInativo.js    (UC-012)
│   │   ├── ResponderAposTransbordo.js       (UC-010)
│   │   ├── ResetarAtendimento.js            (UC-014)
│   │   └── ConsultarDiagnosticoDoServico.js (UC-017)
│   ├── portas/                          ← interfaces (contratos)
│   │   ├── CanalDeMensagem.js
│   │   ├── RepositorioDeAtendimento.js
│   │   ├── ExtratorDeInformacoes.js
│   │   ├── RedatorDeResposta.js
│   │   ├── TranscritorDeAudio.js · LeitorDeImagem.js
│   │   ├── NotificadorDeEquipe.js · RegistroDeLeads.js
│   │   ├── ControleDeIdempotencia.js · ControleDeVazao.js
│   │   ├── Relogio.js · GeradorDeId.js · Logger.js
│   │   └── PublicadorDeEventos.js
│   └── midia/
│       └── ManipuladorDeMidia.js        (Strategy: texto|imagem|audio|video|documento)
│
├── infrastructure/                      ← adapters, o único lugar com I/O
│   ├── openai/
│   │   ├── ExtratorOpenAI.js · RedatorOpenAI.js
│   │   ├── TranscritorWhisper.js · LeitorDeImagemOpenAI.js
│   │   ├── ClienteOpenAI.js             (retry, backoff, timeout, métrica de token)
│   │   └── prompts/                     (SYSTEM_SDR, extração, resposta — versionados)
│   ├── chatclean/
│   │   ├── CanalChatClean.js            (Push API)
│   │   ├── NotificadorChatClean.js      (nota interna + WhatsApp da equipe)
│   │   ├── PipelineOportunidades.js     (assinante de TransbordoSolicitado)
│   │   └── acl/
│   │       ├── PayloadChatCleanSchema.js  (validação: zod)
│   │       └── TradutorDePayload.js       (3 formatos → MensagemRecebida) ← ACL
│   ├── redis/
│   │   ├── RepositorioRedis.js · IdempotenciaRedis.js · VazaoRedis.js
│   │   ├── FilaDeTurnosRedis.js
│   │   └── MapeadorDeAtendimento.js     (Atendimento ⇄ DTO versionado)
│   ├── memoria/                         (equivalentes em memória — dev/teste, explícitos)
│   ├── http/
│   │   ├── servidor.js
│   │   ├── rotas/ (webhook, health, diag, leads)
│   │   └── middlewares/ (autenticacao, correlacao, erros)
│   └── observabilidade/
│       ├── LoggerPino.js                (redaction de PII)
│       └── Metricas.js
│
└── main/
    ├── config.js                        (env validado com zod, uma vez, no boot)
    ├── flags.js                         (feature toggles das fatias)
    ├── container.js                     (composition root)
    ├── agendadores.js                   (varredor de reativação)
    └── index.js                         (bootstrap + graceful shutdown)

test/
├── unidade/            domínio puro
├── caracterizacao/     congela o comportamento do legado
├── contrato/           mesma suíte no adapter real (gravado) e no fake
├── integracao/         casos de uso com adapters fake
└── eval/               roteiros de conversa avaliados por LLM-as-judge
```

## Fluxo de uma mensagem na arquitetura alvo

```
POST /webhook
   │  middleware: correlação (requestId) → autenticação → rate-limit
   ▼
TradutorDePayload (ACL)  ── valida schema (zod), traduz 3 formatos → MensagemRecebida
   │                        aplica filtros de RN-050/051/052
   ▼
ControleDeIdempotencia (Redis)  ── msgId já visto? descarta
   │
   ▼
FilaDeTurnos (Redis)  ── enfileira, agrupa rajada de texto, drena em série por chatId
   │
   ▼
ProcessarMensagemRecebida (caso de uso)
   ├─ RepositorioDeAtendimento.buscar(chatId) + lock
   ├─ Atendimento.expirouPorInatividade(agora)?  → reinicia         (RN-071)
   ├─ Atendimento.detectarLoop(agora)?           → pausa + evento   (RN-054)
   ├─ ManipuladorDeMidia.tratar(mensagem)  ── Strategy por tipo     (UC-009)
   │     └─ usa TranscritorDeAudio / LeitorDeImagem
   ├─ ExtratorDeInformacoes.extrair(...)   ── saída validada por schema
   ├─ Atendimento.aplicarExtracao(extracao)                          (RN-003)
   ├─ Atendimento.exigeTransbordo()?  → TransferirParaConsultor      (UC-005/006/007)
   ├─ RedatorDeResposta.redigir(Atendimento.contextoParaResposta())  (RN-001 embutida)
   ├─ CanalDeMensagem.enviarTexto(...)   ── fora do lock
   ├─ Atendimento.registrarRespostaDoBot(...)
   ├─ Atendimento.agendarReativacao(agora)                           (RN-070)
   └─ RepositorioDeAtendimento.salvar + liberar lock
        │
        └─ PublicadorDeEventos → TransbordoSolicitado
              ├─ NotificadorDeEquipe (nota interna + WhatsApp)
              ├─ RegistroDeLeads
              └─ PipelineOportunidades (opcional, por flag)
```

## Design patterns e onde se aplicam

| Padrão | Onde | Por quê |
|---|---|---|
| **Ports & Adapters** | Todo o contorno | Testar sem rede; trocar provedor sem tocar no core |
| **Repository** | `RepositorioDeAtendimento` | Persistência atrás de interface, com schema versionado |
| **Anti-Corruption Layer** | `TradutorDePayload` | Três formatos de payload não contaminam o domínio |
| **Strategy** | `ManipuladorDeMidia` | Novo tipo de mídia = nova classe, não `if` novo (OCP) |
| **State** | `EstadoAtendimento` | Transições explícitas e validadas (resolve D-09) |
| **Specification / Policy** | `PoliticaDeDiagnostico`, `PoliticaDeTransbordo` | Regra crítica isolada e testável (RN-001, RN-040) |
| **Domain Events** | `TransbordoSolicitado` | Liga/desliga integrações (CRM, métricas) sem tocar no core |
| **Result / Either** | Chamadas externas | Falha esperada sem `try/catch` espalhado |
| **Factory** | `Atendimento.novo()`, `Atendimento.aPartirDe(dto)` | Construção válida por definição |
| **Decorator** | `ClienteOpenAI` (retry, métrica, cache) | Resiliência sem poluir o adapter |
| **Facade** | Legado durante a transição | `index.js` delega às fatias novas |
| **Feature Toggle** | `main/flags.js` | Rollback em uma variável de ambiente |

## Como SOLID aparece concretamente

- **SRP** — `index.js` (8 responsabilidades) vira ~30 arquivos com uma cada.
- **OCP** — nova loja: entrada no catálogo. Novo tipo de mídia: nova Strategy. Nova objeção: entrada
  no catálogo de objeções. Nenhum `if` existente é editado.
- **LSP** — `RepositorioRedis` e `RepositorioMemoria` passam na mesma suíte de contrato.
- **ISP** — `CanalDeMensagem` (falar com o cliente) é separado de `NotificadorDeEquipe` (falar com a
  equipe) e de `PipelineOportunidades`, mesmo os três batendo no ChatClean.
- **DIP** — `ProcessarMensagemRecebida` recebe `ExtratorDeInformacoes`; quem decide que é OpenAI é o
  `container.js`.

## Regras de fronteira (verificáveis por lint)

```js
// .eslintrc — no-restricted-imports por diretório
'src/domain/**'      → proibido: openai, axios, ioredis, express, fs, path, dotenv,
                                  '../../infrastructure/*', '../../application/*'
'src/application/**' → proibido: openai, axios, ioredis, express,
                                  '../../infrastructure/*'
'src/infrastructure/**' → permitido tudo, exceto importar de 'main/'
```

Essa regra é o que **impede a arquitetura de apodrecer** depois da refatoração. Sem ela, em três
meses o `domain` volta a importar `axios`.

## O que fica de fora (decisões conscientes)

| Não faremos | Por quê |
|---|---|
| Microsserviços | Um processo atende o volume com folga; a complexidade operacional não se paga. |
| Event Sourcing / CQRS completo | O histórico de conversa já é o log; auditoria não exige replay de eventos. |
| Container de DI com decorators | Composition root manual é mais simples de ler e depurar em Node. |
| Banco relacional | Redis atende; o dado é efêmero por natureza (TTL 30 dias). |
| ORM | Não há modelo relacional. |
| Reescrita em outra linguagem | Não resolve nenhum dos problemas reais. |
