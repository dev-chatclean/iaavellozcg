// =============================================================
//  INSTAGRAM — canal de mensagens via API OFICIAL da Meta
//
//  A plataforma ChatClean não tem conexão com o Instagram, então o Direct é
//  falado DIRETO com a Meta (graph.instagram.com). Este módulo é só a BORDA:
//  recebe o webhook, traduz para o formato interno do app e envia a resposta.
//
//  Todo o resto — qualificação, prompts, state machine, departamento da loja,
//  resumo do lead, follow-up — continua idêntico e compartilhado com o
//  WhatsApp. Quem separa os dois canais é o PREFIXO do chatId:
//
//     WhatsApp  → "5583999999999"        (número puro)
//     Instagram → "ig:17841400000000000" (prefixo + IGSID)
//
//  O prefixo viaja junto pelo Redis, pela fila e pelo leadData, então o app
//  sempre sabe por onde responder sem precisar de estado extra.
//
//  Env (ver .env.example):
//    IG_TOKEN          = token de acesso da conta profissional (longa duração)
//    IG_VERIFY_TOKEN   = string que você inventa e repete no painel da Meta
//    META_APP_SECRET   = App Secret, usado para validar a assinatura do webhook
//    IG_API_VERSION    = versão da Graph API (padrão: v25.0)
// =============================================================

const axios = require('axios');
const crypto = require('crypto');

const IG_TOKEN        = process.env.IG_TOKEN        || '';
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const IG_API_VERSION  = process.env.IG_API_VERSION  || 'v25.0';

const PREFIXO = 'ig:';

// O canal está utilizável? Sem token não há como responder.
function configurado() { return !!IG_TOKEN; }

// chatId pertence ao Instagram?
function ehInstagram(chatId) { return String(chatId || '').startsWith(PREFIXO); }

// chatId interno ↔ IGSID da Meta
function paraChatId(igsid) { return PREFIXO + String(igsid); }
function igsid(chatId)     { return String(chatId || '').slice(PREFIXO.length); }

// -------------------------------------------------------------
//  VERIFICAÇÃO DO WEBHOOK (GET)
//  A Meta chama a URL uma vez com hub.challenge antes de começar a enviar
//  eventos. Se não devolvermos o challenge CRU (sem JSON, sem aspas), o
//  webhook não é ativado e nada nunca chega.
// -------------------------------------------------------------
function verificacao(req, res) {
    const modo      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (modo === 'subscribe' && IG_VERIFY_TOKEN && token === IG_VERIFY_TOKEN) {
        console.log('✅ Webhook do Instagram verificado pela Meta.');
        return res.status(200).send(String(challenge));
    }
    console.warn('⚠️ Verificação do webhook do Instagram RECUSADA (verify_token não confere).');
    return res.sendStatus(403);
}

// -------------------------------------------------------------
//  ASSINATURA (X-Hub-Signature-256)
//  HMAC-SHA256 do corpo CRU com o App Secret. Sem o corpo cru (req.rawBody)
//  a conta nunca bate: re-serializar o JSON muda espaços e ordem de chaves.
//
//  Sem META_APP_SECRET definido a validação é PULADA (com aviso) — útil para
//  subir rápido em teste, mas em produção deixa o endpoint aberto a qualquer
//  um que descubra a URL. Configure.
// -------------------------------------------------------------
function assinaturaValida(req) {
    if (!META_APP_SECRET) {
        console.warn('⚠️ META_APP_SECRET não configurado — assinatura do webhook do Instagram NÃO validada.');
        return true;
    }
    const recebida = String(req.headers['x-hub-signature-256'] || '');
    if (!recebida.startsWith('sha256=') || !req.rawBody) return false;

    const esperada = 'sha256=' + crypto
        .createHmac('sha256', META_APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    // Comparação em tempo constante (evita timing attack). timingSafeEqual
    // explode se os tamanhos diferirem, por isso o teste de length antes.
    if (recebida.length !== esperada.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
    } catch (_) { return false; }
}

// -------------------------------------------------------------
//  PARSE DO PAYLOAD (POST)
//  Formato da Meta: { object: "instagram", entry: [ { messaging: [ ... ] } ] }
//  Um único POST pode trazer VÁRIOS eventos, de contatos diferentes — daí o
//  retorno ser uma lista.
//
//  Devolve o mesmo formato que o parsePayload do ChatClean produz, para o
//  processarMensagem não saber de que canal veio.
// -------------------------------------------------------------
function parsePayload(body) {
    const eventos = [];
    if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) return eventos;

    for (const entry of body.entry) {
        const lista = entry.messaging || entry.changes || [];
        for (const ev of lista) {
            const msg = ev.message || (ev.value && ev.value.message);
            if (!msg) continue;                       // leitura, reação, postback → ignora
            if (msg.is_echo) continue;                // eco da nossa própria resposta
            if (msg.is_deleted || msg.is_unsupported) continue;

            const remetente = (ev.sender && ev.sender.id) || (ev.value && ev.value.sender && ev.value.sender.id);
            if (!remetente) continue;

            const anexo = Array.isArray(msg.attachments) && msg.attachments.length ? msg.attachments[0] : null;

            eventos.push({
                chatId:        paraChatId(remetente),
                contactId:     null,
                msgId:         msg.mid ? String(msg.mid) : null,
                texto:         String(msg.text || '').trim(),
                tipo:          tipoDoAnexo(anexo, msg),
                mediaBase64:   null,
                mediaUrl:      anexo && anexo.payload ? (anexo.payload.url || null) : null,
                mediaMimetype: null,
                quotedText:    (msg.reply_to && msg.reply_to.story && msg.reply_to.story.url) ? '[respondeu a um story]' : null,
                nomeContato:   ''    // a Meta não manda o @ no webhook; buscar no perfil se precisar
            });
        }
    }
    return eventos;
}

// Traduz o anexo do Instagram para os tipos que o app já sabe tratar.
// 'share' (post/reel encaminhado) e 'story_mention' viram 'image': o que o
// cliente quis dizer está na imagem, e a IA já enxerga imagem por visão.
function tipoDoAnexo(anexo, msg) {
    if (!anexo) return msg.text ? 'text' : 'unsupported';
    switch (anexo.type) {
        case 'image':
        case 'share':
        case 'story_mention': return 'image';
        case 'video':         return 'video';
        case 'audio':         return 'audio';
        case 'file':          return 'document';
        default:              return 'unsupported';
    }
}

// -------------------------------------------------------------
//  ENVIO
//  POST graph.instagram.com/<versao>/me/messages
//
//  ATENÇÃO à janela de 24h: a Meta só aceita resposta dentro de 24 horas da
//  última mensagem DO CLIENTE, e nunca deixa iniciar conversa. Fora disso a
//  API devolve erro — por isso o motivo vem no log, e não em silêncio.
// -------------------------------------------------------------
async function enviar(chatId, texto) {
    // Usa o token VIGENTE (o renovado, quando existe) — nunca a semente do .env
    // direto, senão o canal para de funcionar na primeira renovação.
    const token = await tokenVigente();
    if (!token) {
        console.warn('⚠️ IG_TOKEN não configurado — resposta do Instagram não enviada.');
        return false;
    }
    const destino = igsid(chatId);
    try {
        await axios.post(
            `https://graph.instagram.com/${IG_API_VERSION}/me/messages`,
            { recipient: { id: destino }, message: { text: String(texto).slice(0, 1000) } },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        return true;
    } catch (e) {
        const erro = e.response?.data?.error;
        // Código 10 / subcódigo 2534022 = fora da janela de 24h. É o erro mais
        // comum aqui e não é bug: a Meta proíbe responder depois desse prazo.
        console.error(`❌ Instagram → ${destino}: ${erro?.message || e.message}` +
            (erro?.code ? ` (code ${erro.code}${erro.error_subcode ? '/' + erro.error_subcode : ''})` : ''));
        return false;
    }
}

// =============================================================
//  RENOVAÇÃO AUTOMÁTICA DO TOKEN
//
//  O token de longa duração vale 60 DIAS. Passando disso ele expira e NÃO PODE
//  MAIS SER RENOVADO — só resta refazer o fluxo de autorização na mão. Ou seja:
//  esquecer de renovar não degrada o canal, mata.
//
//  A Meta renova por GET refresh_access_token, devolvendo um token NOVO com
//  mais 60 dias. Regras dela: o token precisa ter no mínimo 24h de vida e não
//  estar expirado.
//
//  Como o token muda, ele não pode viver só no .env — passa a ser guardado no
//  store (Redis). O .env vira apenas a SEMENTE do primeiro uso.
//
//  Renovamos aos 45 dias, não aos 59, para sobrar margem de retentativa caso a
//  Meta esteja fora do ar justo naquele dia.
// =============================================================
const store = require('./store');

const CHAVE_TOKEN    = 'ig_token';
const RENOVAR_DIAS   = parseInt(process.env.IG_TOKEN_RENOVAR_DIAS || '45', 10);
const VARRER_MS      = 12 * 60 * 60 * 1000;   // confere 2x por dia
const DIA_MS         = 24 * 60 * 60 * 1000;

let cache = null;   // { token, renovadoEm } — evita ler o Redis a cada mensagem

// Token em vigor: o renovado (store) tem precedência sobre a semente (.env).
async function tokenVigente() {
    if (cache && cache.token) return cache.token;
    try {
        const salvo = await store.getConfig(CHAVE_TOKEN);
        if (salvo && salvo.token) { cache = salvo; return salvo.token; }
    } catch (_) { /* sem store, cai na semente */ }
    return IG_TOKEN;
}

async function salvarToken(token, expiraEmSeg) {
    cache = { token, renovadoEm: Date.now(), expiraEmSeg: expiraEmSeg || null };
    try { await store.setConfig(CHAVE_TOKEN, cache); }
    catch (e) { console.error('❌ Não foi possível PERSISTIR o token do Instagram:', e.message); }
}

// Troca o token atual por um novo, com mais 60 dias.
async function renovarToken() {
    const atual = await tokenVigente();
    if (!atual) return { ok: false, motivo: 'sem token configurado' };
    try {
        const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', {
            params: { grant_type: 'ig_refresh_token', access_token: atual },
            timeout: 30000
        });
        if (!data || !data.access_token) return { ok: false, motivo: 'resposta da Meta sem access_token' };
        await salvarToken(data.access_token, data.expires_in);
        const dias = Math.round((data.expires_in || 0) / 86400);
        console.log(`🔑 Token do Instagram renovado — válido por mais ~${dias} dias.`);
        return { ok: true, expiraEmDias: dias };
    } catch (e) {
        const erro = e.response?.data?.error;
        console.error(`❌ Falha ao renovar o token do Instagram: ${erro?.message || e.message}`);
        return { ok: false, motivo: erro?.message || e.message };
    }
}

// Varredor: decide se está na hora de renovar. Roda de 12 em 12h.
//
// Na PRIMEIRA execução não há registro de renovação, então renova de cara. Isso
// tem dois efeitos bons: valida que a semente do .env funciona, e estabelece um
// marco conhecido de 60 dias (a idade do token do .env é desconhecida — pode já
// estar com 50 dias). Se a semente tiver menos de 24h, a Meta recusa; a próxima
// varredura, meio dia depois, resolve sozinha.
async function varrerRenovacao() {
    if (!IG_TOKEN && !cache) return;                 // canal desligado
    let registro = cache;
    if (!registro) {
        try { registro = await store.getConfig(CHAVE_TOKEN); } catch (_) { registro = null; }
    }
    const idadeDias = registro && registro.renovadoEm
        ? (Date.now() - registro.renovadoEm) / DIA_MS
        : Infinity;                                   // sem registro → renova agora

    if (idadeDias < RENOVAR_DIAS) return;
    console.log(`🔑 Token do Instagram com ~${idadeDias === Infinity ? '?' : Math.round(idadeDias)} dias — renovando (limite: ${RENOVAR_DIAS}).`);
    await renovarToken();
}

// Chamado uma vez na subida do servidor.
function iniciarRenovacaoAutomatica() {
    if (!IG_TOKEN) return;
    if (!store.isRedis()) {
        console.warn('⚠️ Instagram: sem REDIS_URL, o token renovado NÃO sobrevive ao restart. ' +
                     'Passados 60 dias sem renovação persistida, o canal para de funcionar.');
    }
    varrerRenovacao();                                 // confere já na subida
    setInterval(varrerRenovacao, VARRER_MS).unref?.();
}

// Estado para o /diag (sem expor o token).
async function statusToken() {
    let registro = cache;
    if (!registro) {
        try { registro = await store.getConfig(CHAVE_TOKEN); } catch (_) { registro = null; }
    }
    if (!registro || !registro.renovadoEm) {
        return { renovadoEm: null, idadeDias: null, renovaAosDias: RENOVAR_DIAS, origem: IG_TOKEN ? '.env (ainda não renovado)' : 'não configurado' };
    }
    return {
        renovadoEm: new Date(registro.renovadoEm).toISOString(),
        idadeDias: Math.round((Date.now() - registro.renovadoEm) / DIA_MS),
        renovaAosDias: RENOVAR_DIAS,
        origem: 'store (renovado automaticamente)'
    };
}

module.exports = {
    PREFIXO, configurado, ehInstagram, paraChatId, igsid,
    verificacao, assinaturaValida, parsePayload, enviar,
    renovarToken, varrerRenovacao, iniciarRenovacaoAutomatica, statusToken, tokenVigente
};
