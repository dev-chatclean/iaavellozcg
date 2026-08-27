// =============================================================
//  ANTI-CORRUPTION LAYER — payload do ChatClean
//
//  O ChatClean entrega a MESMA mensagem em tres formatos diferentes, e o
//  telefone real muda de lugar em cada um. Esta camada e a unica que conhece
//  esses formatos: para fora, sai sempre a mesma mensagem.
//
//  Nao decide o que fazer com o descarte, nao loga, nao le ambiente. Devolve
//  ou a mensagem traduzida, ou o MOTIVO nomeado do descarte — quem loga e
//  quem chama.
// =============================================================

const MotivoDeDescarte = require('../../../domain/mensageria/MotivoDeDescarte');
const { normalizarPhone } = require('../../../shared/telefone');

const TIPOS_CONHECIDOS = ['image', 'audio', 'ptt', 'document', 'text'];

/**
 * Normaliza o tipo da mensagem. "chat" e vazio viram "text"; tipos nao
 * suportados (sticker, video, location) passam adiante como vieram, para o
 * chamador tratar.
 */
function normalizarTipo(t) {
    const v = String(t || 'text').toLowerCase();
    if (TIPOS_CONHECIDOS.includes(v)) return v;
    if (v === 'chat' || v === '') return 'text';
    return v;
}

/** Ticket do payload — pode vir em body.ticket ou message.ticket. */
function getTicket(body = {}, msg = {}) {
    return body.ticket || msg.ticket || {};
}

function ticketStatus(body = {}, msg = {}) {
    return getTicket(body, msg).status || null;
}

/**
 * Detecta se a mensagem veio de um GRUPO. O whatsmeow expoe Info.IsGroup e
 * Info.Chat (JID do chat); grupo = JID termina em "@g.us". Cobrimos tambem
 * variantes de payload plano (from/remoteJid/chatId/isGroup).
 */
function ehGrupo(body = {}, msg = {}) {
    const info = msg.raw?.Info || {};
    // Sinal nativo do ChatClean (o mais confiavel): o ticket marca grupo.
    if (body.ticket?.isGroup === true || body.ticket?.status === 'group') return true;
    if (msg.ticket?.isGroup === true || msg.ticket?.status === 'group') return true;
    // Sinais do whatsmeow / formato plano.
    if (info.IsGroup === true || body.isGroup === true || msg.isGroup === true) return true;
    const candidatos = [
        info.Chat,
        info.ChatJID,
        info.chat,
        msg.chatId,
        msg.from,
        msg.remoteJid,
        body.chatId,
        body.from,
        body.remoteJid,
        body.remotejid,
        body.contact?.remoteJid,
        body.contact?.jid
    ];
    return candidatos.some((j) => typeof j === 'string' && j.includes('@g.us'));
}

/**
 * A IA atua como bot de fila: responde enquanto NINGUEM humano assumiu.
 *   - status "pending" (na fila)                  -> responde
 *   - status "closed"                             -> nao responde
 *   - ticket com userId humano (a pessoa ACEITOU) -> nao responde
 *   - sem status no payload                       -> responde (compat)
 *
 * Assim, no instante em que o atendente aceita, a IA para — sem o risco de
 * silenciar leads novos que cheguem como "open".
 */
function deveResponderTicket(body = {}, msg = {}, soPendentes = true) {
    if (!soPendentes) return true;
    const t = getTicket(body, msg);
    if (t.userId) return false;
    const st = t.status || null;
    if (!st) return true;
    if (st === 'closed') return false;
    return true;
}

const descarte = (motivo, detalhe = null) => ({ descarte: { motivo, detalhe } });

/**
 * @param {{ignorarGrupos?: boolean, soPendentes?: boolean}} opcoes
 */
function criar({ ignorarGrupos = true, soPendentes = true } = {}) {
    /**
     * @returns {{mensagem: object} | {descarte: {motivo: string, detalhe: any}}}
     */
    function traduzir(body) {
        try {
            // ---- Formato ChatClean: contact + message aninhados ----
            if (body?.contact || (body?.message && typeof body.message === 'object' && !body.message.add)) {
                const contato = body.contact || {};
                const msg = body.message || {};

                if (msg.fromMe) return descarte(MotivoDeDescarte.ECO_DO_BOT);
                if (ignorarGrupos && ehGrupo(body, msg)) return descarte(MotivoDeDescarte.GRUPO);
                if (!deveResponderTicket(body, msg, soPendentes)) {
                    return descarte(MotivoDeDescarte.TICKET_ASSUMIDO, ticketStatus(body, msg));
                }

                const senderAlt = msg.raw?.Info?.SenderAlt ? String(msg.raw.Info.SenderAlt).split('@')[0] : null;
                // WABA (WhatsApp Oficial): o numero do remetente vem em
                // message.raw.from — nao existe raw.Info.SenderAlt.
                const wabaFrom = msg.raw?.from || null;
                // O SenderAlt tem PRIORIDADE: vem como JID completo
                // ("558494610845:59@s.whatsapp.net"), entao o ID do dispositivo
                // (:59) e cortado corretamente. O contact.number do CRM as vezes
                // chega com esse sufixo grudado ("55849461084559"), sem os
                // dois-pontos — e ai nao ha como separar telefone de dispositivo.
                // Em contas com LID, o SenderAlt tambem e quem carrega o telefone
                // real (Chat/Sender vem como "14079406125304@lid").
                const numero = senderAlt || contato.number || contato.phone || body.number || wabaFrom || msg.number;
                const phone = normalizarPhone(numero);
                if (!phone) return descarte(MotivoDeDescarte.SEM_TELEFONE);

                const tk = getTicket(body, msg);
                const contactId = msg.contactId || contato.id || tk.contactId || body.contactId || null;

                return {
                    mensagem: {
                        chatId: phone,
                        contactId: contactId ? Number(contactId) : null,
                        msgId: msg.id ? String(msg.id) : msg.messageId ? String(msg.messageId) : null,
                        texto: String(msg.body || msg.text || '').trim(),
                        tipo: normalizarTipo(msg.type || msg.mediaType),
                        mediaBase64: msg.mediaBase64 || msg.base64 || null,
                        mediaUrl: msg.mediaUrl || null,
                        mediaMimetype: msg.mimetype || msg.raw?.Message?.imageMessage?.mimetype || null,
                        quotedText: msg.quotedMsg?.body || msg.quotedMsg?.text || null,
                        nomeContato: contato.name || msg.raw?.Info?.PushName || body.contactName || ''
                    }
                };
            }

            // ---- Formato plano (webhook/n8n simples) ----
            if (body?.number && (body?.body !== undefined || body?.type)) {
                if (body.fromMe) return descarte(MotivoDeDescarte.ECO_DO_BOT);
                if (ignorarGrupos && ehGrupo(body)) return descarte(MotivoDeDescarte.GRUPO);
                if (!deveResponderTicket(body, {}, soPendentes)) {
                    return descarte(MotivoDeDescarte.TICKET_ASSUMIDO, ticketStatus(body));
                }

                const phone = normalizarPhone(body.number);
                if (!phone) return descarte(MotivoDeDescarte.SEM_TELEFONE);

                return {
                    mensagem: {
                        chatId: phone,
                        contactId: body.contactId
                            ? Number(body.contactId)
                            : body.contact?.id
                              ? Number(body.contact.id)
                              : null,
                        msgId: body.id ? String(body.id) : null,
                        texto: String(body.body || '').trim(),
                        tipo: normalizarTipo(body.type),
                        mediaBase64: body.mediaBase64 || body.base64 || null,
                        mediaUrl: body.mediaUrl || null,
                        mediaMimetype: body.mimetype || null,
                        quotedText: body.quotedText || null,
                        nomeContato: body.contactName || body.name || ''
                    }
                };
            }

            // ---- Disparo duplicado do ChatBot ----
            if (body?.numero_cliente && body?.mensagem_cliente !== undefined) {
                return descarte(MotivoDeDescarte.DISPARO_DUPLICADO);
            }

            return descarte(MotivoDeDescarte.FORMATO_DESCONHECIDO, body);
        } catch (e) {
            return descarte(MotivoDeDescarte.ERRO_DE_PARSE, e);
        }
    }

    return { traduzir };
}

module.exports = { criar, ehGrupo, ticketStatus, deveResponderTicket, normalizarTipo, getTicket };
