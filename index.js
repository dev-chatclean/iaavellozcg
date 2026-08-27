require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// =============================================================
//  CONFIGURAÇÃO — ChatClean (Webhook de entrada + Push API de saída)
//  Variáveis no .env (ver .env.example):
//
//  CC_PUSH_URL     = URL autenticada gerada em Configurações → API/Webhook → Adicionar
//                    (o token JWT já vem embutido como ?token=...; sem header)
//  WEBHOOK_SECRET  = Token opcional para validar o webhook de entrada
//                    (o ChatClean hoje NÃO envia token no header → deixe vazio)
//  EQUIPE_NUMERO   = WhatsApp interno que recebe o resumo dos leads qualificados
//  IA_ALLOWED_CONTACTS = Números liberados na fase de teste (vazio = responde a todos)
//  PORT            = Porta do servidor (padrão: 3000)
// =============================================================
const CC_PUSH_URL    = process.env.CC_PUSH_URL    || '';
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || '';
const EQUIPE_NUMERO  = process.env.EQUIPE_NUMERO  || '';
const IA_ALLOWED_CONTACTS = (process.env.IA_ALLOWED_CONTACTS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT           = process.env.PORT           || 3000;
// Chave para proteger os endpoints administrativos (/leads, /diag), que expõem
// dados de leads e config. Sem ela, esses endpoints ficam BLOQUEADOS (não abertos).
const ADMIN_KEY      = process.env.ADMIN_KEY      || '';
// A IA NÃO responde em grupos por padrão (só conversa individual). Para permitir
// grupos no futuro, defina IGNORAR_GRUPOS=false.
const IGNORAR_GRUPOS = (process.env.IGNORAR_GRUPOS || 'true') !== 'false';
// A IA só responde tickets PENDENTES (na fila). Quando um humano aceita a
// conversa (ticket sai de "pending"), a IA para de responder. Para desativar
// esse filtro, defina IA_SO_PENDENTES=false.
const IA_SO_PENDENTES = (process.env.IA_SO_PENDENTES || 'true') !== 'false';
// Rate-limit por número: no máximo RATE_LIMIT_MSGS mensagens por janela de
// RATE_LIMIT_JANELA_S segundos (proteção contra loop/spam e custo OpenAI).
// 0 desativa. Padrão: 20 msgs / 60s.
const RATE_LIMIT_MSGS   = parseInt(process.env.RATE_LIMIT_MSGS   || '20', 10);
const RATE_LIMIT_JANELA = parseInt(process.env.RATE_LIMIT_JANELA_S || '60', 10) * 1000;
// Blindagem anti-loop (contra outras IAs / auto-respondedores): se um mesmo
// contato trocar mais de LOOP_MAX_TURNOS mensagens em LOOP_JANELA_MIN minutos,
// ou repetir a mesma mensagem, a IA PAUSA as respostas para não entrar em
// ping-pong infinito com outro bot.
const LOOP_MAX_TURNOS = parseInt(process.env.LOOP_MAX_TURNOS || '15', 10);
const LOOP_JANELA_MS  = parseInt(process.env.LOOP_JANELA_MIN || '3', 10) * 60 * 1000;
// Teto de respostas da IA DEPOIS que o lead já foi transferido. Passando disso ela
// se despede e cala: quem conduz o atendimento a partir da transferência é o
// consultor humano, e a IA respondendo em paralelo atropela o trabalho dele.
const MAX_RESPOSTAS_POS_HANDOFF = parseInt(process.env.MAX_RESPOSTAS_POS_HANDOFF || '3', 10);
// Janela (ms) para AGRUPAR mensagens rápidas do mesmo cliente antes de responder.
// No WhatsApp o cliente costuma mandar várias mensagens seguidas; juntamos tudo
// num único turno em vez de responder só a primeira e ignorar o resto.
const AGRUPAR_MS     = parseInt(process.env.AGRUPAR_MENSAGENS_MS || '2000', 10);
// Reinicia o atendimento após N horas sem interação do cliente (padrão: 24h).
const RESET_INATIVIDADE = parseInt(process.env.RESET_INATIVIDADE_HORAS || '24', 10) * 3600 * 1000;
// Transferência REAL do ticket para o departamento da loja escolhida (fila do
// CRM), via forceTicketToDepartment da Push API. Defina false para voltar ao
// comportamento antigo (só a nota interna, encaminhamento manual do atendente).
const TRANSFERIR_DEPARTAMENTO = (process.env.TRANSFERIR_DEPARTAMENTO || 'true') !== 'false';
// A plataforma só reposiciona ticket que está FECHADO ou é primeiro contato. Com
// isto ligado, o push de transferência fecha o ticket junto (forceTicketToClosed),
// que é o gatilho documentado para ele reabrir já no departamento certo. Ligue se
// a transferência simples não mover o ticket de fila.
const TRANSFERIR_FECHANDO = (process.env.TRANSFERIR_FECHANDO || 'false') === 'true';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Os adapters da OpenAI vivem em src/infrastructure/openai. Recebem o cliente
// por injecao e NAO tratam erro: quem chama e que decide entre cair em
// fallback ou propagar, porque isso e decisao de produto, nao de transporte.
const extratorIA = require('./src/infrastructure/openai/ExtratorOpenAI').criar({ cliente: openai });
const redatorIA = require('./src/infrastructure/openai/RedatorOpenAI').criar({ cliente: openai });
const leitorDeImagemIA = require('./src/infrastructure/openai/LeitorDeImagemOpenAI').criar({ cliente: openai });

// =============================================================
//  IA — a cola entre prompt e adapter
// =============================================================
const conversaComIA = require('./src/application/ia/ConversaComIA').criar({
    extrator: extratorIA,
    redator: redatorIA,
    leitorDeImagem: leitorDeImagemIA,
    prompts: require('./prompts')
});

const extrairInformacoesComIA = (msg, campo, hist) => conversaComIA.extrair(msg, campo, hist);
const gerarRespostaIA = (lead, msg, campo, hist, exp) => conversaComIA.redigir(lead, msg, campo, hist, exp);
const analisarImagem = (mediaUrl) => conversaComIA.descreverImagem(mediaUrl);
const gerarRespostaPosEncaminhamento = (lead, msg, hist) => conversaComIA.redigirPosEncaminhamento(lead, msg, hist);

// A transcricao e a UNICA chamada a OpenAI que nao passa pelo SDK: o endpoint
// do Whisper espera multipart, montado a mao. Por isso a chave entra separada.
const transcritorIA = require('./src/infrastructure/openai/TranscritorWhisper').criar({
    http: axios,
    apiKey: process.env.OPENAI_API_KEY
});
const baixadorDeMidia = require('./src/infrastructure/midia/BaixadorHttp').criar({ http: axios });

// Um manipulador por tipo de midia (Strategy). A descricao da imagem entra
// como funcao: a instrucao de visao e o tratamento de erro continuam em
// analisarImagem, logo abaixo.
const manipuladoresDeMidia = require('./src/application/midia/manipuladores').criar({
    baixador: baixadorDeMidia,
    transcritor: transcritorIA,
    descreverImagem: (mediaUrl) => analisarImagem(mediaUrl)
});

const { EMPRESA_INFO, PERFIS, DEPARTAMENTOS, DEPARTAMENTO_IDS, departamentoId, lojaParaDepartamento, OFICINA } = require('./data');
const { determinarProximoCampo, aplicarCampos, detectarPerfil, detectarModeloMencionado } = require('./flow');

// Para onde o atendimento vai quando sai da IA. A regra vive em
// src/domain/atendimento/politicas/PoliticaDeTransbordo.js; o catalogo de
// departamentos entra por parametro, porque quem sabe os IDs cadastrados no
// CRM e a infraestrutura, nao a regra.
// RN-056: teto de mensagens numa janela curta e deteccao de mensagem repetida.
const politicaAntiLoop = require('./src/domain/atendimento/politicas/PoliticaAntiLoop').criar({
    maxTurnos: LOOP_MAX_TURNOS,
    janelaMs: LOOP_JANELA_MS
});

const politicaDeTransbordo = require('./src/domain/atendimento/politicas/PoliticaDeTransbordo').criar({
    resolverLoja: lojaParaDepartamento,
    departamentoDeEntrada: DEPARTAMENTOS.entrada,
    idDoDepartamento: departamentoId,
    departamentoDePosVenda: DEPARTAMENTOS.posvenda
});

const departamentoLead = (leadData) => politicaDeTransbordo.destinoDoLead(leadData);
const departamentoPosVenda = (leadData) => politicaDeTransbordo.destinoDePosVenda(leadData);
const { estaEmExpediente } = require('./horario');
const pipeline = require('./pipeline'); // Oportunidades no CRM (inerte se não configurado)
const store = require('./store'); // estado das conversas (Redis + fallback em memória)

// Lock de atendimento em dois niveis (local + cluster). A coordenacao vive em
// src/application/atendimento/LockDeAtendimento.js.
const lockDeAtendimento = require('./src/application/atendimento/LockDeAtendimento').criar({
    repositorio: store,
    ttlMs: 60000,
    aoExpirar: (chatId) => console.log(`\u{23F1}\u{FE0F} Timeout: liberando processamento para ${chatId}`)
});

// =============================================================
//  UTILITÁRIOS
// =============================================================
// normalizarPhone / nucleoNumero / contatoPermitido vivem em
// src/shared/telefone.js: mesma logica, agora testavel em unidade e sem
// depender de ambiente. A allow-list e passada por parametro, porque o modulo
// compartilhado nao le process.env.
const telefone = require('./src/shared/telefone');
const normalizarPhone = telefone.normalizarPhone;

// Leitura de intencao por texto (rede de seguranca da extracao). As quatro
// expressoes e os casos reais que as justificam vivem em
// src/domain/atendimento/SinaisDoCliente.js.
const SinaisDoCliente = require('./src/domain/atendimento/SinaisDoCliente');
const { PROMETE_TRANSFERENCIA, PEDE_TRANSFERENCIA, PEDE_AGILIDADE, SINAL_ENCERRAMENTO } = SinaisDoCliente;


const contatoPermitido = (numero) => telefone.contatoPermitido(numero, IA_ALLOWED_CONTACTS);

// =============================================================
//  CHATCLEAN — ENVIO VIA PUSH API
//  Um único endpoint autenticado (CC_PUSH_URL) entrega as mensagens.
//  O token JWT já vem embutido na URL como ?token=... (sem header).
// =============================================================
// O transporte vive em src/infrastructure/chatclean/CanalChatClean.js. O axios
// entra por injecao: o adapter nao conhece biblioteca de HTTP, so a porta.
// Continua devolvendo { ok, status, data, erro } — e nao um booleano — porque a
// transferencia de departamento precisa saber o que o CRM respondeu para so
// entao confirmar a transferencia ao cliente.
const canalChatClean = require('./src/infrastructure/chatclean/CanalChatClean').criar({
    http: axios,
    pushUrl: CC_PUSH_URL
});

const ccPush = (number, payloadExtra) => canalChatClean.enviar(number, payloadExtra);


// Como a resposta chega no WhatsApp — quebra em partes e atraso de digitacao —
// vive em src/application/envio/EnvioAoCliente.js.
const envioAoCliente = require('./src/application/envio/EnvioAoCliente').criar({
    canal: canalChatClean
});

const enviarMensagem = (chatId, texto) => envioAoCliente.enviar(chatId, texto);
const enviarMensagensQuebradas = (chatId, texto) => envioAoCliente.enviarEmPartes(chatId, texto);

// Notifica a equipe (nota interna no ticket + WhatsApp interno) quando um lead
// é qualificado, e sinaliza a transferência de departamento no CRM.
// O texto que o vendedor le vive em src/domain/atendimento/MontadorDeResumo.js.
// Catalogo de perfis e IDs de departamento entram por parametro: o dominio nao
// conhece a configuracao do CRM.
const montadorDeResumo = require('./src/domain/atendimento/MontadorDeResumo').criar({
    nomeDoPerfil: (leadData) =>
        leadData.perfilKey && PERFIS[leadData.perfilKey] ? PERFIS[leadData.perfilKey].nome : 'Não informado',
    idDoDepartamento: departamentoId,
    destinoPadrao: (leadData) => departamentoLead(leadData)
});

const montarResumo = (leadData, chatId, opcoes = {}) => montadorDeResumo.montar(leadData, chatId, opcoes);

// O transbordo — nota, transferencia de fila e aviso a equipe — vive em
// src/application/transbordo/Transbordo.js.
const transbordo = require('./src/application/transbordo/Transbordo').criar({
    canal: canalChatClean,
    store,
    estaEmExpediente,
    departamentoLead,
    departamentoId,
    montarResumo,
    enviarMensagem,
    gerarRespostaIA,
    PERFIS,
    DEPARTAMENTOS,
    EQUIPE_NUMERO,
    TRANSFERIR_DEPARTAMENTO,
    TRANSFERIR_FECHANDO
});

const transferirDepartamento = (chatId, dep) => transbordo.transferirDepartamento(chatId, dep);
const notificarEquipe = (leadData, chatId, opcoes) => transbordo.notificarEquipe(leadData, chatId, opcoes);
const encaminhar = (chatId, leadData, dep, msg, hist, exp) => transbordo.encaminhar(chatId, leadData, dep, msg, hist, exp);


// A state machine (determinarProximoCampo / aplicarCampos / detectarPerfil)
// vive em ./flow para ser reusada pelo tester local sem duplicar lógica.

// =============================================================
//  FOLLOW-UP DE REATIVAÇÃO (durável — sobrevive a redeploy)
//  Guarda leadData.followUpDueAt e um varredor dispara os vencidos.
// =============================================================
const TEMPO_INATIVIDADE = 30 * 60 * 1000; // 30 min sem resposta → reativação
const FOLLOWUP_SWEEP    = 2 * 60 * 1000;  // varre a cada 2 min

function agendarFollowUpReativacao(leadData) {
    if (leadData.finalizado) { leadData.followUpDueAt = null; return; }
    leadData.followUpDueAt = Date.now() + TEMPO_INATIVIDADE;
}

function montarMsgReativacao(leadData) {
    const proximo = determinarProximoCampo(leadData);
    if (!proximo) return null;
    const nome = leadData.nome?.split(' ')[0] || '';
    const oi = nome ? `Oi ${nome}` : 'Oi';
    if (proximo.campo === 'finalidade')      return `${oi}! Ainda por aí? Me conta pra que você quer a moto no dia a dia que eu te ajudo a achar a certa 😊`;
    if (proximo.campo === 'transporteAtual') return `${oi}, ainda por aí? Como você tá se locomovendo hoje — Uber, ônibus, carro?`;
    if (proximo.campo === 'gastoMensal')     return `${oi}, seguindo de onde paramos: mais ou menos quanto você gasta por mês com transporte hoje?`;
    if (proximo.campo === 'modeloInteresse') return `${oi}, ainda por aí? Quer que eu te indique o modelo que mais encaixa no seu dia a dia?`;
    if (proximo.campo === 'loja')            return `${oi}, pra eu já adiantar com o consultor: qual unidade fica melhor pra você — Matriz, Malvinas ou Monteiro?`;
    return `${oi}, ainda por aí? Se quiser, seguimos de onde paramos que eu já organizo tudo pro nosso consultor 😊`;
}

async function dispararFollowUpReativacao(chatId, leadData) {
    const msg = montarMsgReativacao(leadData);
    leadData.followUpDueAt = null;
    if (!msg || leadData.followUpUltimo === msg) {
        try { await store.saveLead(chatId, leadData); } catch (_) {}
        return;
    }
    leadData.followUpUltimo = msg;
    try { await store.saveLead(chatId, leadData); } catch (_) {}
    await enviarMensagem(chatId, msg);
    console.log(`📩 Follow-up de reativação enviado para ${chatId}`);
}

async function varrerFollowUps() {
    try {
        const ids = await store.scanLeadIds();
        const agora = Date.now();
        for (const chatId of ids) {
            if (lockDeAtendimento.ocupado(chatId)) continue;
            let leadData;
            try { leadData = await store.getLead(chatId); } catch (_) { continue; }
            if (!leadData || leadData.finalizado) continue;
            if (!leadData.followUpDueAt || leadData.followUpDueAt > agora) continue;
            await dispararFollowUpReativacao(chatId, leadData);
        }
    } catch (e) {
        console.error('Erro no varredor de follow-up:', e.message);
    }
}
// O varredor de follow-up é disparado por iniciar(), no fim deste arquivo, e não
// no carregamento do módulo — senão a suíte, que só importa o arquivo, passaria
// a agendar timers reais. ATENÇÃO: existe UMA chamada de setInterval para o
// varredor no projeto inteiro. Duas fariam o cliente receber a mensagem de
// reativação em dobro.






// =============================================================
//  PROCESSAMENTO DE MENSAGEM
// =============================================================
// O turno vive em src/application/casos-de-uso/ProcessarMensagemRecebida.js.
// Tudo o que ele usa entra por parametro — nada e alcancado por escopo de
// modulo, que era o que tornava impossivel testa-lo sem carregar o index.js
// inteiro.
const casoDeUso = require('./src/application/casos-de-uso/ProcessarMensagemRecebida').criar({
    EQUIPE_NUMERO,
    LOOP_JANELA_MS,
    MAX_RESPOSTAS_POS_HANDOFF,
    OFICINA,
    PEDE_AGILIDADE,
    PEDE_TRANSFERENCIA,
    PROMETE_TRANSFERENCIA,
    RESET_INATIVIDADE,
    SINAL_ENCERRAMENTO,
    agendarFollowUpReativacao,
    aplicarCampos,
    ccPush,
    departamentoLead,
    departamentoPosVenda,
    detectarModeloMencionado,
    detectarPerfil,
    determinarProximoCampo,
    encaminhar,
    enviarMensagem,
    enviarMensagensQuebradas,
    estaEmExpediente,
    extrairInformacoesComIA,
    gerarRespostaIA,
    gerarRespostaPosEncaminhamento,
    lockDeAtendimento,
    manipuladoresDeMidia,
    notificarEquipe,
    politicaAntiLoop,
    store
});

const processarMensagem = (turno) => casoDeUso.processarMensagem(turno);

// =============================================================
//  FILA SERIAL POR CLIENTE + AGRUPAMENTO DE MENSAGENS RÁPIDAS
//  No WhatsApp o cliente manda várias mensagens seguidas. Em vez de
//  processar a primeira e DESCARTAR as demais (o lock antigo fazia isso),
//  enfileiramos tudo por número e processamos em série. Mensagens de TEXTO
//  em sequência são agrupadas num só turno (debounce AGRUPAR_MS); mídia é
//  processada assim que chega (mas ainda em série, nunca descartada).
// =============================================================
// A coordenacao vive em src/application/fila/FilaDeTurnos.js. A fila nao
// mantem o lock: ela apenas pergunta se o cliente ja esta sendo atendido.
const filaDeTurnos = require('./src/application/fila/FilaDeTurnos').criar({
    processarTurno: (turno) => processarMensagem(turno),
    estaProcessando: (chatId) => lockDeAtendimento.ocupado(chatId),
    janelaDeAgrupamentoMs: AGRUPAR_MS,
    aoFalhar: (erro, chatId) => console.error(`\u{274C} Erro ao drenar fila de ${chatId}:`, erro.message)
});

const enfileirar = (parsed) => filaDeTurnos.enfileirar(parsed);

// A traducao do payload vive em src/infrastructure/chatclean/acl/tradutor.js:
// e a unica camada que conhece os tres formatos do ChatClean. Ela devolve um
// MOTIVO nomeado de descarte; a decisao de logar continua aqui, para o log
// permanecer identico ao de antes.
const aclChatClean = require('./src/infrastructure/chatclean/acl/tradutor');
const MotivoDeDescarte = require('./src/domain/mensageria/MotivoDeDescarte');

const ehGrupo = aclChatClean.ehGrupo;
const ticketStatus = aclChatClean.ticketStatus;
const deveResponderTicket = (body = {}, msg = {}) => aclChatClean.deveResponderTicket(body, msg, IA_SO_PENDENTES);

const tradutorDePayload = aclChatClean.criar({
    ignorarGrupos: IGNORAR_GRUPOS,
    soPendentes: IA_SO_PENDENTES
});

// =============================================================
//  WEBHOOK — PARSE DO PAYLOAD DO CHATCLEAN
// =============================================================
function parsePayload(body) {
    const r = tradutorDePayload.traduzir(body);
    if (r.mensagem) return r.mensagem;

    const { motivo, detalhe } = r.descarte;
    if (motivo === MotivoDeDescarte.GRUPO) {
        console.log('\u{1F465} Mensagem de grupo ignorada');
    } else if (motivo === MotivoDeDescarte.TICKET_ASSUMIDO) {
        console.log(`\u{23ED}\u{FE0F} Ticket "${detalhe}" (aceito/atendido por humano) — IA não responde`);
    } else if (motivo === MotivoDeDescarte.DISPARO_DUPLICADO) {
        console.log('\u{21A9}\u{FE0F} Ignorando disparo duplicado (formato numero_cliente)');
    } else if (motivo === MotivoDeDescarte.FORMATO_DESCONHECIDO) {
        console.log('\u{26A0}\u{FE0F} Payload não reconhecido:', JSON.stringify(detalhe, null, 2).slice(0, 800));
    } else if (motivo === MotivoDeDescarte.ERRO_DE_PARSE) {
        console.error('\u{274C} Erro ao fazer parse do payload:', detalhe.message);
    }
    return null;
}

const mensagensProcessadas = new Set(); // dedup de webhooks
const TIPOS_SUPORTADOS = ['text', 'image', 'document', 'audio', 'ptt', 'video'];

// Valida o token do webhook contra WEBHOOK_SECRET. Aceita no header
// (x-webhook-token / Authorization: Bearer), na query (?token=) ou no path
// (/webhook/<token>). Se WEBHOOK_SECRET estiver vazio, o webhook fica aberto
// (compat) — CONFIGURE-O antes do go-live e aponte a URL do ChatClean para
// https://.../webhook/<secret> (ou .../webhook?token=<secret>).
function webhookAutorizado(req) {
    if (!WEBHOOK_SECRET) return true;
    const raw = req.headers['x-webhook-token'] || req.headers['authorization'] || req.query.token || req.params.token || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    if (token.length !== WEBHOOK_SECRET.length) return false;
    const a = Buffer.from(token.padEnd(128).slice(0, 128));
    const b = Buffer.from(WEBHOOK_SECRET.padEnd(128).slice(0, 128));
    return crypto.timingSafeEqual(a, b);
}

// Rate-limit por número (janela deslizante em memória, por instância).
const rateHits = new Map(); // chatId -> [timestamps]
function dentroDoLimite(chatId) {
    if (!RATE_LIMIT_MSGS) return true; // desativado
    const agora = Date.now();
    const hits = (rateHits.get(chatId) || []).filter(t => agora - t < RATE_LIMIT_JANELA);
    hits.push(agora);
    rateHits.set(chatId, hits);
    if (rateHits.size > 5000) { // poda defensiva
        for (const [k, v] of rateHits) {
            if (!v.length || agora - v[v.length - 1] > RATE_LIMIT_JANELA) rateHits.delete(k);
        }
    }
    return hits.length <= RATE_LIMIT_MSGS;
}

async function handleWebhook(req, res) {
    res.status(200).json({ status: 'ok' }); // responde rápido (evita retry do ChatClean)
    try {
        if (!webhookAutorizado(req)) {
            console.warn('⚠️ Webhook com token inválido ou ausente — ignorado.');
            return;
        }

        console.log('🔍 PAYLOAD RAW:', JSON.stringify(req.body, null, 2).slice(0, 4000));

        const parsed = parsePayload(req.body);
        if (!parsed) return;

        console.log(`📩 Webhook de ${parsed.chatId} [${parsed.tipo}]: "${parsed.texto || '[mídia]'}"`);

        if (!contatoPermitido(parsed.chatId)) {
            console.log(`🚫 Contato ${parsed.chatId} fora da lista de teste — ignorado`);
            return;
        }

        // Rate-limit por número (anti-spam / loop / proteção de custo OpenAI).
        if (!dentroDoLimite(parsed.chatId)) {
            console.warn(`🚦 Rate-limit: ${parsed.chatId} passou de ${RATE_LIMIT_MSGS}/${RATE_LIMIT_JANELA / 1000}s — ignorando.`);
            return;
        }

        if (parsed.msgId) {
            if (mensagensProcessadas.has(parsed.msgId)) {
                console.log(`↩️ Mensagem duplicada (${parsed.msgId}) ignorada`);
                return;
            }
            mensagensProcessadas.add(parsed.msgId);
            if (mensagensProcessadas.size > 500) {
                [...mensagensProcessadas].slice(0, 200).forEach(id => mensagensProcessadas.delete(id));
            }
        }

        // Mídia não suportada (sticker, localização...) → fallback humanizado
        if (!TIPOS_SUPORTADOS.includes(parsed.tipo)) {
            await enviarMensagem(parsed.chatId, 'Pode me mandar por texto o que você precisa? Assim consigo te ajudar melhor 🙂');
            return;
        }

        // Enfileira (nunca descarta): agrupa mensagens rápidas e processa em série.
        enfileirar(parsed);
    } catch (e) {
        console.error('❌ Erro no handler do webhook:', e);
    }
}

// Aceita o token embutido no path (/webhook/<secret>) ou em /webhook (header/query).
app.post('/webhook', express.json({ limit: '10mb' }), handleWebhook);
app.post('/webhook/:token', express.json({ limit: '10mb' }), handleWebhook);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
// GET de validação do webhook (alguns painéis testam a URL com GET antes de
// disparar). Responde 200 tanto em /webhook quanto em /webhook/<token>, senão
// a URL com o token no caminho daria 404 e o provedor não dispararia.
const webhookPing = (req, res) => res.status(200).json({ status: 'ok' });
app.get('/webhook', webhookPing);
app.get('/webhook/:token', webhookPing);

// Guard dos endpoints administrativos. Aceita a chave em ?key=, no header
// x-admin-key ou Authorization: Bearer. Sem ADMIN_KEY configurada, BLOQUEIA
// (nunca deixa /leads e /diag abertos ao público por omissão).
function checarAdmin(req, res) {
    if (!ADMIN_KEY) {
        res.status(503).json({ erro: 'ADMIN_KEY não configurada no servidor' });
        return false;
    }
    const raw = req.query.key || req.headers['x-admin-key'] || req.headers['authorization'] || '';
    const key = String(raw).replace(/^Bearer\s+/i, '');
    if (key !== ADMIN_KEY) {
        res.status(401).json({ erro: 'não autorizado' });
        return false;
    }
    return true;
}

// Diagnóstico de produção: confere expediente, Redis e config de Push/pipeline.
// Não expõe segredos.
app.get('/diag', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    res.json({
        ok: true,
        expediente: estaEmExpediente(),
        resetInatividadeHoras: RESET_INATIVIDADE / 3600000,
        redis: store.isRedis(),
        pushConfigurado: !!CC_PUSH_URL,
        equipeNumero: !!EQUIPE_NUMERO,
        transferenciaDepartamento: { ativa: TRANSFERIR_DEPARTAMENTO, fechandoTicket: TRANSFERIR_FECHANDO, ids: DEPARTAMENTO_IDS },
        pipeline: pipeline.diag()
    });
});

// Testa a transferência de um ticket SEM precisar refazer a conversa inteira.
// Ex.: /diag/transferir?key=ADMIN&numero=5583999999999&loja=malvinas
// Retorna a resposta CRUA do CRM — é assim que se descobre por que um ticket não
// muda de fila. Não manda nada para o cliente (a nota é interna).
app.get('/diag/transferir', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    const numero = String(req.query.numero || '').trim();
    const loja   = String(req.query.loja || '').trim();
    if (!numero) return res.status(400).json({ erro: 'informe ?numero=55DDNNNNNNNNN' });

    const departamento = lojaParaDepartamento(loja) || DEPARTAMENTOS[loja] || loja || DEPARTAMENTOS.entrada;
    const r = await transferirDepartamento(normalizarPhone(numero), departamento);
    res.json({
        numeroEnviado: normalizarPhone(numero),
        departamento, idUsado: r.id || departamentoId(departamento),
        fechandoTicket: TRANSFERIR_FECHANDO,
        transferiu: r.ok,
        motivo: r.motivo,
        respostaDoCRM: r.resposta
    });
});

// Histórico de leads qualificados (útil pra conferência rápida)
app.get('/leads', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    try {
        const ids = await store.scanLeadIds();
        const ativos = [];
        for (const id of ids) {
            try { const l = await store.getLead(id); if (l) ativos.push({ chatId: id, nome: l.nome, empresa: l.empresa, finalizado: !!l.finalizado }); } catch (_) {}
        }
        res.json({ total: ativos.length, ativos });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// =============================================================
//  INICIALIZAÇÃO
//
//  Tudo que tem efeito colateral no processo — abrir a porta, agendar o
//  varredor de follow-up, registrar handlers de sinal, encerrar por falta de
//  chave — vive dentro de iniciar(), chamada só quando o arquivo é executado
//  direto (`node index.js`). Assim a suíte consegue importar o módulo para
//  testar o turno SEM subir servidor nem disparar timer.
//
//  Em produção o comportamento é idêntico: a ordem das operações é a mesma, e
//  a linha de base confirma isso rodando o servidor de verdade.
// =============================================================
function iniciar() {
// Falha RÁPIDO e claro se faltar a chave da OpenAI: antes era checado dentro do
// callback do listen, ou seja, a porta abria, o healthcheck passava e só então o
// processo morria — virando crash-loop difícil de ler no log do container.
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY não configurada — a IA não sobe. Defina a variável de ambiente e faça o deploy de novo.');
    process.exit(1);
}

setInterval(varrerFollowUps, FOLLOWUP_SWEEP).unref?.();

let servidorPronto = false;
const server = app.listen(PORT, () => {
    servidorPronto = true;
    console.log('');
    console.log('🚀 ================================');
    console.log(`🏍️  IA ${EMPRESA_INFO.nome} — VIA CHATCLEAN (Webhook + Push)`);
    console.log(`📡 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Webhook: https://SEU_DOMINIO/webhook`);
    console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
    console.log('🚀 ================================');
    console.log('');
    if (!CC_PUSH_URL)   console.warn('⚠️  CC_PUSH_URL não configurado — a IA não conseguirá responder.');
    if (!EQUIPE_NUMERO) console.warn('ℹ️  EQUIPE_NUMERO não configurado — resumo de lead só irá como nota interna.');
    if (!ADMIN_KEY)     console.warn('🔒 ADMIN_KEY não configurada — /leads e /diag ficarão BLOQUEADOS (503). Defina para liberar o acesso administrativo.');
    if (!WEBHOOK_SECRET) console.warn('🔓 WEBHOOK_SECRET vazio — /webhook está ABERTO. Antes do go-live, defina-o e aponte a URL do ChatClean para /webhook/<secret>.');
    console.log(store.isRedis()
        ? '🗄️  Estado das conversas: Redis (persistente)'
        : '🗄️  Estado das conversas: memória (defina REDIS_URL para persistir entre restarts)');
});

// Encerramento limpo: fecha o servidor HTTP (para de aceitar conexões novas e
// deixa as em andamento terminarem) antes de sair. Se algo travar, sai mesmo
// assim em 8s para não deixar o container pendurado.
//
// Se o container morre e este log NÃO aparece, o sinal não chegou ao Node — é o
// caso de quando a plataforma inicia o app por "npm start": o npm vira PID 1,
// recebe o SIGTERM e não repassa, e o log fica só com o
// "npm error signal SIGTERM". Nesse cenário, configure o start command como
// "node index.js" (é o que o Dockerfile já faz).
let encerrando = false;
// Falha ao subir (porta ocupada, permissão) é FATAL: precisa sair com código
// de erro para a plataforma tratar como falha, não como parada limpa.
server.on('error', (e) => {
    console.error('❌ Não foi possível subir o servidor:', e.message);
    process.exit(1);
});

async function shutdown(signal) {
    if (encerrando) return;
    encerrando = true;
    console.log(`\n⚠️  Recebido sinal ${signal}. Encerrando servidor...`);
    setTimeout(() => process.exit(0), 8000).unref();
    server.close(() => {
        console.log('✅ Servidor encerrado.');
        process.exit(0);
    });
}
// Rede de segurança: um erro solto (promessa rejeitada sem catch, falha de
// socket do Redis/axios) NÃO pode derrubar o atendimento inteiro. O Node encerra
// o processo por padrão nesses casos, o que no container vira restart e 502 pra
// quem estiver conversando. Aqui a gente loga e segue servindo.
process.on('unhandledRejection', (motivo) => {
    console.error('❌ Promessa rejeitada sem tratamento:', motivo?.stack || motivo);
});
process.on('uncaughtException', (erro) => {
    console.error('❌ Exceção não capturada:', erro?.stack || erro);
    // Antes de o servidor estar no ar, qualquer exceção é falha de
    // inicialização: sair com 0 faria um erro fatal parecer parada normal.
    if (!servidorPronto) process.exit(1);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));

return server;
}

if (require.main === module) iniciar();

// Exportado para a suíte de testes. Em produção nada consome este objeto — o
// servidor sobe pelo iniciar() acima.
module.exports = {
    app,
    iniciar,
    parsePayload,
    ehGrupo,
    deveResponderTicket,
    ticketStatus,
    webhookAutorizado,
    dentroDoLimite,
    montarResumo,
    departamentoLead,
    transferirDepartamento,
    processarMensagem,
    montarMsgReativacao,
    agendarFollowUpReativacao,
    varrerFollowUps,
    enviarMensagensQuebradas,
    handleWebhook
};
