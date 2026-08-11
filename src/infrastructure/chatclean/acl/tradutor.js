// =============================================================
//  TRADUTOR DE PAYLOAD — Anti-Corruption Layer do ChatClean (SPEC 0003)
//
//  Único lugar do sistema que sabe como o ChatClean fala. Recebe o corpo cru do
//  webhook e devolve:
//    - uma MensagemRecebida (nosso formato), ou
//    - um MotivoDeDescarte nomeado.
//
//  Antes disso, `parsePayload` misturava reconhecimento de três formatos,
//  quatro filtros de negócio, dez cadeias de fallback e log — e todo descarte
//  colapsava num único `null`, indistinguível.
//
//  Sem I/O e sem process.env: as políticas (ignorar grupos, só tickets
//  pendentes) chegam por parâmetro, vindas da configuração.
// =============================================================

const { classificar, FORMATOS } = require('./esquemas');
const { criar } = require('../../../domain/mensageria/MensagemRecebida');
const { MOTIVOS, descartar } = require('../../../domain/mensageria/MotivoDeDescarte');
const { normalizarPhone } = require('../../../shared/telefone');

// Tipos que o legado normaliza; o resto passa como veio (sticker, location...)
// e é tratado mais adiante como não suportado.
const TIPOS_NORMALIZADOS = ['image', 'audio', 'ptt', 'document', 'text'];

function normalizarTipo(valor) {
    const v = String(valor || 'text').toLowerCase();
    if (TIPOS_NORMALIZADOS.includes(v)) return v;
    if (v === 'chat' || v === '') return 'text';
    return v;
}

// Detecta conversa em grupo. O whatsmeow expõe Info.IsGroup e Info.Chat (JID
// terminando em "@g.us"); o ChatClean marca no ticket. Cobrimos também as
// variantes de payload plano.
function ehGrupo(corpo = {}, msg = {}) {
    const info = msg.raw?.Info || {};
    if (corpo.ticket?.isGroup === true || corpo.ticket?.status === 'group') return true;
    if (msg.ticket?.isGroup === true || msg.ticket?.status === 'group') return true;
    if (info.IsGroup === true || corpo.isGroup === true || msg.isGroup === true) return true;
    const candidatos = [
        info.Chat,
        info.ChatJID,
        info.chat,
        msg.chatId,
        msg.from,
        msg.remoteJid,
        corpo.chatId,
        corpo.from,
        corpo.remoteJid,
        corpo.remotejid,
        corpo.contact?.remoteJid,
        corpo.contact?.jid
    ];
    return candidatos.some((j) => typeof j === 'string' && j.includes('@g.us'));
}

function obterTicket(corpo = {}, msg = {}) {
    return corpo.ticket || msg.ticket || {};
}

function statusDoTicket(corpo = {}, msg = {}) {
    return obterTicket(corpo, msg).status || null;
}

// A IA atua como bot de fila: responde enquanto NINGUÉM humano assumiu (RN-052).
// Devolve o motivo do silêncio, ou null quando deve responder — assim o chamador
// distingue "vendedor aceitou" de "ticket encerrado".
function motivoDeSilencioDoTicket(corpo = {}, msg = {}, { apenasPendentes = true } = {}) {
    if (!apenasPendentes) return null;
    const t = obterTicket(corpo, msg);
    if (t.userId) return MOTIVOS.TICKET_ASSUMIDO; // humano aceitou a conversa
    const st = t.status || null;
    if (!st) return null; // sem status: compatibilidade, responde
    if (st === 'closed') return MOTIVOS.TICKET_ENCERRADO;
    return null; // pending / open sem humano
}

// Primeiro valor não vazio de uma lista de candidatos.
function primeiro(...valores) {
    for (const v of valores) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
}

function traduzirAninhado(corpo, opcoes) {
    const contato = corpo.contact || {};
    const msg = corpo.message || {};

    if (msg.fromMe) return descartar(MOTIVOS.ECO);
    if (opcoes.ignorarGrupos && ehGrupo(corpo, msg)) return descartar(MOTIVOS.GRUPO);

    const silencio = motivoDeSilencioDoTicket(corpo, msg, opcoes);
    if (silencio) return descartar(silencio, statusDoTicket(corpo, msg));

    // O telefone real nem sempre está em contact.number: no whatsmeow vem em
    // raw.Info.SenderAlt e no WABA em raw.from.
    const senderAlt = msg.raw?.Info?.SenderAlt ? String(msg.raw.Info.SenderAlt).split('@')[0] : null;
    const numero = primeiro(contato.number, contato.phone, corpo.number, senderAlt, msg.raw?.from, msg.number);
    const chatId = normalizarPhone(numero);
    if (!chatId) return descartar(MOTIVOS.SEM_TELEFONE);

    const tk = obterTicket(corpo, msg);
    const contactId = primeiro(msg.contactId, contato.id, tk.contactId, corpo.contactId);

    return criar({
        chatId,
        contactId: contactId !== null ? Number(contactId) : null,
        msgId: primeiro(msg.id, msg.messageId) !== null ? String(primeiro(msg.id, msg.messageId)) : null,
        texto: String(msg.body || msg.text || '').trim(),
        tipo: normalizarTipo(msg.type || msg.mediaType),
        mediaBase64: msg.mediaBase64 || msg.base64 || null,
        mediaUrl: msg.mediaUrl || null,
        mediaMimetype: msg.mimetype || msg.raw?.Message?.imageMessage?.mimetype || null,
        quotedText: msg.quotedMsg?.body || msg.quotedMsg?.text || null,
        nomeContato: contato.name || msg.raw?.Info?.PushName || corpo.contactName || ''
    });
}

function traduzirPlano(corpo, opcoes) {
    if (corpo.fromMe) return descartar(MOTIVOS.ECO);
    if (opcoes.ignorarGrupos && ehGrupo(corpo)) return descartar(MOTIVOS.GRUPO);

    const silencio = motivoDeSilencioDoTicket(corpo, {}, opcoes);
    if (silencio) return descartar(silencio, statusDoTicket(corpo, {}));

    const chatId = normalizarPhone(corpo.number);
    if (!chatId) return descartar(MOTIVOS.SEM_TELEFONE);

    const contactId = primeiro(corpo.contactId, corpo.contact?.id);

    return criar({
        chatId,
        contactId: contactId !== null ? Number(contactId) : null,
        msgId: corpo.id !== undefined && corpo.id !== null ? String(corpo.id) : null,
        texto: String(corpo.body || '').trim(),
        tipo: normalizarTipo(corpo.type),
        mediaBase64: corpo.mediaBase64 || corpo.base64 || null,
        mediaUrl: corpo.mediaUrl || null,
        mediaMimetype: corpo.mimetype || null,
        quotedText: corpo.quotedText || null,
        nomeContato: corpo.contactName || corpo.name || ''
    });
}

/**
 * Traduz o corpo do webhook.
 * @param {unknown} corpo
 * @param {{ ignorarGrupos?: boolean, apenasPendentes?: boolean }} opcoes
 * @returns {object} MensagemRecebida (aceita: true) ou MotivoDeDescarte (aceita: false)
 */
function traduzir(corpo, opcoes = {}) {
    const politicas = {
        ignorarGrupos: opcoes.ignorarGrupos !== false,
        apenasPendentes: opcoes.apenasPendentes !== false
    };

    try {
        const { formato, valido, divergencias } = classificar(corpo);

        if (formato === FORMATOS.DESCONHECIDO) {
            return descartar(MOTIVOS.FORMATO_DESCONHECIDO, divergencias.join('; '));
        }
        if (formato === FORMATOS.DUPLICADO) {
            return descartar(MOTIVOS.FORMATO_DUPLICADO);
        }

        // Divergência de esquema NÃO barra: o formato é do ChatClean e pode
        // mudar. Registramos para medir e seguimos traduzindo (CA-010).
        const resultado =
            formato === FORMATOS.ANINHADO ? traduzirAninhado(corpo, politicas) : traduzirPlano(corpo, politicas);

        if (!valido && resultado.aceita) {
            return Object.freeze({ ...resultado, divergenciasDeEsquema: divergencias });
        }
        return resultado;
    } catch (e) {
        // Nada aqui deveria lançar; se lançar, é defeito nosso e não pode
        // derrubar o webhook.
        return descartar(MOTIVOS.FORMATO_DESCONHECIDO, `erro ao traduzir: ${e.message}`);
    }
}

module.exports = {
    traduzir,
    ehGrupo,
    obterTicket,
    statusDoTicket,
    motivoDeSilencioDoTicket,
    normalizarTipo
};
