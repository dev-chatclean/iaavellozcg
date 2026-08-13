# 14 — Handoff da Refatoração

**Para quem vai assumir o projeto.** Este documento responde três perguntas, nesta ordem:
o que o sistema faz, o que mudou (e o que **não** mudou), e quais decisões dependem de você.

Leia inteiro antes de tocar em código. São 15 minutos, e evitam refazer trabalho ou reintroduzir
defeitos já mapeados.

| | |
|---|---|
| **Branch** | `refatoracao/arquitetura-ddd` — **nunca mesclada na `main`** |
| **Commits** | 30 |
| **Período** | 2026-08-11 a 2026-08-12 |
| **Em produção?** | **Não.** Nada disto foi implantado. A `main` segue no código original. |

---

## 1. O que é este sistema

SDR virtual da **Avelloz Campina — Realliza Motos**, concessionária com três unidades (Matriz e
Malvinas em Campina Grande, e Monteiro). Atende leads pelo WhatsApp através da plataforma ChatClean
e entrega ao vendedor humano.

**O que o diferencia de um chatbot qualquer é a metodologia comercial**, e ela é inegociável:

> O bot **não revela preço, modelo nem condição de pagamento** antes de entender como o cliente se
> locomove hoje, quanto gasta com isso e se já tem moto. Só depois disso mostra a conta anual do
> gasto atual, recomenda o modelo e coleta os dados de simulação.

Isso é a RN-001. Quebrar essa regra destrói a proposta comercial: preço solto vira comparação com
concorrente e o lead some. Tudo neste projeto — testes, políticas de domínio, analisadores de eval —
existe em boa parte para proteger essa regra.

O catálogo tem três modelos (AZ1, AZ125, AZX160), sempre apresentados com preço promocional já
incluindo emplacamento. **O bot nunca informa valor de parcela** (RN-010): isso depende de análise de
crédito e é responsabilidade do consultor humano.

Contexto completo: [00-visao-geral.md](00-visao-geral.md) · regras: [03-regras-de-negocio.md](03-regras-de-negocio.md)

---

## 2. A pergunta que importa: o comportamento mudou?

**Para o cliente que conversa com o bot: praticamente não.** Duas exceções, ambas pedidas pelo
negócio. Para o código: mudou tudo.

### 2.1 O que NÃO mudou (a esmagadora maioria)

- O texto dos prompts é **byte a byte o mesmo**.
- Os modelos, temperaturas e parâmetros da OpenAI são os mesmos.
- O funil, a política de sobrescrita de campos, a classificação de perfil, as objeções: idênticos.
- O resumo entregue ao vendedor: idêntico, campo a campo.
- As rotas HTTP e suas respostas: idênticas.
- Os filtros de entrada (grupo, eco, ticket assumido, duplicata, rate-limit): idênticos.
- O tratamento de áudio, vídeo, imagem e documento: idêntico, inclusive os timeouts diferentes
  (60s vídeo, 30s áudio) e as assimetrias herdadas.

**Como isso é garantido:** 459 testes automatizados, dos quais 50 são testes de caracterização
escritos **antes** de qualquer alteração, que congelam o comportamento do código original. Mais uma
linha de base executável que sobe o servidor de verdade e compara todas as rotas.

### 2.2 O que MUDOU, e por quê

Cinco mudanças de comportamento, todas deliberadas e aprovadas:

| # | O que mudou | Por quê | Spec |
|---|---|---|---|
| 1 | **Sábado agora é dia de atendimento** (08h–18h) | O negócio confirmou que a loja atende sábado. Antes, todo lead de sábado caía em modo plantão e chegava ao vendedor etiquetado "FORA DE EXPEDIENTE" — com a loja aberta | 0009 |
| 2 | **O modo plantão chega ao texto da resposta** | O parâmetro `expediente` era passado ao prompt e **ignorado**. À meia-noite de domingo o bot prometia "o consultor assume rapidinho". Defeito real, corrigido | 0009 |
| 3 | **Configuração inválida derruba o boot** | Antes o processo subia quebrado e falhava atendendo cliente. Agora encerra listando todos os problemas, antes de abrir a porta | 0002 |
| 4 | **`WEBHOOK_SECRET` obrigatório em produção** | Com o segredo vazio, qualquer um podia injetar conversas e queimar crédito da OpenAI. Ver §7 — **exige ação sua no deploy** | 0002 |
| 5 | **Log deixou de conter dados pessoais** | O payload bruto era impresso inteiro: nome, telefone e, na etapa de simulação, CPF, nascimento e CNH | 0002 |

Mais duas mudanças de superfície administrativa, sem efeito no atendimento:

- `/diag` não traz mais o bloco `pipeline` (era código morto que expunha "REUNIÃO MARCADA",
  nomenclatura de outro projeto).
- `/leads` não monta mais o campo `empresa` — que era sempre `undefined` e já sumia na
  serialização. **A resposta HTTP é literalmente a mesma.**

### 2.3 O que mudou nas ferramentas de desenvolvimento

`npm run chat` e `npm run sim` agora usam **o mesmo código de produção**. Antes reimplementavam a
conversa e já divergiam (não usavam `response_format: json_object`, não aplicavam `tipoContato`, não
reavaliavam o perfil). Você testava um comportamento que não era o real.

Consequência prática: os testers agora têm o atraso de digitação, o follow-up e o reset por
inatividade, como em produção.

---

## 3. Antes e depois

### 3.1 Estrutura

```
ANTES (1.500 linhas úteis, 9 arquivos)     DEPOIS (4.400 linhas, 43 arquivos em src/)

index.js         1040  God Object          index.js  95  bootstrap
  config por env                             montar(config, deps) + iniciar(sistema)
  servidor HTTP                            
  autenticação                             src/main/          290  config validada, container
  parse de 3 formatos de payload           src/domain/        962  regras de negócio
  dedup, rate-limit, anti-loop             src/application/   939  casos de uso, fila, mídia, portas
  fila e agrupamento                       src/infrastructure/ 1534 HTTP, OpenAI, ChatClean, Redis
  mídia (imagem, áudio, vídeo, doc)        src/shared/         76  telefone, mascaramento
  chamadas OpenAI                          src/eval/          337  analisadores e roteiros
  máquina de estados
  resumo, notificação, transbordo          test/             3885  459 testes
  follow-up
  endpoints administrativos
  bootstrap

prompts.js        195                      src/infrastructure/openai/prompts/v1.js (versionado)
data.js           178                      src/domain/catalogo/Catalogo.js
flow.js            73                      src/domain/atendimento/ (Funil, EtapaDoFunil, ...)
horario.js        100                      src/domain/expediente/Expediente.js
store.js          124                      src/infrastructure/redis/ + memoria/
pipeline.js       111  (morto)             REMOVIDO
test-chat.js      116  (turno próprio)     test-chat.js  78  usa o caso de uso
sim-lead.js       140  (turno próprio)     sim-lead.js   80  usa o caso de uso
```

### 3.2 Indicadores

| Indicador | Antes | Depois |
|---|---:|---:|
| Testes automatizados | **0** | **459** (rodam em 3s, sem rede, sem custo) |
| Cobertura do domínio | 0% | 100% |
| Erros de lint | (não havia lint) | 0 |
| Erros de tipo | (não havia verificação) | 0 |
| Implementações do turno de conversa | 3 divergentes | 1 |
| `require` de infraestrutura no `index.js` | 4 | 0 |
| Variáveis de ambiente validadas | 1 (e depois do `listen`) | 21 (antes do `listen`) |
| Dados pessoais no log | 13 payloads por roteiro | 0 |

### 3.3 A ordem em que as coisas saíram do `index.js`

Isso importa para entender o histórico do git:

| Spec | O que saiu | `index.js` fica com |
|---|---|---:|
| 0001 | utilitários de telefone | 1040 |
| 0003 | parse do payload (virou ACL) | 990 |
| 0004 | OpenAI, ChatClean, Redis (viraram portas) | 907 |
| 0005 | tratamento de mídia (virou Strategy) | 839 |
| 0006 | regras de negócio (viraram domínio) | 812 |
| 0008 | o turno inteiro (virou caso de uso) | 437 |
| 0018 | servidor, rotas, fila, proteções | **95** |

---

## 4. Como o sistema funciona hoje

### 4.1 O caminho de uma mensagem

```
Cliente WhatsApp
   ↓
ChatClean  ──POST /webhook──▶  src/infrastructure/http/servidor.js
                                 │
                                 ├─ autenticação do webhook (digest SHA-256)
                                 ├─ traduzirPayload → ACL (src/infrastructure/chatclean/acl/)
                                 │    3 formatos → MensagemRecebida, ou motivo de descarte nomeado
                                 ├─ allow-list, rate-limit, deduplicação
                                 └─ fila (src/application/fila/FilaDeTurnos.js)
                                      agrupa mensagens de texto em rajada; mídia drena na hora
                                        ↓
                        src/application/casos-de-uso/ProcessarMensagemRecebida.js
                                 │
                                 ├─ lock (memória + Redis)
                                 ├─ reset por 24h de inatividade
                                 ├─ blindagem anti-loop
                                 ├─ mídia → Strategy (src/application/midia/)
                                 ├─ extração ────────▶ porta ExtratorDeInformacoes
                                 ├─ aplica campos ───▶ domínio (Qualificacao, RN-003)
                                 ├─ transbordo? ─────▶ domínio (PoliticaDeTransbordo)
                                 ├─ redige ──────────▶ porta RedatorDeResposta
                                 │                      (o prompt carrega RN-001 via
                                 │                       PoliticaDeDiagnostico)
                                 ├─ envia ───────────▶ porta CanalDeMensagem
                                 └─ salva ───────────▶ porta RepositorioDeAtendimento
                                        ↓
                        ChatClean Push API ──▶ Cliente WhatsApp
```

### 4.2 A regra de ouro da arquitetura

**Dependências apontam para dentro.** O domínio não sabe que existe internet:

```
main/  ──▶  infrastructure/  ──▶  application/  ──▶  domain/
(monta)      (adapters)            (orquestra)        (regras)
```

Isso é **verificado por lint, e a verificação foi testada com violação proposital**. Se você escrever
`require('axios')` em `src/domain/`, o CI falha. Se ler `process.env` no domínio, o CI falha.

> Atenção histórica: a primeira versão dessa regra usava `no-restricted-imports`, que só enxerga
> `import` de ESM. O projeto é CommonJS, então a regra **não barrava nada** — dava sensação de
> proteção sem proteger. Hoje usa `no-restricted-syntax` sobre a chamada `require()`. Se for
> mexer nessa regra, **teste com um arquivo de violação proposital antes de confiar nela.**

### 4.3 Onde encontrar cada coisa

| Preciso mexer em… | Vá para |
|---|---|
| O que o bot fala / persona / regras no prompt | `src/infrastructure/openai/prompts/` |
| Ordem do funil, política de sobrescrita | `src/domain/atendimento/` |
| Quando pode revelar preço (RN-001) | `src/domain/atendimento/politicas/PoliticaDeDiagnostico.js` |
| Para quem transferir o lead | `src/domain/atendimento/politicas/PoliticaDeTransbordo.js` |
| Modelos, preços, lojas, objeções | `src/domain/catalogo/Catalogo.js` |
| Horário de atendimento e feriados | `src/domain/expediente/Expediente.js` |
| O resumo que o vendedor recebe | `src/domain/atendimento/MontadorDeResumo.js` |
| Formato do payload do ChatClean | `src/infrastructure/chatclean/acl/` |
| Rotas, autenticação, rate-limit | `src/infrastructure/http/` |
| Qual adapter é usado | `src/main/container.js` |
| Variáveis de ambiente | `src/main/config.js` |

---

## 5. Como saber que você não quebrou nada

Três ferramentas, nesta ordem:

```bash
npm test          # 459 testes, ~3s, sem rede e sem custo de OpenAI
npm run lint      # 0 erros
npm run typecheck # 0 erros em domínio, aplicação e compartilhado

# linha de base: sobe o servidor de verdade e compara todas as rotas
bash test/baseline/coletar-baseline.sh minha-mudanca
diff test/baseline/antes-da-refatoracao-requisicoes.log test/baseline/minha-mudanca-requisicoes.log
```

**Diff vazio + suíte verde = você não mudou comportamento observável.**

E, quando mexer em prompt:

```bash
npm run eval      # ATENÇÃO: gasta crédito real da OpenAI
```

Roda cinco roteiros de conversa contra o sistema real e mede violações de RN-001, RN-010, RN-020,
RN-021 e RN-022. Rode **antes e depois** e compare.

### O que cada tipo de teste protege

| Tipo | Quantidade | O que garante |
|---|---:|---|
| Caracterização | 66 | Que o comportamento do código **original** foi preservado |
| Unidade | 300+ | Cada regra de negócio isolada |
| Contrato | 28 | Que trocar Redis por memória não muda nada para quem consome |
| Integração ("teste dourado") | 44 | O turno completo, ponta a ponta, com adapters falsos |

Alguns testes têm a marca **`CONGELA`** no nome. Eles documentam um defeito **de propósito**: afirmam
o comportamento errado atual, para que a correção futura seja deliberada. Se um deles falhar, ou você
corrigiu o defeito (e deve inverter o teste) ou quebrou algo sem querer.

---

## 6. As dívidas restantes — o que você precisa decidir

Todas mudam comportamento. Nenhuma foi tocada porque a orientação do projeto foi clara: **mudança de
comportamento só quando pedida**. Aqui está o que você precisa para decidir cada uma.

### 6.1 D-15 — O sistema só é seguro com UMA instância

**O que acontece hoje:** deduplicação de mensagens, rate-limit, fila e agrupamento vivem na memória
do processo. O lock de atendimento é distribuído (Redis), mas o resto não.

**Se subir uma segunda instância:** mensagens duplicadas para o cliente, rate-limit multiplicado
pelo número de instâncias, agrupamento de mensagens quebrado, e o follow-up de reativação enviado
uma vez por instância.

**Risco de não corrigir:** nenhum enquanto rodar uma instância só. **Mas isso não está escrito em
lugar nenhum da infra** — quem escalar por engano quebra o atendimento sem saber por quê.

**Esforço:** médio. Mover quatro estruturas para o Redis (`INCR`+`EXPIRE` para vazão, `SET NX` para
idempotência, lista para a fila, lock para o varredor).

**Decisão que você precisa tomar:** vai escalar? Se não, no mínimo documente na infra que o serviço
é single-instance. Spec 0012.

### 6.2 D-16 — Todo deploy perde atendimentos em andamento

**O que acontece hoje:** `SIGTERM` chama `process.exit(0)` imediatamente. Turnos em voo e mensagens
na fila morrem. O lock do Redis fica pendurado até o TTL de 60s.

**Agravante medido:** o estado do atendimento é gravado **uma única vez, no fim do turno**, depois
das duas chamadas à OpenAI. Durante 1 a 3 segundos, nada do que o cliente disse existe fora da
memória do processo. Um restart nessa janela apaga o turno inteiro — o cliente falou no vazio.

Isso foi observado empiricamente durante a refatoração: nas coletas de linha de base, atendimentos
apareciam ou não conforme a latência da rede. **Confirmado também no código original** — não é
regressão, é característica do desenho.

**Esforço:** médio. Parar de aceitar webhooks, drenar a fila, liberar locks, fechar o Redis, com
timeout máximo.

**Decisão:** com que frequência vocês fazem deploy? Se for raro e fora do horário comercial, o
impacto é pequeno. Spec 0014.

### 6.3 D-17 — Falha no envio é silêncio total

**O que acontece hoje:** nenhuma chamada externa tem retry. Uma instabilidade de 2s da OpenAI vira
"Opa, tive uma instabilidade rapidinha" para o cliente. Uma falha no Push do ChatClean significa que
**o cliente simplesmente não recebe a resposta, e ninguém fica sabendo**.

**Ponto de atenção específico:** a `CC_PUSH_URL` é **regenerada quando a sessão de WhatsApp
reconecta** no painel do ChatClean. Quando isso acontece, o bot para de responder silenciosamente
até alguém atualizar a variável. Um alerta em 401/403 do Push resolveria.

**Esforço:** médio. Backoff exponencial com jitter, respeito a `Retry-After` em 429, circuit breaker.

**Decisão:** quantos leads vocês perderiam num incidente silencioso de uma hora? Spec 0013.

### 6.4 D-06 — Consultar o funil qualifica o lead

**O que acontece hoje:** `determinarProximoCampo(lead)` é uma **consulta que muta o objeto** — marca
`qualificacaoCompleta = true` quando o funil está completo. Ela é chamada duas vezes por turno e,
crucialmente, também dentro de `montarMsgReativacao`. Ou seja: **montar uma mensagem de follow-up
para um lead com funil completo o marca como qualificado.**

**O domínio já está limpo:** `EtapaDoFunil.proxima()` é pura, com teste que prova. O efeito colateral
vive apenas na fachada `src/domain/atendimento/Funil.js`, preservado de propósito.

**Esforço:** pequeno. Mas mude com cuidado: verifique se algum caminho depende de o flag ser marcado
ali (o transbordo por qualificação completa lê esse flag).

**Decisão:** é um defeito real, mas de impacto raro. Spec 0021.

### 6.5 S2 e S3 — CPF exposto

**O que acontece hoje:** o resumo enviado à equipe (nota no ticket **e** WhatsApp interno) contém
CPF, data de nascimento e CNH em texto puro. Os mesmos dados ficam em claro no Redis por 30 dias.

**Contexto legal:** a Avelloz é controladora desses dados sob a LGPD. Não há política de retenção
nem base legal declarada na conversa.

**Tensão real:** o vendedor **precisa** do CPF para fazer a simulação de crédito. Mascarar no
WhatsApp interno e manter completo apenas na nota do ticket é um meio-termo possível.

**Decisão:** converse com quem responde por LGPD na empresa antes de mexer. Spec 0016.

### 6.6 Formato WABA — o vendedor recebe "Contato: Lead"

**O que acontece hoje:** no canal WhatsApp Oficial (WABA), o payload **não traz objeto `contact` nem
`PushName`**. Só `raw.from`. Resultado: `nomeContato` vem vazio e o bot só aprende o nome se o
cliente disser durante a conversa. O resumo chega ao vendedor como "Contato: Lead".

Junto: `mediaMimetype` também vem vazio no WABA, porque o código procura em
`raw.Message.imageMessage.mimetype` (formato WhatsApp Web) e o WABA usa `raw.image.mime_type`.
Inofensivo para imagem; para **áudio** afeta o envio ao Whisper.

**Isto foi descoberto analisando um payload real de produção.** Está documentado, não corrigido.

**Esforço:** pequeno. Acrescentar os caminhos do WABA nas cadeias de fallback.

### 6.7 D-08 e D-25 — Política de envio

**D-08:** a decisão de quebrar a resposta em várias mensagens usa a regex
`/encaminhando|consultor|especialista|resumo|repassando/i`. São palavras comuníssimas neste domínio —
"nosso consultor" aparece em respostas normais, que então deixam de ser quebradas. Comportamento de
envio imprevisível.

**D-25:** o atraso que simula digitação (900ms + 18ms por caractere) roda **dentro do lock** do
atendimento. Uma resposta de 4 linhas segura o lock por vários segundos, atrasando as próximas
mensagens do mesmo cliente.

**Decisão:** ambas mudam o que o cliente recebe e a cadência. Spec 0020.

---

## 7. Ação necessária no servidor, antes do próximo deploy

```bash
NODE_ENV=production pm2 start index.js --name iaavellozcg
```

**Sem `NODE_ENV=production`, a proteção do webhook não dispara** — ele continua aceitando qualquer
requisição, como antes.

**Com `NODE_ENV=production`, o servidor se recusa a subir** sem `WEBHOOK_SECRET` (mínimo 16
caracteres) e sem `CC_PUSH_URL`. Isso é o comportamento correto, mas quem fizer o deploy precisa
saber antes e ter o segredo gerado. A mensagem de erro lista exatamente o que falta.

Também: aponte a URL do webhook no painel ChatClean para `https://SEU_DOMINIO/webhook/<segredo>`.

---

## 8. Decisões de negócio ainda em aberto

| # | Pergunta | O que foi assumido | Custo de corrigir |
|---|---|---|---|
| 1 | O horário de segunda a sexta é mesmo 09h–18h? | Sim (é o que o código sempre fez) | Um número em `EXPEDIENTE_SEMANAL` |
| 2 | Monteiro tem horário próprio? | Não, igual às unidades de Campina Grande | Uma tabela por loja |
| 3 | De quais endereços vêm as fotos e áudios dos clientes? | Só o do ChatClean foi observado (Oracle Cloud, região Vinhedo). Existe também um endereço do Meta no payload | Necessário antes de validar origem de mídia (S7) |
| 4 | Qual é a taxa real de vazamento de RN-001 hoje? | **Desconhecida.** `npm run eval` nunca foi executado — gasta crédito | Rodar uma vez e guardar o número |

**A número 4 é a mais importante.** Os testes garantem que a instrução chega ao modelo; ninguém sabe
se o modelo obedece. Suspeita, olhando o prompt: **provavelmente não é 0%** — o `gpt-4o-mini` é um
modelo pequeno para uma regra tão contextual, e o bloqueio está repetido em dois lugares do prompt.
Ter o número de partida transforma "achamos que melhorou" em "caiu de X% para 0%".

---

## 9. Conhecimento tácito — o que não é óbvio no código

Estas são as armadilhas que custaram tempo para entender. Todas estão cobertas por teste, mas se você
mexer perto delas, saiba o porquê:

**O telefone do cliente nem sempre está onde parece.** A cadeia de fallback é
`contact.number` → `contact.phone` → `body.number` → `raw.Info.SenderAlt` → `raw.from` →
`message.number`. No WhatsApp Web ele vem em `SenderAlt`; no WABA, em `raw.from`.

**O sufixo de dispositivo precisa ser cortado ANTES de remover não-dígitos.**
`558491756446:24@s.whatsapp.net` — se você limpar primeiro, o `24` gruda no número.

**O 9º dígito de celular varia entre payloads.** Comparações usam um "núcleo canônico" que ignora o
9 depois do DDD: `5584994610845` e `558494610845` são a mesma pessoa.

**Grupo é detectado por cinco sinais diferentes**, porque cada canal marca de um jeito:
`ticket.isGroup`, `ticket.status === 'group'`, `raw.Info.IsGroup`, `body.isGroup` e JID com `@g.us`.

**O bot é um "bot de fila".** Ele responde enquanto ninguém humano assumiu o ticket. Ticket com
`userId` atribuído ou `status: 'closed'` → silêncio. Ticket sem status → responde (compatibilidade).

**Áudio não registra entrada própria no histórico**, mas vídeo e imagem registram. A transcrição do
áudio **vira** o texto do turno; o vídeo entra como `[O cliente enviou um vídeo] Fala no vídeo: ...`.
É assimetria herdada, agora explícita em `clienteJaNoHistorico`.

**Vídeo que falha no download continua o turno; áudio que falha, encerra.** Também herdado.

**`return` de promise dentro de `try/catch` não captura a rejeição.** Isso causou um bug durante a
refatoração — faltava o `await` em `return await deps.baixadorDeMidia.baixar(...)`. O comentário está
no código para não ser "simplificado" depois.

**O log de recebimento acontece ANTES da deduplicação.** Contar linhas de "Webhook de" no log
superestima as mensagens processadas. Qualquer métrica construída sobre esse log hoje está errada.

**A linha de base tem dois campos normalizados**: a ordem dos atendimentos em `/leads` (depende de
qual turno terminou primeiro) e o `expediente` do `/diag` (depende da hora da coleta). Sem isso, o
diff acusa regressão onde não há.

---

## 10. Como trabalhar aqui

O processo que sustentou 14 specs sem uma regressão:

1. **Nenhum código sem spec aprovada.** Ver [specs/README.md](../specs/README.md). Cada spec tem
   `spec.md` (o quê e por quê), `plan.md` (como), `tasks.md` (passos) e `resultado.md` (o que
   aconteceu de fato, incluindo os erros no caminho).
2. **Execute a aplicação e colete a linha de base antes de mudar código.**
3. **Escreva o teste que congela o comportamento atual** — inclusive o errado.
4. **Troque a implementação.** Se os testes congelados passam sem alteração, o contrato não mudou.
5. **Quando corrigir o defeito, inverta o teste** que o documentava. Não apague.

E as convenções do projeto:

- **Nunca faça merge na `main`.** Todo trabalho na branch de refatoração.
- **Nunca use emojis** em documentação, código, commits ou respostas. Exceção: o texto que o *bot*
  envia ao cliente segue RN-022 (no máximo 1 emoji) — isso é regra de negócio do produto.
- **Commits concisos**, com o número da spec: `feat(0012): ...`.
- **Bug encontrado no meio de uma fatia vira dívida documentada + teste `CONGELA`**, não correção de
  contrabando.

---

## 11. Duas regressões introduzidas e corrigidas — e o que elas ensinam

Por transparência, e porque ilustram para que serve a rede de testes:

**O varredor de follow-up agendado duas vezes.** Ao tornar o `index.js` importável na spec 0001, o
`setInterval` foi adicionado dentro de `iniciar()` sem remover o do nível do módulo. Em produção,
dois timers poderiam disparar o mesmo follow-up em corrida — reativação duplicada para o cliente.
Descoberto rastreando com `git` ao preparar outra fatia; nenhum teste pegou porque o teste dourado
chama `varrerFollowUps()` diretamente e a linha de base não espera dois minutos. Hoje há um teste
específico para isso.

**O `await` faltando no download de mídia.** Pego pelo teste dourado no mesmo dia.

A lição prática: **teste e linha de base cobrem coisas diferentes**. Rode os dois.

---

## 12. Índice da documentação

| Documento | Para quê |
|---|---|
| [13-estado-e-continuacao.md](13-estado-e-continuacao.md) | Estado atual resumido e próximos passos |
| [00-visao-geral.md](00-visao-geral.md) | O negócio e o funil |
| [03-regras-de-negocio.md](03-regras-de-negocio.md) | RN-NNN, com criticidade e origem |
| [04-casos-de-uso.md](04-casos-de-uso.md) | UC-NNN, com fluxos alternativos |
| [09-divida-tecnica.md](09-divida-tecnica.md) | D-NN e S-N, com o que foi resolvido |
| [10-arquitetura-alvo.md](10-arquitetura-alvo.md) | A arquitetura, e o que ficou de fora de propósito |
| [11-plano-refatoracao-strangler.md](11-plano-refatoracao-strangler.md) | O plano das 11 fases |
| [12-linha-de-base.md](12-linha-de-base.md) | O comportamento medido antes de tudo |
| [01-arquitetura-atual.md](01-arquitetura-atual.md) | **Histórico**: como era o código original |
| [specs/BACKLOG.md](../specs/BACKLOG.md) | As specs pendentes e as sugestões de produto |

Os identificadores `RN-NNN`, `UC-NNN`, `D-NN` e `S-N` são estáveis e aparecem em specs, testes e
comentários de código. **Não renumere.**
