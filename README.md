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
- **Fechamento:** identifica a loja (Matriz, Malvinas ou Monteiro — obrigatório), coleta os dados de simulação (CPF, nascimento, nome, telefone, CNH, cor/modelo) e **transfere o ticket para o departamento da loja escolhida** (ver abaixo).
- **Peças, revisão e manutenção:** assunto da oficina — a IA passa o contato direto **(83) 98207-3221** e não tenta diagnosticar defeito nem cotar serviço.
- **Programa de indicação ("Indicou, comprou, ganhou!"):** quem indica passa nome e telefone do possível comprador a um vendedor **antes** da compra; fechando, ganha R$ 50 (AZ1), R$ 100 (AZ125) ou R$ 150 (AZX160). Indicação reivindicada **depois** da compra não é paga.
- **Regras específicas:** não aceita moto usada na troca, não faz test drive, nunca promete prazo de entrega, CNH não é obrigatório pra comprar.
- **Mídia:** áudio transcrito (Whisper); imagem lida por visão (gpt-4o); documento/vídeo têm acuse humanizado.
- **Estado durável:** conversas no Redis (fallback em memória) + follow-up de reativação após 30 min de inatividade.

## Onde o código vive

```
index.js                 bootstrap: monta, sobe, encerra (235 linhas)

src/
  domain/                REGRAS. Nao conhece rede, banco nem ambiente.
    atendimento/           Funil, MontadorDeResumo, SinaisDoCliente
      politicas/           Diagnostico (RN-001), Transbordo, AntiLoop
    catalogo/              modelos, precos, lojas, objecoes, departamentos
    expediente/            horario de atendimento e feriados
    mensageria/            motivos de descarte

  application/           COORDENACAO. Orquestra o dominio e as portas.
    casos-de-uso/          ProcessarMensagemRecebida — o turno
    transbordo/            entrega do lead ao vendedor
    ia/                    cola entre prompt e adapter
    fila/ envio/ midia/ reativacao/ atendimento/
    portas/                contratos do mundo externo

  infrastructure/        O MUNDO. Fala com quem esta fora.
    chatclean/             Push API + ACL dos tres formatos de payload
    openai/                extrator, redator, visao, Whisper, prompts/
    redis/ memoria/        estado das conversas
    http/ midia/ terminal/

  main/                  COMPOSICAO. Quem e cada dependencia.
    config.js              o UNICO lugar que le process.env
    container.js           monta tudo, na ordem

store.js pipeline.js     legado remanescente (montagem e /diag)
test-chat.js sim-lead.js testers locais — usam o atendimento de producao
```

**A regra de dependencia:** `domain` nao importa nada de fora; `application`
usa `domain` e as portas; `infrastructure` implementa as portas; `main` conhece
todos. O lint barra cada uma dessas fronteiras — e a barreira foi testada com
violacao proposital.

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

## Transferência entre departamentos

A loja que o **cliente escolhe** define o departamento de destino. Ao qualificar o lead, a IA faz três coisas no ticket, nesta ordem:

1. grava a **nota interna** com o resumo completo do lead;
2. **transfere o ticket** para a fila da unidade, via `forceTicketToDepartment: true` + `queueId: <ID>` da Push API;
3. manda o resumo pro WhatsApp interno (se `EQUIPE_NUMERO` estiver definido).

| Departamento | ID | Quando |
|---|---|---|
| Agente IA | — | porta de entrada: onde o lead nasce e fica enquanto a IA atende |
| Loja Matriz | 228 | cliente escolheu a Matriz (ou citou Centro / João Suassuna) |
| Loja Malvinas | 230 | cliente escolheu Malvinas |
| Loja Monteiro | 231 | cliente escolheu Monteiro |

Se o cliente não chegar a escolher uma unidade, **não há transferência**: o ticket permanece no Agente IA, com a nota do resumo, para a equipe direcionar. Isso é fluxo normal, não falha — a equipe só é alertada quando a transferência era esperada e o CRM a recusou. Cliente antigo pedindo pós-venda é encaminhado para a unidade onde comprou; se a operação criar um departamento próprio de pós-venda, basta preencher `DEPT_ID_POSVENDA`.

Os IDs vêm de **Configurações → Departamentos** no painel e ficam em `src/domain/catalogo/Catalogo.js`; se forem recriados, sobrescreva pelo `.env` (`DEPT_ID_MATRIZ`, `DEPT_ID_MALVINAS`, `DEPT_ID_MONTEIRO`). `TRANSFERIR_DEPARTAMENTO=false` desliga a transferência automática e volta ao comportamento antigo, em que o atendente encaminha à mão a partir da nota interna.

A IA **só confirma a transferência ao cliente depois que ela acontece**. A ordem em cada fechamento é: grava a nota interna, tenta transferir, e só então responde. Se o CRM recusar a transferência, a IA responde sem prometer o repasse e a equipe recebe o resumo com um alerta para encaminhar à mão.

**Se o ticket não muda de fila:** a plataforma só reposiciona ticket que está *fechado* ou é *primeiro contato* — um ticket já em atendimento tende a ficar onde está. Nesse caso ligue `TRANSFERIR_FECHANDO=true`, que fecha o ticket no mesmo push (`forceTicketToClosed`), o gatilho documentado para ele reabrir já no departamento certo.

**Para diagnosticar sem refazer a conversa**, use o endpoint administrativo, que devolve a resposta crua do CRM:

```
GET /diag/transferir?key=ADMIN_KEY&numero=5583999999999&loja=malvinas
```

Ele responde `transferiu`, `idUsado`, `motivo` e `respostaDoCRM`. Não envia nada ao cliente — a nota é interna. `GET /diag` mostra a configuração ativa em `transferenciaDepartamento`.

## Rodar local

```bash
npm install
cp .env.example .env      # preencher OPENAI_API_KEY (e CC_PUSH_URL p/ o servidor)
npm run chat              # conversa interativa no terminal (só precisa da OpenAI)
npm run sim               # simulação de qualificação completa (motoboy/moto alugada)
npm start                 # sobe o servidor (webhook/Push)
```

`GET /health` → `{ status: 'ok' }` · `GET /leads` e `GET /diag` exigem `ADMIN_KEY`.

## Testes

```bash
npm test          # 711 testes, ~5s, sem rede e sem custo de OpenAI
npm run lint      # fronteiras da arquitetura, verificadas
npm run coverage
```

A suíte cobre o domínio, os adapters (com fakes injetados), o contrato do
repositório rodando contra Redis **e** memória, e o turno completo de ponta a
ponta. Nada nela chama serviço externo.

Além dela há a **linha de base executável**, que sobe o servidor de verdade e
compara a resposta de todas as rotas:

```bash
bash test/baseline/coletar-baseline.sh <rotulo>
diff test/baseline/producao-develop-requisicoes.log test/baseline/<rotulo>-requisicoes.log
```

Detalhes em [docs/12-linha-de-base.md](docs/12-linha-de-base.md).

## Documentação

| | |
|---|---|
| [docs/12-linha-de-base.md](docs/12-linha-de-base.md) | O comportamento de produção, capturado executando |
| [docs/15-inventario-de-comportamento.md](docs/15-inventario-de-comportamento.md) | O que mudou entre o commit raiz e a produção, e as dívidas catalogadas |
| [docs/16-revisao-da-v2.md](docs/16-revisao-da-v2.md) | Como revisar a refatoração |

Os testes marcados `CONGELA` documentam comportamento que **sabemos estar
errado** e que foi preservado de propósito. A lista completa está no inventário.

## Deploy (Hostinger)

1. Subir o projeto para o servidor (git ou upload) e `npm install --omit=dev` (ou `npm ci`).
2. Definir as variáveis de ambiente do `.env.example` (OpenAI, `CC_PUSH_URL`, `EQUIPE_NUMERO`, `REDIS_URL`, `REDIS_PREFIX=avellozcg`).
3. Manter o processo vivo (PM2 recomendado): `pm2 start index.js --name iaavellozcg`.
4. Expor a porta `3000` atrás do proxy/HTTPS do domínio.
5. No painel ChatClean da conta da Avelloz (Configurações → API/Webhook):
   - **URL Webhook** = `https://SEU_DOMINIO/webhook` e **marcar o evento de mensagem recebida** (sem evento, nada dispara).
   - **Token de autenticação** = o mesmo valor de `WEBHOOK_SECRET` (o ChatClean envia como header `Authorization`).
   - `CC_PUSH_URL` é gerada nessa mesma tela (Adicionar) — cuidado: ela regenera quando a sessão de WhatsApp reconecta.
6. Teste com o número em `IA_ALLOWED_CONTACTS` antes do go-live; para abrir a todos, esvazie a lista.

> Também roda em Docker (`Dockerfile` incluso, porta 3000) caso prefira container.

---

*Avelloz Campina — Campina Grande & Monteiro/PB | IA Externa (via ChatClean)*
