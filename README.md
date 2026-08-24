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

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.js` | Servidor Express: webhook, Push, state machine, Whisper, visão, follow-up, transbordo por loja |
| `data.js` | Conteúdo de negócio (empresa, modelos+preços, formas de pagamento, lojas, oficina, indicação, perfis, objeções, departamentos + IDs) |
| `prompts.js` | `SYSTEM_SDR` (prompt-mestre Avelloz) + extração (temp 0) + resposta (temp 0.7) |
| `flow.js` | State machine de qualificação (pura, compartilhada com os testers) |
| `horario.js` | Expediente do time → modo plantão |
| `store.js` | Estado das conversas em Redis + fallback em memória |
| `pipeline.js` | Oportunidades no CRM — opcional, **desligado por padrão** (fechamento é transferir para o consultor) |

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

Os IDs vêm de **Configurações → Departamentos** no painel e ficam em `data.js`; se forem recriados, sobrescreva pelo `.env` (`DEPT_ID_MATRIZ`, `DEPT_ID_MALVINAS`, `DEPT_ID_MONTEIRO`). `TRANSFERIR_DEPARTAMENTO=false` desliga a transferência automática e volta ao comportamento antigo, em que o atendente encaminha à mão a partir da nota interna.

A IA **só confirma a transferência ao cliente depois que ela acontece**. A ordem em cada fechamento é: grava a nota interna, tenta transferir, e só então responde. Se o CRM recusar a transferência, a IA responde sem prometer o repasse e a equipe recebe o resumo com um alerta para encaminhar à mão.

**Se o ticket não muda de fila:** a plataforma só reposiciona ticket que está *fechado* ou é *primeiro contato* — um ticket já em atendimento tende a ficar onde está. Nesse caso ligue `TRANSFERIR_FECHANDO=true`, que fecha o ticket no mesmo push (`forceTicketToClosed`), o gatilho documentado para ele reabrir já no departamento certo.

**Para diagnosticar sem refazer a conversa**, use o endpoint administrativo, que devolve a resposta crua do CRM:

```
GET /diag/transferir?key=ADMIN_KEY&numero=5583999999999&loja=malvinas
```

Ele responde `transferiu`, `idUsado`, `motivo` e `respostaDoCRM`. Não envia nada ao cliente — a nota é interna. `GET /diag` mostra a configuração ativa em `transferenciaDepartamento`.


## Canal Instagram (API oficial da Meta)

O ChatClean não tem conexão com o Instagram, então o Direct é falado **direto com a Meta**. As mensagens entram por `/webhook/instagram` e as respostas saem por `graph.instagram.com`. Todo o resto — qualificação, diagnóstico, loja, departamento, resumo do lead, follow-up — é o **mesmo fluxo** do WhatsApp.

Quem separa os canais é o prefixo do `chatId`:

| Canal | chatId | Resposta sai por |
|---|---|---|
| WhatsApp | `5583999999999` | Push do ChatClean |
| Instagram | `ig:17841400000000000` | Graph API da Meta |

O prefixo viaja pelo Redis, pela fila e pelo `leadData`, então o app sempre sabe por onde responder.

**Diferença que importa:** um lead do Instagram **não tem ticket no ChatClean**, logo não há fila para mover. O departamento continua sendo calculado pela loja escolhida (mesma regra), mas vira o *endereço* do encaminhamento: o resumo vai para o `EQUIPE_NUMERO` carimbado com a unidade, e o consultor responde pelo Direct. Sem `EQUIPE_NUMERO`, um lead qualificado no Instagram **não chega a ninguém**.

**Janela de 24h:** a Meta só aceita resposta dentro de 24h da última mensagem do cliente, e nunca deixa iniciar conversa. Fora disso a API recusa o envio — o motivo aparece no log.

Variáveis: `IG_TOKEN`, `IG_VERIFY_TOKEN`, `META_APP_SECRET`, `IG_API_VERSION`. Sem `IG_TOKEN` o canal fica inativo e nada muda. `GET /diag` mostra o estado em `instagram`.

## Rodar local

```bash
npm install
cp .env.example .env      # preencher OPENAI_API_KEY (e CC_PUSH_URL p/ o servidor)
npm run chat              # conversa interativa no terminal (só precisa da OpenAI)
npm run sim               # simulação de qualificação completa (motoboy/moto alugada)
npm start                 # sobe o servidor (webhook/Push)
```

`GET /health` → `{ status: 'ok' }` · `GET /leads` e `GET /diag` exigem `ADMIN_KEY`.

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
