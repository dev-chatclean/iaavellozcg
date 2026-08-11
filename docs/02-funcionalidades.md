# 02 — Funcionalidades

Catálogo funcional do sistema como ele existe hoje. Cada item traz o identificador `RF-NNN`, onde
está implementado e as regras de negócio associadas.

---

## F1 — Atendimento conversacional

### RF-001 — Receber mensagem do WhatsApp via webhook
`index.js: handleWebhook, parsePayload`
Recebe POST do ChatClean em `/webhook` ou `/webhook/:token`. Responde 200 imediatamente e processa em
background (evita retry do provedor). Suporta três formatos de payload: aninhado ChatClean
(`contact` + `message`), plano (`number`/`body`/`type`) e WABA (número em `message.raw.from`).
Relacionado: RN-050, RN-051, RN-052.

### RF-002 — Responder via Push API
`index.js: ccPush, enviarMensagem`
POST para `CC_PUSH_URL` com `{ number, body, externalKey }`. O `externalKey` é um UUID por mensagem
(idempotência do lado do ChatClean). Falha de envio é logada e retorna `false` — **não há retry**.

### RF-003 — Quebrar a resposta em mensagens curtas
`index.js: enviarMensagensQuebradas`
Divide a resposta por quebras de linha e envia cada parte com atraso simulando digitação
(`900 + tamanho × 18` ms). Exceção: textos que casam com `/encaminhando|consultor|especialista|resumo|repassando/i`
são enviados inteiros. Ver dívida D-08 (heurística frágil).

### RF-004 — Agrupar mensagens rápidas do mesmo cliente
`index.js: enfileirar, proximaUnidade, drenarFila`
Mensagens de texto consecutivas dentro de `AGRUPAR_MENSAGENS_MS` (padrão 2s) viram um único turno,
concatenadas por `\n`. Mídia nunca é agrupada e drena imediatamente. Fila serial por `chatId`:
nenhuma mensagem é descartada por concorrência.

### RF-005 — Gerar resposta com persona de consultor humano
`index.js: gerarRespostaIA` · `prompts.js: SYSTEM_SDR, promptResposta`
`gpt-4o-mini`, temperatura 0.7, system estático + últimas 10 entradas do histórico + rodapé dinâmico
com o estado do atendimento. Relacionado: RN-020 a RN-023.

### RF-006 — Fallback em falha da OpenAI
`index.js: processarMensagem (catch da geração)`
Envia "Opa, tive uma instabilidade rapidinha por aqui Pode me mandar de novo o que você disse?" e
encerra o turno preservando o que já foi extraído.

---

## F2 — Qualificação e diagnóstico

### RF-010 — Extrair campos estruturados da mensagem
`index.js: extrairInformacoesComIA` · `prompts.js: promptExtracao`
`gpt-4o-mini`, temperatura 0, `response_format: json_object`. Campos extraídos: `nome`, `finalidade`,
`transporteAtual`, `gastoMensal`, `situacaoMoto`, `modeloInteresse`, `formaPagamento`, `loja`, `cpf`,
`dataNascimento`, `nomeCompleto`, `telefone`, `cnh`, `corModelo`, além dos sinais `querFalarComHumano`,
`perguntou`, `tipoContato`, `objecao` e `correcao[]`.

### RF-011 — Conduzir o funil por state machine
`flow.js: determinarProximoCampo`
Retorna o próximo campo vazio na ordem oficial e a instrução correspondente para o modelo. Quando
todos estão preenchidos, marca `qualificacaoCompleta`. Relacionado: RN-002.

### RF-012 — Aplicar campos com política de sobrescrita
`flow.js: aplicarCampos`
Não sobrescreve o que já foi coletado, **exceto**: campos mutáveis (`modeloInteresse`,
`formaPagamento`, `loja`, `corModelo`, `cnh`) e campos que o cliente está corrigindo explicitamente
(`correcao[]`). Relacionado: RN-003.

### RF-013 — Detectar o perfil de dor do lead
`flow.js: detectarPerfil` · `data.js: PERFIS`
Classificação por palavras-chave, com ordem de precedência (casos de aplicativo antes dos genéricos):
`app_aluga`, `app_comecando`, `app_trocar`, `esposa`, `depende_uber`, `depende_onibus`, `tem_carro`,
`primeira_moto`. O perfil injeta um "gancho de dor" no prompt de resposta. É reavaliado quando o
cliente corrige transporte/situação de moto/finalidade.

### RF-014 — Bloquear informação de produto antes do diagnóstico
`prompts.js: SYSTEM_SDR` + flag `diagnosticoCompleto` em `promptResposta`
`diagnosticoCompleto = transporteAtual && gastoMensal && situacaoMoto`. Enquanto falso, o rodapé
instrui o modelo a não revelar preço, modelo, especificação ou condição. **RN-001 — a regra mais
importante do produto.**

### RF-015 — Tratar objeções
`data.js: OBJECOES` + extração + `promptResposta`
Nove objeções mapeadas com resposta consultiva: `juros_financiamento`, `ta_caro`, `preciso_pensar`,
`medo_credito`, `sem_cnh`, `moto_usada_troca`, `test_drive`, `prazo_entrega`, `marca_desconhecida`.
Sinal transitório: vale só para a resposta do turno.

### RF-016 — Evitar repetição do nome do cliente
`prompts.js: promptResposta (usouNomeRecente)`
Se o primeiro nome apareceu em alguma das 2 últimas mensagens do bot, instrui a não usá-lo de novo.

---

## F3 — Mídia

### RF-020 — Transcrever áudio (`audio` / `ptt`)
`index.js: processarMensagem`
Baixa de `mediaBase64` ou `mediaUrl` e envia ao `whisper-1`. Se a transcrição falhar: "Recebi seu
áudio! Por aqui prefiro que a gente converse por texto…" e encerra o turno. Se nem baixar conseguir:
"Recebi seu áudio, mas não consegui abrir por aqui."

### RF-021 — Enxergar imagem (visão)
`index.js: analisarImagem`
`gpt-4o` descreve a imagem em 1–3 frases (foto de moto, print de conversa/anúncio, documento — sem
transcrever dados sensíveis). A descrição entra no histórico e no prompt da resposta, com instrução
explícita de **nunca dizer que não consegue ver imagens**.

### RF-022 — Transcrever a fala de vídeo
`index.js: processarMensagem (tipo === 'video')`
Baixa o mp4 e manda ao Whisper. Sem fala reconhecida, registra apenas "[O cliente enviou um vídeo]".

### RF-023 — Acusar documento
`index.js: processarMensagem (tipo === 'document')`
Responde com acuse humanizado e **encerra o turno** (não gera segunda mensagem). A próxima mensagem
do cliente retoma a qualificação.

### RF-024 — Fallback para mídia não suportada
`index.js: handleWebhook`
Sticker, localização e afins: "Pode me mandar por texto o que você precisa?".

---

## F4 — Transbordo para humano

### RF-030 — Transbordo por qualificação completa
`index.js: processarMensagem (final)` → `notificarEquipe`
Quando `qualificacaoCompleta` é atingida, monta o resumo, publica como **nota interna no ticket**,
envia ao `EQUIPE_NUMERO` (se configurado), grava no histórico de leads e marca `finalizado`.

### RF-031 — Transbordo por pedido explícito
`index.js: processarMensagem` (sinal `querFalarComHumano`)
Chama `encaminhar()`: gera a mensagem de handoff pela própria IA, notifica a equipe e finaliza.

### RF-032 — Roteamento de cliente atual para Pós-venda
`index.js: processarMensagem` (sinal `tipoContato === 'cliente'`)
Mensagem fixa pedindo a unidade de compra + notificação para o departamento **Pós-venda**.

### RF-033 — Resumo estruturado do lead
`index.js: montarResumo`
Contato, perfil, finalidade, transporte atual, gasto, situação de moto, modelo, forma de pagamento,
loja, bloco de dados de simulação (quando houver), retorno sugerido (fora de expediente) e a linha
`-> Transferir para o departamento <X>`.

### RF-034 — Mapeamento loja → departamento
`data.js: lojaParaDepartamento`
Regex sobre o texto da loja: `malvina` → Loja Malvinas; `monteiro` → Loja Monteiro;
`matriz|centro|joão suassuna` → Loja Matriz. Sem correspondência → `Comercial` (fallback).
Relacionado: RN-040, RN-041.

### RF-035 — Atendimento pós-transbordo
`index.js: gerarRespostaPosEncaminhamento`
Depois de `finalizado`, o bot ainda responde dúvidas pontuais com um prompt curto e dedicado — sem
refazer a qualificação, sem repetir o resumo, sem informar parcela ou prazo.

---

## F5 — Expediente e reativação

### RF-040 — Modo plantão fora de expediente
`horario.js: estaEmExpediente` · usado em `encaminhar` e no transbordo
Segunda a sexta 09h–18h e sábado 08h–18h (`America/Recife`), exceto feriados. Fora disso, o transbordo é etiquetado
`FORA DE EXPEDIENTE — AGENDAR RETORNO` e o resumo ganha "Retorno sugerido: <próximo expediente>".

### RF-041 — Calendário de feriados
`horario.js`
Nove feriados nacionais fixos embutidos (incluindo Consciência Negra) + extras via env `FERIADOS`
(`YYYY-MM-DD` para um ano específico ou `MM-DD` recorrente), para feriados móveis e municipais.

### RF-042 — Follow-up de reativação (30 min)
`index.js: agendarFollowUpReativacao, varrerFollowUps, montarMsgReativacao`
Grava `followUpDueAt` no estado (durável, sobrevive a redeploy). Um varredor roda a cada 2 min,
dispara os vencidos e envia mensagem contextual conforme o campo faltante. Nunca repete a mesma
mensagem de reativação duas vezes seguidas.

### RF-043 — Reset por inatividade (24h)
`index.js: processarMensagem`
Passadas `RESET_INATIVIDADE_HORAS` sem interação, o atendimento antigo é descartado e a conversa
recomeça do zero.

### RF-044 — Comando `/reset`
Apaga o estado e responde "Conversa resetada!". Útil em homologação.

---

## F6 — Proteções operacionais

### RF-050 — Autenticação do webhook
`index.js: webhookAutorizado` — token no header (`x-webhook-token` / `Authorization: Bearer`), na
query (`?token=`) ou no path (`/webhook/<secret>`), comparado com `timingSafeEqual`.
**Com `WEBHOOK_SECRET` vazio o webhook fica aberto** (ver risco S4).

### RF-051 — Allow-list de contatos
`index.js: contatoPermitido` — tolerante ao 9º dígito de celular brasileiro
(`5584994610845` ≡ `558494610845`). Lista vazia libera todos.

### RF-052 — Rate-limit por número
`index.js: dentroDoLimite` — janela deslizante em memória, 20 mensagens / 60s por padrão, com poda
defensiva acima de 5000 chaves.

### RF-053 — Blindagem anti-loop com outros bots
`index.js: processarMensagem` — pausa as respostas se o contato passar de `LOOP_MAX_TURNOS` (15) em
`LOOP_JANELA_MIN` (3 min) **ou** repetir a mesma mensagem 3×. Avisa a equipe uma única vez e se
recompõe quando a conversa normaliza.

### RF-054 — Deduplicação de mensagens
`index.js: mensagensProcessadas` — `Set` de `msgId` (últimos 500), em memória.

### RF-055 — Ignorar grupos, eco e ticket assumido
`index.js: ehGrupo, deveResponderTicket` — descarta mensagens de grupo (`@g.us` / `ticket.isGroup`),
o próprio eco (`fromMe`), tickets `closed` e tickets com `userId` humano atribuído (o vendedor aceitou
a conversa). Relacionado: RN-052.

### RF-056 — Lock de processamento
Lock em memória por instância (`processandoMensagem`, timeout 60s) + lock Redis cross-instância
(`SET NX PX`, fail-open).

---

## F7 — Administração e diagnóstico

### RF-060 — `GET /health` (público) — status, uptime, timestamp.
### RF-061 — `GET /diag` (ADMIN_KEY) — expediente atual, reset de inatividade, Redis ativo, push
configurado, número da equipe configurado, diagnóstico do pipeline. Não expõe segredos.
### RF-062 — `GET /leads` (ADMIN_KEY) — atendimentos ativos com nome e flag de finalizado.
### RF-063 — Avisos de configuração no boot — alerta para `CC_PUSH_URL`, `EQUIPE_NUMERO`, `ADMIN_KEY`
e `WEBHOOK_SECRET` ausentes; aborta sem `OPENAI_API_KEY`.

---

## F8 — Ferramentas de desenvolvimento

### RF-070 — `npm run chat` (`test-chat.js`) — REPL no terminal com o mesmo cérebro; comandos
`/reset`, `/estado`, `/sair`. Não usa `response_format: json_object` (**drift** vs. produção).
### RF-071 — `npm run sim` (`sim-lead.js`) — roteiro de 12 mensagens (motoboy com moto alugada),
imprime o resumo da equipe e o custo estimado em tokens. `SIM_DATA` força um horário para testar o
plantão. Reimplementa `montarResumo` (**drift**).

---

## F9 — Funcionalidade inerte

### RF-080 — Oportunidade no CRM (`pipeline.js`) — **código morto**. `criarOportunidade()` nunca é
chamado; só `diag()` aparece no `/diag`. Os comentários descrevem a etapa "REUNIÃO MARCADA" de outro
projeto (`iachatclean`). Decisão pendente: completar ou remover — ver spec `0007`.
