import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const acl = require('../../src/infrastructure/chatclean/acl/tradutor');
const MotivoDeDescarte = require('../../src/domain/mensageria/MotivoDeDescarte');

// =============================================================
//  ACL do payload do ChatClean.
//
//  parsePayload.test.js ja congela a TRADUCAO, vista de fora pelo index.js.
//  Aqui o alvo e outro: o MOTIVO nomeado do descarte. Antes todos eram o mesmo
//  `return null`, e nao dava para distinguir "ignorei de proposito" de
//  "quebrou".
// =============================================================

const tradutor = acl.criar();

const aninhado = (over = {}) => ({
    contact: { id: 1, name: 'Rafael', number: '5583999998888', ...(over.contact || {}) },
    ticket: { status: 'pending', userId: null, ...(over.ticket || {}) },
    message: { id: 'MSG-1', body: 'oi', type: 'chat', fromMe: false, ...(over.message || {}) }
});

const motivoDe = (body, t = tradutor) => t.traduzir(body).descarte?.motivo;

describe('acl: traducao bem-sucedida', () => {
    it('devolve a mensagem sob a chave "mensagem", sem descarte', () => {
        const r = tradutor.traduzir(aninhado());
        expect(r.descarte).toBeUndefined();
        expect(r.mensagem.chatId).toBe('5583999998888');
        expect(r.mensagem.tipo).toBe('text');
    });

    it('os tres formatos desembocam na mesma forma de mensagem', () => {
        const campos = (m) => Object.keys(m).sort();
        const doAninhado = tradutor.traduzir(aninhado()).mensagem;
        const doPlano = tradutor.traduzir({ number: '5583911112222', body: 'oi', type: 'text' }).mensagem;
        expect(campos(doPlano)).toEqual(campos(doAninhado));
    });

    it('o SenderAlt vence o contact.number e perde o id de dispositivo', () => {
        const r = tradutor.traduzir(
            aninhado({
                contact: { number: '5583988887777' },
                message: { raw: { Info: { SenderAlt: '558491756446:24@s.whatsapp.net' } } }
            })
        );
        expect(r.mensagem.chatId).toBe('558491756446');
    });

    it('WABA: o numero vem de raw.from quando nao ha SenderAlt', () => {
        const r = tradutor.traduzir(
            aninhado({ contact: { number: null }, message: { raw: { from: '5583977776666' } } })
        );
        expect(r.mensagem.chatId).toBe('5583977776666');
    });
});

describe('acl: cada descarte tem um motivo nomeado', () => {
    it('eco do proprio bot', () => {
        expect(motivoDe(aninhado({ message: { fromMe: true } }))).toBe(MotivoDeDescarte.ECO_DO_BOT);
    });

    it('grupo por ticket.isGroup', () => {
        expect(motivoDe(aninhado({ ticket: { isGroup: true } }))).toBe(MotivoDeDescarte.GRUPO);
    });

    it('grupo por JID @g.us', () => {
        const body = aninhado({ message: { raw: { Info: { Chat: '1203630000@g.us' } } } });
        expect(motivoDe(body)).toBe(MotivoDeDescarte.GRUPO);
    });

    it('ticket assumido por humano, com o status no detalhe', () => {
        const r = tradutor.traduzir(aninhado({ ticket: { status: 'open', userId: 77 } }));
        expect(r.descarte.motivo).toBe(MotivoDeDescarte.TICKET_ASSUMIDO);
        expect(r.descarte.detalhe).toBe('open');
    });

    it('ticket encerrado', () => {
        const r = tradutor.traduzir(aninhado({ ticket: { status: 'closed' } }));
        expect(r.descarte.motivo).toBe(MotivoDeDescarte.TICKET_ASSUMIDO);
        expect(r.descarte.detalhe).toBe('closed');
    });

    it('sem telefone identificavel', () => {
        const body = aninhado({ contact: { number: null, phone: null, id: 1 } });
        expect(motivoDe(body)).toBe(MotivoDeDescarte.SEM_TELEFONE);
    });

    it('disparo duplicado do ChatBot', () => {
        expect(motivoDe({ numero_cliente: '5583900001111', mensagem_cliente: 'oi' })).toBe(
            MotivoDeDescarte.DISPARO_DUPLICADO
        );
    });

    it('formato desconhecido carrega o body no detalhe, para o log', () => {
        const r = tradutor.traduzir({ foo: 'bar' });
        expect(r.descarte.motivo).toBe(MotivoDeDescarte.FORMATO_DESCONHECIDO);
        expect(r.descarte.detalhe).toEqual({ foo: 'bar' });
    });

    it('payload que faz o parse lancar vira ERRO_DE_PARSE, nao excecao', () => {
        // getter que explode ao ser lido dentro do try.
        const explosivo = {
            get contact() {
                throw new Error('payload malformado');
            }
        };
        const r = tradutor.traduzir(explosivo);
        expect(r.descarte.motivo).toBe(MotivoDeDescarte.ERRO_DE_PARSE);
        expect(r.descarte.detalhe.message).toBe('payload malformado');
    });
});

describe('acl: configuracao entra por parametro, nunca do ambiente', () => {
    it('com ignorarGrupos=false, mensagem de grupo e traduzida normalmente', () => {
        const permissivo = acl.criar({ ignorarGrupos: false });
        const r = permissivo.traduzir(aninhado({ ticket: { isGroup: true } }));
        expect(r.descarte).toBeUndefined();
        expect(r.mensagem.chatId).toBe('5583999998888');
    });

    it('com soPendentes=false, ticket assumido por humano e traduzido', () => {
        const permissivo = acl.criar({ soPendentes: false });
        const r = permissivo.traduzir(aninhado({ ticket: { status: 'open', userId: 77 } }));
        expect(r.descarte).toBeUndefined();
    });

    it('instancias diferentes nao compartilham configuracao', () => {
        const estrito = acl.criar({ ignorarGrupos: true });
        const permissivo = acl.criar({ ignorarGrupos: false });
        const grupo = aninhado({ ticket: { isGroup: true } });
        expect(motivoDe(grupo, estrito)).toBe(MotivoDeDescarte.GRUPO);
        expect(motivoDe(grupo, permissivo)).toBeUndefined();
    });
});

describe('acl: o formato plano passa pelos mesmos descartes', () => {
    const plano = (over = {}) => ({ number: '5583966665555', body: 'oi', type: 'text', ...over });

    it('eco do proprio bot', () => {
        expect(motivoDe(plano({ fromMe: true }))).toBe(MotivoDeDescarte.ECO_DO_BOT);
    });

    it('grupo por JID @g.us no campo from', () => {
        expect(motivoDe(plano({ from: '1203630000@g.us' }))).toBe(MotivoDeDescarte.GRUPO);
    });

    it('ticket assumido por humano', () => {
        const r = tradutor.traduzir(plano({ ticket: { status: 'open', userId: 42 } }));
        expect(r.descarte.motivo).toBe(MotivoDeDescarte.TICKET_ASSUMIDO);
        expect(r.descarte.detalhe).toBe('open');
    });

    it('numero sem digito nenhum', () => {
        expect(motivoDe(plano({ number: 'abc' }))).toBe(MotivoDeDescarte.SEM_TELEFONE);
    });

    it('tipo nao suportado passa adiante como veio, para o chamador tratar', () => {
        expect(tradutor.traduzir(plano({ type: 'sticker' })).mensagem.tipo).toBe('sticker');
    });
});
