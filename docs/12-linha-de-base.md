# 12 — Linha de Base (comportamento de produção, verificado)

Esta é a rede de segurança da refatoração: o comportamento **real** do código que está em produção,
capturado executando a aplicação de verdade, antes de qualquer alteração.

**Referência:** `test/baseline/producao-develop-requisicoes.log`
**Código capturado:** `develop` (= `main`, árvore idêntica) — o que está atendendo lead hoje.

## Como reproduzir

```bash
bash test/baseline/coletar-baseline.sh <rotulo>
# gera test/baseline/<rotulo>-requisicoes.log e <rotulo>-servidor.log
diff test/baseline/producao-develop-requisicoes.log test/baseline/<rotulo>-requisicoes.log
```

O script sobe o servidor na porta 3999 com ambiente controlado e exercita a pilha HTTP inteira.

**Nada sai para o mundo:** sem `CC_PUSH_URL` (nenhuma mensagem é enviada), sem `REDIS_URL` (estado
em memória), `OPENAI_API_KEY` falsa (nenhum crédito gasto — as chamadas falham de propósito e
exercitam o caminho de fallback). Os `DEPT_ID_*` ficam vazios para cair nos padrões do `data.js`.

## Boot

Com a configuração acima, o servidor sobe e avisa, sem impedir a inicialização:

- `CC_PUSH_URL` ausente — a IA não conseguirá responder
- `EQUIPE_NUMERO` ausente — resumo do lead só como nota interna
- `WEBHOOK_SECRET` vazio — **o `/webhook` fica ABERTO**, apenas com aviso no log
- Sem `REDIS_URL` — estado em memória, sem alarme

Os dois últimos são dívida conhecida (webhook aberto e Redis degradando em silêncio). A linha de
base **congela isso como está**: corrigir muda comportamento e depende de decisão.

## Endpoints

| Rota | Sem chave | Com `ADMIN_KEY` |
|---|---|---|
| `GET /health` | `{status, uptime, timestamp}` HTTP 200 | — |
| `GET /diag` | `{"erro":"não autorizado"}` HTTP 401 | configuração ativa, HTTP 200 |
| `GET /diag/transferir` | `{"erro":"não autorizado"}` HTTP 401 | resultado da transferência, HTTP 200 |
| `GET /leads` | HTTP 401 | `{total, ativos[]}` HTTP 200 |
| `GET /webhook` e `/webhook/:token` | `{"status":"ok"}` HTTP 200 | — |
| `POST /webhook` | `{"status":"ok"}` HTTP 200 **sempre** | — |

O `POST /webhook` responde 200 em todos os casos, inclusive payload desconhecido e mensagem
descartada. É proposital: o CRM não deve reenviar.

O `/diag` expõe `transferenciaDepartamento` (ativa, fechandoTicket, IDs por loja) e ainda expõe
`pipeline`, o módulo de Oportunidades que **não é usado pelos vendedores**.

O `/diag/transferir` devolve `numeroEnviado`, `departamento`, `idUsado`, `fechandoTicket`,
`transferiu` e `motivo`. Sem `CC_PUSH_URL` o motivo é `"CC_PUSH_URL ausente"`. Não envia nada ao
cliente.

## Payloads aceitos

Quatro formatos criam atendimento, e o telefone sai de lugares diferentes em cada um:

| Formato | Origem do telefone | Resultado |
|---|---|---|
| Aninhado com `SenderAlt` | `message.raw.Info.SenderAlt`, cortando o sufixo `:24` | `558491756446` |
| Aninhado sem `SenderAlt` | `contact.number` | `5583988887777` |
| WABA | `message.raw.from` | `5583977776666` |
| Plano | `number` | `5583966665555` |

Depois do tráfego, `/leads` devolve **4 atendimentos**, ordenados por `chatId` na normalização.

## Payloads descartados

Descartados **em silêncio**, sem linha de log própria: eco do próprio bot (`fromMe: true`), grupo
por `ticket.isGroup`, grupo por JID `@g.us`, e o formato `numero_cliente`.

Descartados **com log**: ticket `open` com `userId` e ticket `closed` ("aceito/atendido por humano —
IA não responde"), e payload não reconhecido ("Payload não reconhecido").

O `sticker` **não é descartado**: entra como `[mídia]` e vira turno.

## Achados confirmados na execução

**O log do payload vem antes da checagem de duplicidade.** O reenvio de `MSG-A2` aparece no log como
mensagem recebida ("oi de novo") mesmo sendo descartado depois. Quem lê o log conta mensagem a mais.

**O payload bruto é logado sempre**, sem chave para desligar. Ele contém dados pessoais: nome,
telefone, conteúdo da mensagem e, na etapa de simulação, CPF, nascimento e CNH.

**A chave da OpenAI aparece mascarada** na mensagem de erro (`sk-basel*****alsa`) — mascaramento do
próprio SDK, não do código.

**O estado só é gravado no fim do turno**, depois das chamadas de rede. Por isso o script espera 10
segundos antes de consultar `/leads`: sem a espera, o número de atendimentos varia e o diff acusa
regressão que não existe.

## O que esta linha de base NÃO cobre

- Resposta real da OpenAI (a chave é falsa de propósito)
- Envio real pela Push API e transferência real de ticket (sem `CC_PUSH_URL`)
- Persistência em Redis
- Transcrição de áudio, leitura de imagem e download de mídia
- Follow-up de reativação (30 min de inatividade)
- Qualidade da conversa

Isso é papel dos testes automatizados e dos evals. A linha de base cobre **a borda HTTP e o
comportamento de boot** — que é justamente o que teste com adapter falsificado não vê.

## Determinismo

Três campos mudam a cada execução e são normalizados antes da gravação:

1. a ordem dos atendimentos em `/leads` (depende de qual turno terminou primeiro) — ordenada por `chatId`;
2. o campo `expediente` do `/diag` (depende da hora da coleta);
3. `uptime` e `timestamp` do `/health`.

Duas coletas independentes do mesmo código produzem arquivos **idênticos**. Foi verificado.

## Critério de regressão

Antes de integrar qualquer fatia:

1. `npm test` verde;
2. `npm run lint` sem erro (avisos do ratchet do legado são esperados);
3. `diff` contra `producao-develop-requisicoes.log` — divergência só é aceitável se estiver
   **declarada na spec** como mudança de comportamento intencional e aprovada.

Diff vazio significa que a borda HTTP e o boot continuam se comportando como a produção.
