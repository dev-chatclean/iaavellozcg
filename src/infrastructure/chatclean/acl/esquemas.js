// =============================================================
//  ESQUEMAS DO PAYLOAD DO CHATCLEAN (SPEC 0003)
//
//  Contrato DOCUMENTADO dos três formatos que chegam no webhook. O objetivo
//  aqui não é barrar: é registrar o que conhecemos e permitir medir quando
//  aparece algo diferente.
//
//  Por que tolerante e não estrito: o formato é do ChatClean, não nosso, e
//  varia por canal. Um esquema rígido que rejeitasse um formato novo deixaria
//  leads sem atendimento — exatamente o risco que um Anti-Corruption Layer
//  existe para evitar. Todos os campos são opcionais e objetos desconhecidos
//  passam adiante; o esquema serve para CLASSIFICAR e para dar nome ao que
//  divergir.
// =============================================================

const { z } = require('zod');

const solto = () => z.unknown().optional();

// Formato A/B — ChatClean aninhado (WhatsApp Web/whatsmeow e WABA).
// O telefone real pode estar em contact.number, contact.phone,
// message.raw.Info.SenderAlt (whatsmeow) ou message.raw.from (WABA).
const contato = z
    .object({
        id: solto(),
        name: z.string().optional(),
        number: z.union([z.string(), z.number()]).optional(),
        phone: z.union([z.string(), z.number()]).optional(),
        remoteJid: z.string().optional(),
        jid: z.string().optional()
    })
    .passthrough();

const ticket = z
    .object({
        id: solto(),
        status: z.string().optional(),
        userId: solto(),
        contactId: solto(),
        isGroup: z.boolean().optional()
    })
    .passthrough();

const mensagem = z
    .object({
        id: z.union([z.string(), z.number()]).optional(),
        messageId: z.union([z.string(), z.number()]).optional(),
        contactId: solto(),
        body: z.string().optional(),
        text: z.string().optional(),
        type: z.string().optional(),
        mediaType: z.string().optional(),
        fromMe: z.boolean().optional(),
        isGroup: z.boolean().optional(),
        number: z.union([z.string(), z.number()]).optional(),
        mediaUrl: z.string().optional().nullable(),
        mediaBase64: z.string().optional().nullable(),
        base64: z.string().optional().nullable(),
        mimetype: z.string().optional().nullable(),
        quotedMsg: z.object({ body: z.string().optional(), text: z.string().optional() }).passthrough().optional(),
        chatId: z.string().optional(),
        from: z.string().optional(),
        remoteJid: z.string().optional(),
        ticket: ticket.optional(),
        raw: z
            .object({
                from: z.string().optional(),
                Info: z
                    .object({
                        SenderAlt: z.string().optional(),
                        PushName: z.string().optional(),
                        IsGroup: z.boolean().optional(),
                        Chat: z.string().optional(),
                        ChatJID: z.string().optional(),
                        chat: z.string().optional()
                    })
                    .passthrough()
                    .optional(),
                Message: z.unknown().optional()
            })
            .passthrough()
            .optional()
    })
    .passthrough();

const aninhado = z
    .object({
        contact: contato.optional(),
        ticket: ticket.optional(),
        message: mensagem.optional(),
        number: z.union([z.string(), z.number()]).optional(),
        contactId: solto(),
        contactName: z.string().optional(),
        isGroup: z.boolean().optional(),
        chatId: z.string().optional(),
        from: z.string().optional(),
        remoteJid: z.string().optional(),
        remotejid: z.string().optional()
    })
    .passthrough();

// Formato C — plano (n8n / webhook simples).
const plano = z
    .object({
        number: z.union([z.string(), z.number()]),
        body: z.string().optional(),
        type: z.string().optional(),
        id: z.union([z.string(), z.number()]).optional(),
        contactId: solto(),
        contact: z.object({ id: solto() }).passthrough().optional(),
        contactName: z.string().optional(),
        name: z.string().optional(),
        fromMe: z.boolean().optional(),
        isGroup: z.boolean().optional(),
        mediaUrl: z.string().optional().nullable(),
        mediaBase64: z.string().optional().nullable(),
        base64: z.string().optional().nullable(),
        mimetype: z.string().optional().nullable(),
        quotedText: z.string().optional().nullable(),
        remoteJid: z.string().optional()
    })
    .passthrough();

// Formato D — disparo duplicado do ChatBot, ignorado de propósito.
const duplicado = z
    .object({
        numero_cliente: z.union([z.string(), z.number()]),
        mensagem_cliente: z.unknown()
    })
    .passthrough();

const FORMATOS = Object.freeze({ ANINHADO: 'aninhado', PLANO: 'plano', DUPLICADO: 'duplicado', DESCONHECIDO: 'desconhecido' });

/**
 * Classifica o corpo recebido. A ordem replica a do legado: aninhado primeiro
 * (é o formato do ChatClean), depois plano, depois o disparo duplicado.
 * @returns {{ formato: string, valido: boolean, divergencias: string[] }}
 */
function classificar(corpo) {
    if (!corpo || typeof corpo !== 'object') {
        return { formato: FORMATOS.DESCONHECIDO, valido: false, divergencias: ['corpo ausente ou não é objeto'] };
    }

    // Mesma condição do legado: presença de `contact`, ou de `message` que não
    // seja o campo `message.add` de outro tipo de evento.
    const pareceAninhado = !!corpo.contact || (corpo.message && typeof corpo.message === 'object' && !corpo.message.add);
    if (pareceAninhado) return conferir(aninhado, corpo, FORMATOS.ANINHADO);

    if (corpo.number !== undefined && (corpo.body !== undefined || corpo.type !== undefined)) {
        return conferir(plano, corpo, FORMATOS.PLANO);
    }

    if (corpo.numero_cliente !== undefined && corpo.mensagem_cliente !== undefined) {
        return conferir(duplicado, corpo, FORMATOS.DUPLICADO);
    }

    return { formato: FORMATOS.DESCONHECIDO, valido: false, divergencias: ['não casa com nenhum formato conhecido'] };
}

function conferir(esquema, corpo, formato) {
    const r = esquema.safeParse(corpo);
    if (r.success) return { formato, valido: true, divergencias: [] };
    return {
        formato,
        valido: false,
        divergencias: r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    };
}

module.exports = { classificar, FORMATOS, esquemas: { aninhado, plano, duplicado } };
