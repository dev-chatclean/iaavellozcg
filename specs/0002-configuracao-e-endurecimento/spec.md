# SPEC 0002 — Configuração validada e endurecimento mínimo

| | |
|---|---|
| **Status** | Aprovada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 |
| **Fase do plano** | Fase 0 — Rede de segurança (complemento) |
| **Dívida endereçada** | D-23, S1, S4, S5, S8 |
| **Depende de** | SPEC 0001 |

## 1. Contexto de negócio

O bot atende leads reais e coleta dados pessoais: nome, telefone, CPF, data de nascimento e situação
de CNH. A Avelloz é a controladora desses dados perante a LGPD. Além disso, cada mensagem processada
gasta crédito da OpenAI — quem consegue injetar mensagens no sistema gasta o dinheiro da loja.

Hoje o serviço sobe com configuração inválida sem reclamar, registra dados pessoais em texto puro no
log e, se uma variável estiver vazia, aceita requisições de qualquer origem.

## 2. Problema

**D-23 — configuração não é validada.** Vinte e uma variáveis lidas por `process.env` espalhado em
quatro arquivos, sem validação. O processo sobe e falha em runtime. O único caso tratado
(`OPENAI_API_KEY`) é verificado **depois** do `app.listen` — a porta abre, o serviço aceita webhook e
só então morre.

**S4 — webhook aberto por omissão.** Com `WEBHOOK_SECRET` vazio, `webhookAutorizado` retorna `true`
para qualquer requisição. Qualquer pessoa que descubra a URL injeta conversas, cria leads falsos e
queima crédito da OpenAI. O padrão está invertido: segurança deveria ser fail-closed.

**S5 — comparação de token frágil.** `webhookAutorizado` faz `padEnd(128)` nos dois lados: segredos
com mais de 128 caracteres são truncados e passam a colidir. E compara o comprimento antes do
`timingSafeEqual`, o que vaza o tamanho do segredo.

**S1 — dados pessoais no log.** Cada requisição imprime o payload bruto inteiro, com nome, telefone e
o conteúdo integral da mensagem. Numa conversa real isso inclui **CPF, data de nascimento e CNH**.
Medido na linha de base: 13 payloads completos em um único roteiro de teste.

**S8 — sem `.dockerignore`.** O `Dockerfile` faz `COPY . .`; se existir um `.env` na máquina que
constrói a imagem, o segredo entra na imagem.

## 3. Resultado esperado

O serviço se recusa a subir mal configurado, não aceita requisição não autenticada em produção, e o
log deixa de ser um vazamento de dados pessoais.

## 4. Escopo

**Dentro**
- Módulo de configuração único, validado uma vez, **antes** de abrir a porta, com mensagem que lista
  todos os problemas de uma vez.
- `WEBHOOK_SECRET` obrigatório quando `NODE_ENV=production`.
- Comparação de token por digest SHA-256, sem truncar e sem vazar comprimento.
- Payload bruto sai do log por padrão; no lugar entra um resumo com telefone mascarado.
- Telefone mascarado nas demais linhas de log.
- `.dockerignore`.

**Fora de escopo**
- Mascarar CPF no resumo enviado à equipe (S2) — spec 0016.
- Criptografia dos dados em repouso (S3) — spec 0016.
- Log estruturado com níveis e correlação (D-20) — spec 0015.
- Fazer `store.js`, `horario.js` e `pipeline.js` consumirem o módulo de configuração — eles saem de
  cena na Fase 2. A configuração deles é **validada**, mas o consumo continua onde está.
- Validação de schema do payload de entrada — spec 0003.

## 5. Regras de negócio aplicáveis

| ID | Regra | Como esta spec a afeta |
|---|---|---|
| RN-091 | PII não deve aparecer em log | **Implementa** (parcialmente: telefone e payload) |
| RN-050..058 | Proteções operacionais | Preserva todas |
| RF-050 | Autenticação do webhook | **Endurece**: fail-closed em produção |
| RF-063 | Avisos de configuração no boot | **Substitui**: aviso vira erro quando é erro |

## 6. Casos de uso afetados

| ID | Caso de uso | Impacto |
|---|---|---|
| UC-016 | Ignorar mensagem que não deve ser respondida | Requisição sem token passa a ser rejeitada em produção |
| UC-017 | Diagnosticar o serviço | `/diag` passa a informar se a configuração está completa |

## 7. Critérios de aceite

- **CA-001** — Dado `OPENAI_API_KEY` ausente, Quando o processo iniciar, Então ele encerra com código
  diferente de zero **antes** de abrir a porta, com mensagem dizendo qual variável falta.
- **CA-002** — Dadas três variáveis inválidas, Quando o processo iniciar, Então a mensagem lista
  **as três**, não apenas a primeira.
- **CA-003** — Dado `PORT=abc`, Quando validar, Então falha informando o valor recebido.
- **CA-004** — Dado `NODE_ENV=production` e `WEBHOOK_SECRET` vazio, Quando o processo iniciar, Então
  ele se recusa a subir.
- **CA-005** — Dado `NODE_ENV` diferente de `production` e `WEBHOOK_SECRET` vazio, Quando chegar uma
  requisição sem token, Então ela é aceita (desenvolvimento continua simples) e o boot avisa.
- **CA-006** — Dado um segredo de 200 caracteres, Quando chegar um token diferente que compartilhe os
  primeiros 128 caracteres, Então é **rejeitado**.
- **CA-007** — Dado um token de comprimento diferente do segredo, Quando comparar, Então a rejeição
  não depende de comparar comprimentos em texto claro.
- **CA-008** — Dada uma requisição no webhook, Quando o log for escrito com a configuração padrão,
  Então **não** contém o payload bruto, e o telefone aparece mascarado.
- **CA-009** — Dado `LOG_PAYLOAD=true`, Quando chegar uma requisição, Então o payload completo é
  registrado (modo de depuração explícito).
- **CA-010** — Dado o `Dockerfile`, Quando a imagem for construída, Então `.env`, `node_modules`,
  `.git`, `test` e `docs` não entram nela.
- **CA-011** — Dado o serviço configurado corretamente, Quando comparar a linha de base HTTP, Então o
  resultado é idêntico ao da referência (nenhuma regressão nas rotas).

## 8. Comportamento observável

**Muda, e é o objetivo:**
- Configuração inválida derruba o boot em vez de falhar em runtime.
- Em produção, requisição sem token é rejeitada.
- O log deixa de conter payload bruto e telefone em claro.

**Não muda:** todo o fluxo de atendimento, as respostas ao cliente e as rotas HTTP.

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Deploy em produção quebrar por variável faltante | **Alta** | **Alto** | É o objetivo — mas a mensagem precisa dizer exatamente o que falta. Checklist de go-live atualizado |
| Mascarar telefone atrapalhar a investigação de incidente | Média | Médio | A máscara preserva DDD e os 4 últimos dígitos, suficientes para correlacionar |
| `LOG_PAYLOAD=true` ficar ligado em produção | Média | Alto | O boot avisa em destaque quando está ligado |

## 10. Métricas de sucesso

- Zero ocorrências de payload bruto no log de produção.
- Nenhuma requisição não autenticada aceita em produção.
- Configuração incorreta detectada em segundos, no boot, e não por um cliente sem resposta.

## 11. Questões em aberto

- [ ] O deploy atual define `NODE_ENV=production`? Se não define, o fail-closed do CA-004 não dispara.
      Precisa entrar no checklist de go-live e no comando do PM2.
