# IA Avelloz Campina — IA Externa (SDR de motos)

Consultor virtual da **Avelloz Campina** (concessionária de motos em Campina Grande e Monteiro–PB), no padrão de IA externa da plataforma **ChatClean** (Webhook de entrada + Push API de saída). Roda num servidor Node.js próprio: acolhe o cliente, faz o **diagnóstico da realidade atual** (como se locomove hoje e quanto gasta), mostra a conta da economia, recomenda o modelo certo, informa **preço promocional (com emplacamento)**, coleta os dados para simulação e **transfere para o consultor humano da loja escolhida**.

> Mesma arquitetura da IA externa `iachatclean`. O **transporte** continua sendo a plataforma ChatClean (a Avelloz é cliente da ChatClean); o que muda é a **persona e o fluxo de negócio** (venda de motos).

## Arquitetura

```
Cliente WhatsApp → ChatClean CRM ──POST /webhook──▶ servidor Node.js
                                                       ↓ GPT-4o-mini (extrai + responde)
Cliente WhatsApp ◀── ChatClean Push API ◀──POST CC_PUSH_URL {number, body, externalKey}
```

O ChatClean cuida só do transporte. Toda a inteligência (persona, diagnóstico, objeções, transbordo) roda aqui.

## O que o bot faz

- **Persona oficial Avelloz:** consultor humano, tom de WhatsApp, sem markdown, no máximo 1 emoji, SEMPRE termina com uma pergunta, anti-jailbreak, nunca revela que é IA.
- **Diagnóstico ANTES do produto (regra inegociável):** não revela preço, modelo nem condição antes de entender transporte atual + gasto mensal + situação de moto. Se o cliente pede preço cedo, redireciona com naturalidade.
- **Vende liberdade e economia:** mostra a conta do que o cliente já gasta hoje (Uber/ônibus/combustível/aluguel de moto) projetada no ano. Trata o perfil especial de quem roda de aplicativo (aluga / começando / quer trocar).
- **Preços liberados** (após o diagnóstico): AZ1, AZ125, AZX160 — sempre como preço promocional já com emplacamento. **Nunca informa valor de parcela** (transfere pro humano).
- **Fechamento:** identifica a loja (Matriz, Malvinas ou Monteiro — obrigatório), coleta os dados de simulação (CPF, nascimento, nome, telefone, CNH, cor/modelo) e **transfere para o departamento da loja escolhida**.
- **Regras específicas:** não aceita moto usada na troca, não faz test drive, nunca promete prazo de entrega, CNH não é obrigatório pra comprar.
- **Mídia:** áudio transcrito (Whisper); imagem lida por visão (gpt-4o); documento/vídeo têm acuse humanizado.
- **Estado durável:** conversas no Redis (fallback em memória) + follow-up de reativação após 30 min de inatividade.

## Arquivos

| Caminho | Papel |
|---|---|
| `index.js` | Bootstrap: monta as peças e sobe o servidor (95 linhas) |
| `src/main/` | Configuração validada no boot e composition root |
| `src/application/` | Casos de uso, fila de turnos, manipuladores de mídia, portas |
| `src/domain/` | Regras de negócio: atendimento (+políticas), catálogo, expediente, mensageria |
| `src/infrastructure/` | Adapters: HTTP, OpenAI, ChatClean, Redis, memória, terminal, relógio |
| `src/eval/` | Analisadores de regra e roteiros da suíte de evals |
| `test-chat.js` · `sim-lead.js` · `eval.js` | Testers locais — usam o mesmo caso de uso da produção |

Os prompts ficam em `src/infrastructure/openai/prompts/` (versionados) e o funil em
`src/domain/atendimento/`. A arquitetura alvo está em
[docs/10-arquitetura-alvo.md](docs/10-arquitetura-alvo.md); onde cada coisa vive hoje está na seção 4
do [handoff](docs/14-handoff-refatoracao.md).

## Fluxo de qualificação (guia)

Acolher (conhece a marca?) → interesse (pra que quer a moto) → **diagnóstico** (transporte hoje → gasto mensal → situação de moto) → tocar na dor / mostrar a conta → recomendar modelo + preço → forma de pagamento → coletar dados de simulação → **identificar a loja** → transferir pro consultor.

## Modelos (preços promocionais, com emplacamento)

| Modelo | Cilindrada | Preço |
|---|---|---|
| AZ1 | 50cc | R$ 11.390,00 |
| AZ125 | 125cc (Alfa) | R$ 14.190,00 |
| AZX160 | 160cc | R$ 19.990,00 |

## Unidades

- **Loja Matriz** — Rua João Suassuna, 300, Centro — Campina Grande/PB
- **Loja Malvinas** — Av. Francisco Lopes de Almeida, 7, Rocha Cavalcante — Campina Grande/PB
- **Loja Monteiro** — Rua Coronel Francisco Cândido, 11, Loteamento Boa Vista — Monteiro/PB

## Rodar local

```bash
npm install
cp .env.example .env      # preencher OPENAI_API_KEY (e CC_PUSH_URL p/ o servidor)
npm run chat              # conversa interativa no terminal (só precisa da OpenAI)
npm run sim               # simulação de qualificação completa (motoboy/moto alugada)
npm start                 # sobe o servidor (webhook/Push)
```

## Testes

```bash
npm test          # suíte completa: 459 testes, ~3s, sem rede e sem custo de OpenAI
npm run test:watch
npm run coverage
npm run lint      # inclui as fronteiras da arquitetura
npm run typecheck # tipos em domínio, aplicação e compartilhado
```

A suíte cobre a lógica pura (funil, expediente, catálogo, telefone), congela o comportamento do
`parsePayload` e do resumo de transbordo, e roda o turno completo com OpenAI, ChatClean e Redis
falsificados. Nada nela chama serviço externo.

Além dela há a **linha de base executável**, que sobe o servidor de verdade com ambiente controlado
e compara a resposta de todas as rotas:

```bash
bash test/baseline/coletar-baseline.sh <rotulo>
diff test/baseline/antes-da-refatoracao-requisicoes.log test/baseline/<rotulo>-requisicoes.log
```

Detalhes em [docs/12-linha-de-base.md](docs/12-linha-de-base.md).

## Refatoração

O projeto foi refatorado para DDD + arquitetura hexagonal pela técnica Strangler Fig, na branch
`refatoracao/arquitetura-ddd` — que **nunca foi mesclada na `main`**.

**Se você está assumindo o projeto, comece por
[docs/14-handoff-refatoracao.md](docs/14-handoff-refatoracao.md)**: o contexto, o antes e depois, o
que mudou de comportamento (pouco, e declarado), o que não mudou e as dívidas que dependem de
decisão do negócio. Depois: [CLAUDE.md](CLAUDE.md), [docs/README.md](docs/README.md) e o processo em
[specs/README.md](specs/README.md).

`GET /health` → `{ status: 'ok' }` · `GET /leads` e `GET /diag` exigem `ADMIN_KEY`.

## Deploy (Hostinger)

1. Subir o projeto para o servidor (git ou upload) e `npm install --omit=dev` (ou `npm ci`).
2. Definir as variáveis de ambiente do `.env.example` (OpenAI, `CC_PUSH_URL`, `EQUIPE_NUMERO`, `REDIS_URL`, `REDIS_PREFIX=avellozcg`).
3. Manter o processo vivo (PM2 recomendado): `NODE_ENV=production pm2 start index.js --name iaavellozcg`.

   > **`NODE_ENV=production` é obrigatório.** Com ele, o servidor se recusa a subir sem
   > `WEBHOOK_SECRET` e sem `CC_PUSH_URL` — é o que impede o webhook de ficar aberto por esquecimento.
   > Sem `NODE_ENV=production`, essa proteção não dispara.
   >
   > A configuração é validada no boot: se faltar alguma variável ou algum valor for inválido, o
   > processo encerra listando **todos** os problemas, antes de abrir a porta.
4. Expor a porta `3000` atrás do proxy/HTTPS do domínio.
5. No painel ChatClean da conta da Avelloz (Configurações → API/Webhook):
   - **URL Webhook** = `https://SEU_DOMINIO/webhook` e **marcar o evento de mensagem recebida** (sem evento, nada dispara).
   - **Token de autenticação** = o mesmo valor de `WEBHOOK_SECRET` (o ChatClean envia como header `Authorization`).
   - `CC_PUSH_URL` é gerada nessa mesma tela (Adicionar) — cuidado: ela regenera quando a sessão de WhatsApp reconecta.
6. Teste com o número em `IA_ALLOWED_CONTACTS` antes do go-live; para abrir a todos, esvazie a lista.

> Também roda em Docker (`Dockerfile` incluso, porta 3000) caso prefira container.

---

*Avelloz Campina — Campina Grande & Monteiro/PB | IA Externa (via ChatClean)*
