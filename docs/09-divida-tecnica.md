# 09 — Dívida Técnica

Catálogo de problemas encontrados na análise do código. IDs `D-NN` (estruturais/qualidade) e `S-N`
(segurança/LGPD) são referenciados no plano de refatoração e nas specs.

**Severidade:** 🔴 Crítica (risco em produção ou impede evolução) · 🟡 Alta · 🟢 Média.

---

## Arquitetura e design

### D-01 🔴 — `index.js` é um God Object
1040 linhas com pelo menos 8 responsabilidades: configuração, servidor HTTP, autenticação,
parse de payload, proteções (dedup/rate-limit/anti-loop), fila e agrupamento, processamento de mídia,
chamadas à OpenAI, máquina de estados, montagem de resumo, notificação, transbordo, follow-up,
endpoints administrativos e bootstrap.
**Impacto:** qualquer mudança tem risco de regressão em algo não relacionado; impossível testar em
unidade; impossível ter dois desenvolvedores mexendo em paralelo.
**Fatia:** Fases 1–6.

### D-02 🔴 — Sem camadas nem inversão de dependência
Regra de negócio, I/O de rede, persistência e HTTP no mesmo arquivo e frequentemente na mesma função.
`openai`, `axios`, `ioredis` e `express` são acoplados diretamente.
**Impacto:** trocar OpenAI por outro provedor, ou ChatClean por outro canal, exige reescrever o core.
Nenhum teste roda sem rede. **Fatia:** Fase 2.

### D-03 🔴 — Regras de negócio espalhadas em quatro lugares
Código (`index.js`, `flow.js`), dados (`data.js`), **texto de prompt** (`prompts.js`) e strings
hardcoded no meio do fluxo (ex.: a mensagem de roteamento para Pós-venda).
**Impacto:** ninguém sabe onde está a regra; mudança no prompt altera comportamento sem revisão de
código; regras duplicadas divergem (o bloqueio de diagnóstico está no `SYSTEM_SDR` **e** em
`promptResposta`). **Fatia:** Fases 3–4.

### D-04 🔴 — Três implementações divergentes do mesmo turno de conversa
`index.js: processarMensagem`, `test-chat.js: turno` e `sim-lead.js: turno`.
Divergências **já existentes**:

| | `index.js` | `test-chat.js` | `sim-lead.js` |
|---|---|---|---|
| `response_format: json_object` | ✅ | ❌ | ✅ |
| Passa `expediente` ao prompt | ✅ | ❌ | ✅ |
| Aplica `tipoContato` | ✅ | ✅ | ❌ |
| Reavalia perfil em correção | ✅ | ❌ | ❌ |
| Monta resumo | `montarResumo` | ad-hoc | **cópia** de `montarResumo` |

**Impacto:** os testadores validam um comportamento que não é o de produção — pior que não ter
testador. **Fatia:** Fase 6.

### D-05 🟡 — `pipeline.js` é código morto com comentários de outro projeto
`criarOportunidade()` nunca é chamado. Os comentários descrevem a etapa "REUNIÃO MARCADA" e o
responsável "Roni" — herança do `iachatclean`. Só `diag()` é usado.
**Impacto:** confunde quem lê; sugere uma integração que não existe. **Fatia:** spec 0007.

### D-06 🟡 — Query com efeito colateral (viola CQS)
`flow.js: determinarProximoCampo(leadData)` **muta** `leadData.qualificacaoCompleta` ao retornar
`null`. É chamada duas vezes por turno, e também dentro de `montarMsgReativacao` — ou seja,
**montar uma mensagem de follow-up pode marcar o lead como qualificado**.
**Impacto:** bug latente sério. **Fatia:** Fase 3.

### D-07 🟡 — Primitive obsession
Telefone, CPF, dinheiro, modelo, loja e datas são strings soltas num objeto anônimo. Nenhuma
validação de formato em nenhum ponto. **Fatia:** Fase 3.

### D-08 🟡 — Heurística frágil na quebra de mensagens
`enviarMensagensQuebradas` decide enviar inteiro se o texto casar com
`/encaminhando|consultor|especialista|resumo|repassando/i`. Palavras comuníssimas nesse domínio —
"nosso consultor" aparece em respostas normais, que então deixam de ser quebradas.
**Impacto:** comportamento de envio imprevisível. **Fatia:** Fase 5.

### D-09 🟡 — Sem estado explícito do atendimento
O estado é inferido de `qualificacaoCompleta` + `finalizado` + campos vazios. Não há transição
validada; nada impede combinações inválidas. **Fatia:** Fase 3.

### D-10 🟢 — Duplicação interna
`montarResumo` e `notificarEquipe` recalculam `departamento` e `perfilNome` separadamente.
`processarMensagem` monta o histórico recente com o mesmo `map` em quatro pontos.

### D-11 🟢 — Imports não usados
`fs`, `path` e `crypto` (parcialmente) importados em `index.js` sem uso pleno.

---

## Testes e qualidade

### D-12 🔴 — Zero testes automatizados
Nenhum framework, nenhum arquivo de teste, nenhum script `test` no `package.json`.
**Impacto:** **nenhuma refatoração é segura**. Este é o bloqueador número um.
**Fatia:** Fase 0 (obrigatória antes de qualquer outra).

### D-13 🟡 — Sem lint, formatter ou CI
Sem ESLint, Prettier ou GitHub Actions. Estilo inconsistente (indentação de 4 espaços no geral, mas
variações). Nada impede um `require` de infra entrar no domínio depois da refatoração.
**Fatia:** Fase 0.

### D-14 🟡 — Sem tipagem
JavaScript puro, sem JSDoc estruturado nem TypeScript. O shape do `leadData` só existe na cabeça de
quem escreveu. **Fatia:** Fase 9 (opcional, alto retorno).

---

## Confiabilidade e operação

### D-15 🔴 — Não escala além de uma instância
Dedup de `msgId`, rate-limit, fila por chat, debounce e o `setInterval` de follow-up vivem na memória
do processo. Com duas instâncias: mensagens duplicadas, rate-limit multiplicado, agrupamento quebrado
e follow-up enviado N vezes. Só o lock de processamento é distribuído. **Fatia:** Fase 8.

### D-16 🔴 — Shutdown não é graceful
`process.exit(0)` imediato em SIGINT/SIGTERM/SIGUSR2. Mensagens na fila e turnos em voo são perdidos;
o lock Redis fica pendurado até o TTL de 60s. Todo deploy perde atendimentos em andamento.
**Fatia:** Fase 8.

### D-17 🟡 — Sem retry, backoff ou circuit breaker
Nenhuma chamada externa (OpenAI, Push, download de mídia) tem retry. Uma instabilidade de 2s da
OpenAI vira uma mensagem de desculpa ao cliente; uma falha no Push significa que o cliente
simplesmente não recebe a resposta — **sem nenhum alerta**. **Fatia:** Fase 8.

### D-18 🟡 — Degradação silenciosa do Redis
Sem `REDIS_URL`, o sistema cai para memória sem alarme. Em produção isso significa perder todo o
estado a cada restart, e ninguém percebe até um cliente reclamar. **Fatia:** Fase 8.

### D-19 🟡 — Conflito de regra: horário de atendimento
`horario.js` implementa **segunda a sexta, 09h–18h**, fuso `America/Recife`, com o comentário
"expediente do time ChatClean … horário de Natal-RN". Já `data.js: EMPRESA_INFO.horarioSuporte` diz
**"Segunda a sábado, em horário comercial"** — e esse texto vai para o cliente pelo prompt.
**Impacto:** o bot pode informar um horário e o plantão operar por outro.
**Ação:** decisão do negócio (spec 0009). Também revisar se o fuso correto é Campina Grande/PB.

### D-20 🟡 — Sem observabilidade
`console.log` com emojis, sem níveis, sem correlação, sem métricas, sem alerta. Não é possível
responder "quantos leads qualificamos ontem?" nem "por que aquele lead não recebeu resposta?".
**Fatia:** Fase 8.

### D-21 🟢 — `avellozcg:leads` é write-only e sem TTL
Cresce indefinidamente e nenhum endpoint o lê (`/leads` lista atendimentos ativos, não o histórico).

### D-22 🟢 — Campo fantasma no `/leads`
Expõe `l.empresa`, que não existe no domínio Avelloz — resquício do `iachatclean`. Sempre `undefined`.

### D-23 🟢 — Configuração não validada no boot
21 variáveis de ambiente lidas por `process.env` espalhado em 4 arquivos, sem validação. O processo
sobe com configuração inválida e falha em runtime. Único caso tratado (`OPENAI_API_KEY`) é verificado
**depois** do `app.listen`. **Fatia:** Fase 0.

### D-24 🟢 — Erros engolidos
Vários `catch (_) {}` e `catch { return null }` sem log. Falhas somem.

### D-25 🟢 — Envio bloqueia o lock do atendimento
`enviarMensagensQuebradas` faz `sleep(900 + tamanho×18)` **por parte**, dentro do lock de
processamento. Uma resposta de 4 linhas segura o lock por vários segundos, atrasando as próximas
mensagens do mesmo cliente.

### D-26 🟢 — Transcrição fora do SDK
Whisper é chamado com `axios` + `form-data` na mão, com `Authorization` montado manualmente, enquanto
o resto usa o SDK oficial. Dois caminhos de autenticação e de erro.

### D-27 🟢 — Webhook responde 200 antes de processar
Correto para evitar retry do provedor, mas hoje não há nenhuma compensação: se o processamento falhar,
a mensagem se perde **silenciosamente**, sem fila de retentativa e sem alerta.

---

## Segurança e LGPD

Detalhamento em `.claude/agents/seguranca-lgpd.md`. Resumo:

| ID | Sev. | Problema |
|---|---|---|
| **S1** | 🔴 | Payload bruto (com PII e conteúdo da conversa) logado inteiro em `console.log` |
| **S2** | 🔴 | Resumo com CPF, nascimento e CNH enviado por WhatsApp para `EQUIPE_NUMERO` |
| **S3** | 🔴 | CPF e demais dados pessoais persistidos em claro no Redis por 30 dias |
| **S4** | 🔴 | `WEBHOOK_SECRET` vazio deixa `/webhook` **aberto** — qualquer um injeta mensagens e queima crédito da OpenAI |
| **S5** | 🟡 | `webhookAutorizado` faz `padEnd(128)` (colisão para segredos > 128 chars) e compara comprimento antes do `timingSafeEqual` |
| **S6** | 🟡 | Sanitização anti-injeção é só `replace(/[<>]/g,'')` |
| **S7** | 🟡 | `mediaUrl` do webhook é baixada e repassada à OpenAI sem validação de host (SSRF) |
| **S8** | 🟡 | Sem `.dockerignore` — `docker build` pode copiar `.env` para a imagem |
| **S9** | 🟡 | Sem política de retenção/expurgo; lista de leads sem TTL |
| **S10** | 🟢 | Sem aviso de tratamento de dados / base legal declarada na conversa |

---

## Priorização

```
BLOQUEADOR ─── D-12 (sem testes)  ────────────────────▶ Fase 0
               D-13, D-23, S1, S4, S8

CRÍTICO ────── D-01, D-02, D-03, D-04 (estrutura)  ───▶ Fases 1–6
               D-06 (bug latente), D-09

ALTO ───────── D-15, D-16, D-17, D-18, D-20  ────────▶ Fase 8
               S2, S3, S5, S6, S7, S9

MÉDIO ──────── D-05, D-07, D-08, D-19, D-21..D-27  ──▶ ao longo das fases
```

**Regra:** nenhuma fatia de refatoração começa antes da Fase 0 estar concluída. Refatorar sem testes
não é refatoração — é reescrita às cegas.
