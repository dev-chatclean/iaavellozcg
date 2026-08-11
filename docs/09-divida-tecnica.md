# 09 — Dívida Técnica

Catálogo de problemas encontrados na análise do código. IDs `D-NN` (estruturais/qualidade) e `S-N`
(segurança/LGPD) são referenciados no plano de refatoração e nas specs.

**Severidade:** Crítica (risco em produção ou impede evolução) · Alta · Média.

---

## Arquitetura e design

### D-01 (Crítica) — `index.js` é um God Object
1040 linhas com pelo menos 8 responsabilidades: configuração, servidor HTTP, autenticação,
parse de payload, proteções (dedup/rate-limit/anti-loop), fila e agrupamento, processamento de mídia,
chamadas à OpenAI, máquina de estados, montagem de resumo, notificação, transbordo, follow-up,
endpoints administrativos e bootstrap.
**Impacto:** qualquer mudança tem risco de regressão em algo não relacionado; impossível testar em
unidade; impossível ter dois desenvolvedores mexendo em paralelo.
**Progresso:** spec 0003 tirou o parse do payload (1040 -> 990 linhas). **Fatia:** Fases 1–6.

### D-02 (Crítica) — Sem camadas nem inversão de dependência
Regra de negócio, I/O de rede, persistência e HTTP no mesmo arquivo e frequentemente na mesma função.
`openai`, `axios`, `ioredis` e `express` são acoplados diretamente.
**Impacto:** trocar OpenAI por outro provedor, ou ChatClean por outro canal, exige reescrever o core.
Nenhum teste roda sem rede. **Fatia:** Fase 2.

### D-03 (Crítica) — Regras de negócio espalhadas em quatro lugares
Código (`index.js`, `flow.js`), dados (`data.js`), **texto de prompt** (`prompts.js`) e strings
hardcoded no meio do fluxo (ex.: a mensagem de roteamento para Pós-venda).
**Impacto:** ninguém sabe onde está a regra; mudança no prompt altera comportamento sem revisão de
código; regras duplicadas divergem (o bloqueio de diagnóstico está no `SYSTEM_SDR` **e** em
`promptResposta`). **Fatia:** Fases 3–4.

### D-04 (Crítica) — Três implementações divergentes do mesmo turno de conversa
`index.js: processarMensagem`, `test-chat.js: turno` e `sim-lead.js: turno`.
Divergências **já existentes**:

| | `index.js` | `test-chat.js` | `sim-lead.js` |
|---|---|---|---|
| `response_format: json_object` | sim | nao | sim |
| Passa `expediente` ao prompt | sim | nao | sim |
| Aplica `tipoContato` | sim | | nao |
| Reavalia perfil em correção | sim | nao | |
| Monta resumo | `montarResumo` | ad-hoc | **cópia** de `montarResumo` |

**Impacto:** os testadores validam um comportamento que não é o de produção — pior que não ter
testador. **Fatia:** Fase 6.

### D-05 (Alta) — `pipeline.js` é código morto com comentários de outro projeto
`criarOportunidade()` nunca é chamado. Os comentários descrevem a etapa "REUNIÃO MARCADA" e o
responsável "Roni" — herança do `iachatclean`. Só `diag()` é usado.
**Impacto:** confunde quem lê; sugere uma integração que não existe.
**Decisão do negócio (2026-08-11): os vendedores não usam o funil de Oportunidades — remover.**
Deletar `pipeline.js`, a referência em `/diag` e as 6 variáveis `PIPELINE_*`. **Fatia:** spec 0007.

### D-06 (Alta) — Query com efeito colateral (viola CQS)
`flow.js: determinarProximoCampo(leadData)` **muta** `leadData.qualificacaoCompleta` ao retornar
`null`. É chamada duas vezes por turno, e também dentro de `montarMsgReativacao` — ou seja,
**montar uma mensagem de follow-up pode marcar o lead como qualificado**.
**Impacto:** bug latente sério. **Fatia:** Fase 3.

### D-07 (Alta) — Primitive obsession
Telefone, CPF, dinheiro, modelo, loja e datas são strings soltas num objeto anônimo. Nenhuma
validação de formato em nenhum ponto. **Fatia:** Fase 3.

### D-08 (Alta) — Heurística frágil na quebra de mensagens
`enviarMensagensQuebradas` decide enviar inteiro se o texto casar com
`/encaminhando|consultor|especialista|resumo|repassando/i`. Palavras comuníssimas nesse domínio —
"nosso consultor" aparece em respostas normais, que então deixam de ser quebradas.
**Impacto:** comportamento de envio imprevisível. **Fatia:** Fase 5.

### D-09 (Alta) — Sem estado explícito do atendimento
O estado é inferido de `qualificacaoCompleta` + `finalizado` + campos vazios. Não há transição
validada; nada impede combinações inválidas. **Fatia:** Fase 3.

### D-10 (Média) — Duplicação interna
`montarResumo` e `notificarEquipe` recalculam `departamento` e `perfilNome` separadamente.
`processarMensagem` monta o histórico recente com o mesmo `map` em quatro pontos.

### D-11 (Média) — Imports não usados
`fs`, `path` e `crypto` (parcialmente) importados em `index.js` sem uso pleno.

---

## Testes e qualidade

### D-12 — RESOLVIDA (spec 0001, 2026-08-11)
Era: nenhum framework, nenhum teste, nenhum script `test`. **O bloqueador número um.**
Agora: **245 testes em 1,8s**, sem nenhuma chamada de rede, com 100% de cobertura nos módulos
determinísticos e um teste dourado de 41 cenários sobre o turno completo.
Ver [specs/0001-rede-de-seguranca/resultado.md](../specs/0001-rede-de-seguranca/resultado.md).

### D-13 — RESOLVIDA (spec 0001, 2026-08-11)
ESLint 9 (flat config) + Prettier + CI no GitHub Actions (lint, test, build da imagem).
As fronteiras da arquitetura alvo já estão declaradas em `no-restricted-imports` — hoje em aviso,
viram erro na Fase 2. O legado entrou num **ratchet**: os 9 arquivos antigos ficam em aviso e saem
da lista conforme forem estrangulados; a lista só encolhe.

### D-14 (Alta) — Sem tipagem
JavaScript puro, sem JSDoc estruturado nem TypeScript. O shape do `leadData` só existe na cabeça de
quem escreveu. **Fatia:** Fase 9 (opcional, alto retorno).

---

## Confiabilidade e operação

### D-15 (Crítica) — Não escala além de uma instância
Dedup de `msgId`, rate-limit, fila por chat, debounce e o `setInterval` de follow-up vivem na memória
do processo. Com duas instâncias: mensagens duplicadas, rate-limit multiplicado, agrupamento quebrado
e follow-up enviado N vezes. Só o lock de processamento é distribuído. **Fatia:** Fase 8.

### D-16 (Crítica) — Shutdown não é graceful
`process.exit(0)` imediato em SIGINT/SIGTERM/SIGUSR2. Mensagens na fila e turnos em voo são perdidos;
o lock Redis fica pendurado até o TTL de 60s. Todo deploy perde atendimentos em andamento.

**Agravante medido na Fase 0:** o estado do atendimento é gravado **uma única vez, no `finally`, ao
fim do turno** — depois das duas chamadas à OpenAI. Enquanto o turno roda (facilmente 1 a 3 segundos,
mais em instabilidade), **nada do que o cliente disse existe fora da memória do processo**. Um
restart nessa janela apaga o turno inteiro, não só a resposta.

Isso foi observado empiricamente: nas coletas de baseline, atendimentos apareciam ou não em `/leads`
conforme a latência da rede naquele instante — o mesmo código, o mesmo tráfego, resultados diferentes.
Confirmado tanto no código atual quanto no commit original `255c13b`, então **não é regressão da
refatoração**; é uma característica do desenho. **Fatia:** Fase 8.

### D-17 (Alta) — Sem retry, backoff ou circuit breaker
Nenhuma chamada externa (OpenAI, Push, download de mídia) tem retry. Uma instabilidade de 2s da
OpenAI vira uma mensagem de desculpa ao cliente; uma falha no Push significa que o cliente
simplesmente não recebe a resposta — **sem nenhum alerta**. **Fatia:** Fase 8.

### D-18 (Alta) — Degradação silenciosa do Redis
Sem `REDIS_URL`, o sistema cai para memória sem alarme. Em produção isso significa perder todo o
estado a cada restart, e ninguém percebe até um cliente reclamar. **Fatia:** Fase 8.

### D-19 — RESOLVIDA (spec 0009, 2026-08-11)
Sábado passou a ser dia de atendimento, das 08h às 18h. O horário virou uma **tabela por dia da
semana** (`horario.js: EXPEDIENTE_SEMANAL`), então ajustar um dia é mudar um número.
Efeito colateral corrigido junto: com o sábado alcançável, o rótulo do próximo expediente dizia
"na sábado" — a preposição agora varia por gênero do dia.

<details><summary>Descrição original</summary>

### D-19 (Alta) — BUG confirmado: sábado tratado como fim de semana
`horario.js` implementa segunda a sexta, 09h–18h (comentário herdado: "expediente do time ChatClean …
Natal-RN"). Já `data.js: EMPRESA_INFO.horarioSuporte` diz "Segunda a sábado, em horário comercial" —
e esse texto vai ao cliente pelo prompt.
**Decisão do negócio (2026-08-11): a loja atende sábado.** Logo, `horario.js` está errado.
**Impacto real:** todo lead que chega no sábado é atendido em modo plantão e o transbordo vai para a
equipe etiquetado `FORA DE EXPEDIENTE — AGENDAR RETORNO`, com a loja aberta e vendedor disponível.
É perda de venda, não só inconsistência de código.
**Fatia:** spec 0009, logo após a Fase 0.
</details>

### D-20 (Alta) — Sem observabilidade
`console.log` com emojis, sem níveis, sem correlação, sem métricas, sem alerta. Não é possível
responder "quantos leads qualificamos ontem?" nem "por que aquele lead não recebeu resposta?".
**Fatia:** Fase 8.

### D-21 (Média) — `avellozcg:leads` é write-only e sem TTL
Cresce indefinidamente e nenhum endpoint o lê (`/leads` lista atendimentos ativos, não o histórico).

### D-22 (Média) — Campo fantasma no `/leads`
Expõe `l.empresa`, que não existe no domínio Avelloz — resquício do `iachatclean`. Sempre `undefined`.

### D-23 — RESOLVIDA (spec 0002, 2026-08-11)
As 21 variáveis passaram a ser lidas e validadas em `src/main/config.js`, uma vez, **antes** do
`app.listen`. Configuração inválida derruba o processo listando todos os problemas com o valor
recebido. Em `NODE_ENV=production` o esquema exige `WEBHOOK_SECRET` e `CC_PUSH_URL`.
Ver [resultado](../specs/0002-configuracao-e-endurecimento/resultado.md).

<details><summary>Descrição original</summary>

### D-23 (Média) — Configuração não validada no boot
21 variáveis de ambiente lidas por `process.env` espalhado em 4 arquivos, sem validação. O processo
sobe com configuração inválida e falha em runtime. Único caso tratado (`OPENAI_API_KEY`) é verificado
**depois** do `app.listen`. **Fatia:** Fase 0.

### D-24 (Média) — Erros engolidos
Vários `catch (_) {}` e `catch { return null }` sem log. Falhas somem.

### D-29 — RESOLVIDA (spec 0003, 2026-08-11)
O tradutor devolve `formato-desconhecido` limpo para `undefined`, `null`, string, número e array.
Ganho colateral: a linha que despejava o corpo inteiro no log (mais um vazamento de PII) agora
registra só o motivo.

<details><summary>Descrição original</summary>

### D-29 (Média) — O log de payload desconhecido quebra com corpo `undefined`
Revelado pela caracterização (PR4). `parsePayload(undefined)` cai no ramo "payload não reconhecido",
que faz `JSON.stringify(body, null, 2).slice(0, 800)`. Com `body` indefinido, `JSON.stringify`
devolve `undefined` e o `.slice` lança — o erro é engolido pelo `try/catch` e vira
`Erro ao fazer parse do payload: Cannot read properties of undefined`.

O resultado final (`null`) está correto, mas **a mensagem de erro aponta para o lugar errado**: quem
investigar vai procurar um bug no parse quando o problema é a própria linha de log. Sai naturalmente
na spec 0003, quando o parse vira ACL com validação de schema.
</details>

### D-25 (Média) — Envio bloqueia o lock do atendimento
`enviarMensagensQuebradas` faz `sleep(900 + tamanho×18)` **por parte**, dentro do lock de
processamento. Uma resposta de 4 linhas segura o lock por vários segundos, atrasando as próximas
mensagens do mesmo cliente.

### D-28 — RESOLVIDA (spec 0009, 2026-08-11)
`promptResposta` passou a usar o `expediente` que já recebia: fora do horário, o turno leva a
instrução de não prometer atendimento imediato e de informar quando o consultor retorna, preservando
RN-021 e RN-023 (a conversa não é encerrada). Dentro do expediente, nada muda no prompt.
O ESLint deixou de acusar o parâmetro não usado — de 7 avisos para 6.

<details><summary>Descrição original</summary>

### D-28 (Crítica) — BUG: o modo plantão nunca chega à resposta do bot
`promptResposta({ ..., expediente })` recebe o expediente e **nunca o usa** — o parâmetro é
desestruturado e descartado (revelado pelo ESLint, `prompts.js:148`).

`index.js` calcula `exp = estaEmExpediente()` e o repassa por `gerarRespostaIA` para `promptResposta`,
mas o texto do prompt não menciona expediente em lugar nenhum. Consequência: **o modelo escreve como
se a loja estivesse sempre aberta**. A informação de plantão só sobrevive em dois lugares periféricos:
a etiqueta do resumo interno (`FORA DE EXPEDIENTE`) e a mensagem de fallback do `catch` em
`encaminhar()` — que só aparece quando a chamada à OpenAI falha.

**Impacto real:** às 23h de um domingo o bot diz "já tô repassando pro nosso consultor, ele assume seu
atendimento aqui rapidinho" — e ninguém assume. RN-061 está implementada pela metade.
Combinado com D-19 (sábado tratado como fechado), o expediente está errado nas duas direções.

**Fatia:** correção junto da spec 0009, que já mexe em expediente. Congelar em teste antes.
</details>

### D-26 (Média) — Transcrição fora do SDK
Whisper é chamado com `axios` + `form-data` na mão, com `Authorization` montado manualmente, enquanto
o resto usa o SDK oficial. Dois caminhos de autenticação e de erro.

### D-27 (Média) — Webhook responde 200 antes de processar
Correto para evitar retry do provedor, mas hoje não há nenhuma compensação: se o processamento falhar,
a mensagem se perde **silenciosamente**, sem fila de retentativa e sem alerta.

---

## Segurança e LGPD

Detalhamento em `.claude/agents/seguranca-lgpd.md`. Resumo:

| ID | Sev. | Problema |
|---|---|---|
| ~~S1~~ | RESOLVIDO | ~~Payload bruto logado inteiro~~ — spec 0002: payload atrás de `LOG_PAYLOAD`, telefone mascarado em todo log |
| **S2** | Crítica | Resumo com CPF, nascimento e CNH enviado por WhatsApp para `EQUIPE_NUMERO` |
| **S3** | Crítica | CPF e demais dados pessoais persistidos em claro no Redis por 30 dias |
| ~~S4~~ | RESOLVIDO | ~~Webhook aberto por omissão~~ — spec 0002: `WEBHOOK_SECRET` obrigatório em `NODE_ENV=production` (o boot falha sem ele) |
| ~~S5~~ | RESOLVIDO | ~~Comparação com `padEnd(128)`~~ — spec 0002: comparação por digest SHA-256 |
| **S6** | Alta | Sanitização anti-injeção é só `replace(/[<>]/g,'')` |
| **S7** | Alta | `mediaUrl` do webhook é baixada e repassada à OpenAI sem validação de host (SSRF) |
| ~~S8~~ | RESOLVIDO | ~~Sem `.dockerignore`~~ — spec 0002: criado e verificado com `docker build` real |
| **S9** | Alta | Sem política de retenção/expurgo; lista de leads sem TTL |
| **S10** | Média | Sem aviso de tratamento de dados / base legal declarada na conversa |

---

## Priorização

```
RESOLVIDO ──── D-12 (sem testes), D-13 (sem lint/CI)  ─> spec 0001, concluída

RESOLVIDO ──── D-23, S1, S4, S5, S8  ─────────────────> spec 0002, concluída

BUG ────────── D-28 (plantão não chega à resposta)  ──> spec 0009
               D-19 (sábado tratado como fechado)
               D-06 (query com efeito colateral)

CRÍTICO ────── D-01, D-02, D-03, D-04 (estrutura)  ───> Fases 1–6
               D-09

ALTO ───────── D-15, D-16, D-17, D-18, D-20  ────────> Fase 8
               S2, S3, S6, S7, S9

MÉDIO ──────── D-05, D-07, D-08, D-19, D-21..D-27  ──> ao longo das fases
```

**Regra:** nenhuma fatia de refatoração começa antes da Fase 0 estar concluída. Refatorar sem testes
não é refatoração — é reescrita às cegas.
