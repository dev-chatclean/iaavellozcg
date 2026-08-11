import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parsePayload, ehGrupo, deveResponderTicket, ticketStatus } = require('../../index');

// =============================================================
//  SPEC 0001 — T21/T22/T23 · TESTE DE CARACTERIZACAO
//
//  Congela o comportamento ATUAL do parsePayload, inclusive o que for
//  discutivel. Este arquivo e o contrato de "nao quebrou" da Fase 1, quando
//  o parse vira o Anti-Corruption Layer (spec 0003): a suite deve continuar
//  verde SEM alteracao.
//
//  Cobre CA-002, CA-003, CA-004 e RN-050, RN-051, RN-052.
// =============================================================

// ---------- Construtores de payload ----------

const aninhado = (over = {}) => ({
    contact: { id: 501, name: 'Joao', ...(over.contact || {}) },
    ticket: { status: 'pending', userId: null, ...(over.ticket || {}) },
    message: {
        id: 'MSG-1',
        body: 'quanto custa a AZ1?',
        type: 'chat',
        fromMe: false,
        ...(over.message || {})
    }
});

const plano = (over = {}) => ({
    number: '5583966665555',
    body: 'tenho interesse',
    type: 'text',
    contactName: 'Ana',
    id: 'MSG-B1',
    ...over
});

describe('parsePayload: formato aninhado do ChatClean', () => {
    it('CA-002: extrai o telefone de raw.Info.SenderAlt descartando o id de dispositivo', () => {
        const r = parsePayload(
            aninhado({
                message: { raw: { Info: { SenderAlt: '558491756446:24@s.whatsapp.net', PushName: 'Joao' } } }
            })
        );
        expect(r.chatId).toBe('558491756446');
    });

    it('prefere contact.number a SenderAlt quando ambos existem', () => {
        const r = parsePayload(
            aninhado({
                contact: { number: '5583988887777' },
                message: { raw: { Info: { SenderAlt: '558491756446@s.whatsapp.net' } } }
            })
        );
        expect(r.chatId).toBe('5583988887777');
    });

    it('aceita contact.phone como alternativa a contact.number', () => {
        const r = parsePayload(aninhado({ contact: { phone: '5583911112222' } }));
        expect(r.chatId).toBe('5583911112222');
    });

    it('WABA: usa message.raw.from quando nao ha SenderAlt', () => {
        const r = parsePayload(aninhado({ message: { raw: { from: '5583977776666' } } }));
        expect(r.chatId).toBe('5583977776666');
    });

    it('devolve os campos esperados do turno', () => {
        const r = parsePayload(
            aninhado({
                contact: { id: 77, name: 'Maria', number: '5583988887777' },
                message: {
                    id: 'MSG-9',
                    body: '  oi  ',
                    type: 'chat',
                    quotedMsg: { body: 'mensagem citada' }
                }
            })
        );
        expect(r).toMatchObject({
            chatId: '5583988887777',
            contactId: 77,
            msgId: 'MSG-9',
            texto: 'oi',
            tipo: 'text',
            quotedText: 'mensagem citada',
            nomeContato: 'Maria'
        });
    });

    it('usa raw.Info.PushName quando o contato nao tem nome', () => {
        const r = parsePayload(
            aninhado({
                contact: { name: undefined, number: '5583988887777' },
                message: { raw: { Info: { PushName: 'Pedro do Zap' } } }
            })
        );
        expect(r.nomeContato).toBe('Pedro do Zap');
    });

    it('precedencia do contactId: message.contactId vence contact.id', () => {
        const r = parsePayload(
            aninhado({ contact: { id: 501, number: '5583988887777' }, message: { contactId: 999 } })
        );
        expect(r.contactId).toBe(999);
    });

    it('cai para ticket.contactId quando nao ha os anteriores', () => {
        const r = parsePayload({
            contact: { number: '5583988887777' },
            ticket: { status: 'pending', contactId: 424 },
            message: { id: 'M', body: 'oi', type: 'chat', fromMe: false }
        });
        expect(r.contactId).toBe(424);
    });

    it('aceita messageId quando nao ha id', () => {
        const r = parsePayload(
            aninhado({ contact: { number: '5583988887777' }, message: { id: undefined, messageId: 'ALT-1' } })
        );
        expect(r.msgId).toBe('ALT-1');
    });

    it('descarta quando nao ha telefone identificavel', () => {
        expect(parsePayload(aninhado({ contact: { id: 1 } }))).toBeNull();
    });
});

describe('parsePayload: normalizacao do tipo', () => {
    it.each([
        ['chat', 'text'],
        ['', 'text'],
        [undefined, 'text'],
        ['text', 'text'],
        ['image', 'image'],
        ['audio', 'audio'],
        ['ptt', 'ptt'],
        ['document', 'document'],
        ['IMAGE', 'image'],
        ['sticker', 'sticker'],
        ['video', 'video'],
        ['location', 'location']
    ])('tipo "%s" vira "%s"', (entrada, esperado) => {
        const r = parsePayload(aninhado({ contact: { number: '5583988887777' }, message: { type: entrada } }));
        expect(r.tipo).toBe(esperado);
    });

    it('usa mediaType quando type esta ausente', () => {
        const r = parsePayload(
            aninhado({ contact: { number: '5583988887777' }, message: { type: undefined, mediaType: 'image' } })
        );
        expect(r.tipo).toBe('image');
    });
});

describe('parsePayload: midia', () => {
    it('captura mediaUrl, base64 e mimetype', () => {
        const r = parsePayload(
            aninhado({
                contact: { number: '5583988887777' },
                message: {
                    type: 'image',
                    body: '',
                    mediaUrl: 'https://exemplo/foto.jpg',
                    mediaBase64: 'AAAA',
                    mimetype: 'image/jpeg'
                }
            })
        );
        expect(r.mediaUrl).toBe('https://exemplo/foto.jpg');
        expect(r.mediaBase64).toBe('AAAA');
        expect(r.mediaMimetype).toBe('image/jpeg');
    });

    it('cai para o mimetype dentro de raw.Message.imageMessage', () => {
        const r = parsePayload(
            aninhado({
                contact: { number: '5583988887777' },
                message: {
                    type: 'image',
                    raw: { Message: { imageMessage: { mimetype: 'image/webp' } } }
                }
            })
        );
        expect(r.mediaMimetype).toBe('image/webp');
    });
});

describe('parsePayload: formato plano', () => {
    it('extrai os campos do payload plano', () => {
        expect(parsePayload(plano())).toMatchObject({
            chatId: '5583966665555',
            texto: 'tenho interesse',
            tipo: 'text',
            msgId: 'MSG-B1',
            nomeContato: 'Ana'
        });
    });

    it('aceita body.name como nome do contato', () => {
        const r = parsePayload(plano({ contactName: undefined, name: 'Carlos' }));
        expect(r.nomeContato).toBe('Carlos');
    });

    it('aceita contactId direto ou aninhado em contact.id', () => {
        expect(parsePayload(plano({ contactId: 12 })).contactId).toBe(12);
        expect(parsePayload(plano({ contact: { id: 34 } })).contactId).toBe(34);
    });

    it('reconhece o payload plano quando ha number e type, mesmo sem body', () => {
        const r = parsePayload({ number: '5583966665555', type: 'image', id: 'X' });
        expect(r.tipo).toBe('image');
        expect(r.texto).toBe('');
    });

    it('descarta quando o numero nao tem digitos', () => {
        expect(parsePayload(plano({ number: 'abc' }))).toBeNull();
    });
});

describe('parsePayload: descartes (RN-050, RN-051, RN-052)', () => {
    it('RN-051: ignora o eco do proprio bot no formato aninhado', () => {
        expect(parsePayload(aninhado({ contact: { number: '5583988887777' }, message: { fromMe: true } }))).toBeNull();
    });

    it('RN-051: ignora o eco no formato plano', () => {
        expect(parsePayload(plano({ fromMe: true }))).toBeNull();
    });

    it.each([
        ['ticket.isGroup', { ticket: { status: 'pending', isGroup: true } }],
        ['ticket.status = group', { ticket: { status: 'group' } }],
        ['raw.Info.IsGroup', { message: { raw: { Info: { IsGroup: true } } } }],
        ['raw.Info.Chat com @g.us', { message: { raw: { Info: { Chat: '12036@g.us' } } } }],
        ['message.isGroup', { message: { isGroup: true } }]
    ])('CA-003: RN-050 ignora grupo detectado por %s', (_nome, over) => {
        const payload = aninhado({ contact: { number: '5583944443333' }, ...over });
        expect(parsePayload(payload)).toBeNull();
    });

    it('RN-050: ignora grupo no formato plano (isGroup e JID)', () => {
        expect(parsePayload(plano({ isGroup: true }))).toBeNull();
        expect(parsePayload(plano({ remoteJid: '12036@g.us' }))).toBeNull();
    });

    it('CA-004: RN-052 nao responde ticket com userId humano atribuido', () => {
        const payload = aninhado({ contact: { number: '5583922221111' }, ticket: { status: 'open', userId: 77 } });
        expect(parsePayload(payload)).toBeNull();
    });

    it('RN-052: nao responde ticket closed', () => {
        const payload = aninhado({ contact: { number: '5583911110000' }, ticket: { status: 'closed' } });
        expect(parsePayload(payload)).toBeNull();
    });

    it('RN-052: RESPONDE ticket open sem userId', () => {
        const payload = aninhado({ contact: { number: '5583977776666' }, ticket: { status: 'open', userId: null } });
        expect(parsePayload(payload)).not.toBeNull();
    });

    it('RN-052: RESPONDE quando o payload nao traz ticket (compatibilidade)', () => {
        const r = parsePayload({
            contact: { number: '5583977776666' },
            message: { id: 'M', body: 'oi', type: 'chat', fromMe: false }
        });
        expect(r).not.toBeNull();
    });

    it('ignora o disparo duplicado no formato numero_cliente', () => {
        expect(parsePayload({ numero_cliente: '5583900001111', mensagem_cliente: 'oi' })).toBeNull();
    });

    it('devolve null para payload desconhecido, vazio ou invalido', () => {
        expect(parsePayload({ foo: 'bar' })).toBeNull();
        expect(parsePayload({})).toBeNull();
        expect(parsePayload(null)).toBeNull();
        expect(parsePayload(undefined)).toBeNull();
    });

    // CONGELA COMPORTAMENTO — todos os descartes retornam o MESMO valor (null),
    // entao o chamador nao consegue distinguir "grupo" de "payload invalido".
    // A spec 0003 (ACL) troca isso por um motivo de descarte tipado.
    it('CONGELA: todo descarte devolve null, sem motivo distinguivel', () => {
        const descartes = [
            aninhado({ contact: { number: '5583944443333' }, message: { fromMe: true } }),
            aninhado({ contact: { number: '5583944443333' }, ticket: { isGroup: true } }),
            { numero_cliente: '1', mensagem_cliente: 'x' },
            { foo: 'bar' }
        ];
        for (const d of descartes) expect(parsePayload(d)).toBeNull();
    });
});

describe('ehGrupo e deveResponderTicket (auxiliares)', () => {
    it('ehGrupo reconhece o sinal nativo do ChatClean', () => {
        expect(ehGrupo({ ticket: { isGroup: true } }, {})).toBe(true);
        expect(ehGrupo({ ticket: { status: 'group' } }, {})).toBe(true);
        expect(ehGrupo({}, { ticket: { isGroup: true } })).toBe(true);
    });

    it('ehGrupo reconhece JID de grupo em varios campos', () => {
        expect(ehGrupo({}, { chatId: '12036@g.us' })).toBe(true);
        expect(ehGrupo({ remoteJid: '12036@g.us' }, {})).toBe(true);
        expect(ehGrupo({ contact: { jid: '12036@g.us' } }, {})).toBe(true);
    });

    it('ehGrupo e falso para conversa individual', () => {
        expect(ehGrupo({ contact: { number: '5583999998888' } }, { chatId: '5583999998888@s.whatsapp.net' })).toBe(
            false
        );
        expect(ehGrupo({}, {})).toBe(false);
    });

    it('deveResponderTicket segue a regra do bot de fila (RN-052)', () => {
        expect(deveResponderTicket({ ticket: { status: 'pending' } }, {})).toBe(true);
        expect(deveResponderTicket({ ticket: { status: 'open' } }, {})).toBe(true);
        expect(deveResponderTicket({ ticket: { status: 'open', userId: 5 } }, {})).toBe(false);
        expect(deveResponderTicket({ ticket: { status: 'closed' } }, {})).toBe(false);
        expect(deveResponderTicket({}, {})).toBe(true);
    });

    it('ticketStatus le o ticket de body ou de message', () => {
        expect(ticketStatus({ ticket: { status: 'pending' } }, {})).toBe('pending');
        expect(ticketStatus({}, { ticket: { status: 'closed' } })).toBe('closed');
        expect(ticketStatus({}, {})).toBeNull();
    });
});
