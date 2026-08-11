import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const acl = require('../../src/infrastructure/chatclean/acl/tradutor');
const { classificar, FORMATOS } = require('../../src/infrastructure/chatclean/acl/esquemas');
const { MOTIVOS } = require('../../src/domain/mensageria/MotivoDeDescarte');
const MensagemRecebida = require('../../src/domain/mensageria/MensagemRecebida');

// =============================================================
//  SPEC 0003 — o que o ACL trouxe de NOVO.
//
//  O comportamento herdado ja esta congelado em
//  test/caracterizacao/parsePayload.test.js, que passou sem alteracao (CA-001).
//  Aqui testamos o que antes nao existia: motivo de descarte nomeado,
//  classificacao de formato e tolerancia a formato novo.
// =============================================================

const aninhado = (over = {}) => ({
    contact: { id: 1, name: 'Rafael', number: '5583999998888', ...(over.contact || {}) },
    ticket: { status: 'pending', userId: null, ...(over.ticket || {}) },
    message: { id: 'M1', body: 'oi', type: 'chat', fromMe: false, ...(over.message || {}) }
});

describe('tradutor: mensagem aceita', () => {
    it('CA-009: devolve MensagemRecebida congelada com os campos do contrato', () => {
        const r = acl.traduzir(aninhado());
        expect(r.aceita).toBe(true);
        expect(Object.isFrozen(r)).toBe(true);
        expect(Object.keys(r).sort()).toEqual(
            [
                'aceita',
                'chatId',
                'contactId',
                'mediaBase64',
                'mediaMimetype',
                'mediaUrl',
                'msgId',
                'nomeContato',
                'quotedText',
                'texto',
                'tipo'
            ].sort()
        );
    });

    it('nao permite mutacao acidental do resultado', () => {
        const r = acl.traduzir(aninhado());
        expect(() => {
            'use strict';
            r.chatId = 'outro';
        }).toThrow();
    });
});

describe('tradutor: motivos de descarte nomeados', () => {
    it('CA-003: eco do proprio bot', () => {
        const r = acl.traduzir(aninhado({ message: { fromMe: true } }));
        expect(r.aceita).toBe(false);
        expect(r.motivo).toBe(MOTIVOS.ECO);
    });

    it('CA-002: grupo', () => {
        const r = acl.traduzir(aninhado({ ticket: { isGroup: true } }));
        expect(r.motivo).toBe(MOTIVOS.GRUPO);
    });

    it('CA-004: ticket assumido por humano e ticket encerrado sao motivos DIFERENTES', () => {
        const assumido = acl.traduzir(aninhado({ ticket: { status: 'open', userId: 42 } }));
        const encerrado = acl.traduzir(aninhado({ ticket: { status: 'closed' } }));

        expect(assumido.motivo).toBe(MOTIVOS.TICKET_ASSUMIDO);
        expect(encerrado.motivo).toBe(MOTIVOS.TICKET_ENCERRADO);
        expect(assumido.motivo).not.toBe(encerrado.motivo);
    });

    it('o descarte de ticket carrega o status como detalhe', () => {
        const r = acl.traduzir(aninhado({ ticket: { status: 'open', userId: 42 } }));
        expect(r.detalhe).toBe('open');
    });

    it('CA-005: payload sem telefone identificavel', () => {
        const r = acl.traduzir({ contact: { id: 1 }, message: { body: 'oi', type: 'chat' } });
        expect(r.motivo).toBe(MOTIVOS.SEM_TELEFONE);
    });

    it('CA-006: formato duplicado do ChatBot', () => {
        const r = acl.traduzir({ numero_cliente: '5583999998888', mensagem_cliente: 'oi' });
        expect(r.motivo).toBe(MOTIVOS.FORMATO_DUPLICADO);
    });

    it('CA-007: formato desconhecido', () => {
        expect(acl.traduzir({ foo: 'bar' }).motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
        expect(acl.traduzir({}).motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
    });

    it('CA-008: corpo undefined ou null nao lanca (corrige D-29)', () => {
        for (const corpo of [undefined, null, 'texto solto', 42, []]) {
            const r = acl.traduzir(corpo);
            expect(r.aceita).toBe(false);
            expect(r.motivo).toBe(MOTIVOS.FORMATO_DESCONHECIDO);
        }
    });

    it('todo descarte traz motivo, descricao e a marca aceita=false', () => {
        const descartes = [
            acl.traduzir(aninhado({ message: { fromMe: true } })),
            acl.traduzir(aninhado({ ticket: { isGroup: true } })),
            acl.traduzir({ numero_cliente: '1', mensagem_cliente: 'x' }),
            acl.traduzir({ foo: 'bar' })
        ];
        for (const d of descartes) {
            expect(d.aceita).toBe(false);
            expect(typeof d.motivo).toBe('string');
            expect(d.descricao).toBeTruthy();
        }
        // E sao DISTINGUIVEIS entre si — o ponto da spec.
        expect(new Set(descartes.map((d) => d.motivo)).size).toBe(4);
    });
});

describe('tradutor: politicas vindas da configuracao', () => {
    it('com ignorarGrupos=false, mensagem de grupo e ACEITA', () => {
        const r = acl.traduzir(aninhado({ ticket: { isGroup: true } }), { ignorarGrupos: false });
        expect(r.aceita).toBe(true);
    });

    it('com apenasPendentes=false, ticket assumido e ACEITO', () => {
        const r = acl.traduzir(aninhado({ ticket: { status: 'open', userId: 42 } }), { apenasPendentes: false });
        expect(r.aceita).toBe(true);
    });

    it('as politicas sao ligadas por padrao', () => {
        expect(acl.traduzir(aninhado({ ticket: { isGroup: true } })).aceita).toBe(false);
        expect(acl.traduzir(aninhado({ ticket: { status: 'open', userId: 1 } })).aceita).toBe(false);
    });

    it('nao le process.env: a mesma entrada com politicas diferentes muda o resultado', () => {
        const payload = aninhado({ ticket: { isGroup: true } });
        expect(acl.traduzir(payload, { ignorarGrupos: true }).aceita).toBe(false);
        expect(acl.traduzir(payload, { ignorarGrupos: false }).aceita).toBe(true);
    });
});

describe('esquemas: classificacao de formato', () => {
    it('reconhece o formato aninhado do ChatClean', () => {
        expect(classificar(aninhado()).formato).toBe(FORMATOS.ANINHADO);
    });

    it('reconhece o formato plano', () => {
        expect(classificar({ number: '5583999998888', body: 'oi', type: 'text' }).formato).toBe(FORMATOS.PLANO);
    });

    it('reconhece o disparo duplicado', () => {
        expect(classificar({ numero_cliente: '1', mensagem_cliente: 'x' }).formato).toBe(FORMATOS.DUPLICADO);
    });

    it('marca como desconhecido o que nao casa com nada', () => {
        expect(classificar({ foo: 'bar' }).formato).toBe(FORMATOS.DESCONHECIDO);
        expect(classificar(undefined).formato).toBe(FORMATOS.DESCONHECIDO);
    });

    it('ignora message.add (evento de outro tipo, nao mensagem)', () => {
        expect(classificar({ message: { add: true } }).formato).toBe(FORMATOS.DESCONHECIDO);
    });

    it('payload conhecido e completo e valido', () => {
        const c = classificar(aninhado());
        expect(c.valido).toBe(true);
        expect(c.divergencias).toEqual([]);
    });
});

describe('tradutor: tolerancia a formato novo (CA-010)', () => {
    it('campo com tipo inesperado NAO barra a mensagem: processa e registra a divergencia', () => {
        // `name` deveria ser string; chega como numero. Um esquema rigido
        // rejeitaria e o lead ficaria sem atendimento.
        const payload = aninhado({ contact: { name: 12345 } });

        const classificacao = classificar(payload);
        expect(classificacao.valido).toBe(false);
        expect(classificacao.divergencias.length).toBeGreaterThan(0);

        const r = acl.traduzir(payload);
        expect(r.aceita).toBe(true);
        expect(r.chatId).toBe('5583999998888');
        expect(r.divergenciasDeEsquema).toBeDefined();
    });

    it('campos desconhecidos passam adiante sem atrapalhar', () => {
        const r = acl.traduzir(aninhado({ message: { campoNovoDoChatClean: 'qualquer coisa' } }));
        expect(r.aceita).toBe(true);
        expect(r.divergenciasDeEsquema).toBeUndefined();
    });
});

describe('MensagemRecebida', () => {
    it('exige chatId', () => {
        expect(() => MensagemRecebida.criar({})).toThrow(/chatId/);
        expect(() => MensagemRecebida.criar(null)).toThrow(/chatId/);
    });

    it('aplica os padroes dos campos ausentes', () => {
        const m = MensagemRecebida.criar({ chatId: '5583999998888' });
        expect(m).toMatchObject({
            contactId: null,
            msgId: null,
            texto: '',
            tipo: 'text',
            mediaBase64: null,
            mediaUrl: null,
            mediaMimetype: null,
            quotedText: null,
            nomeContato: ''
        });
    });

    it('conhece os tipos suportados pelo atendimento', () => {
        expect(MensagemRecebida.ehTipoConhecido('text')).toBe(true);
        expect(MensagemRecebida.ehTipoConhecido('ptt')).toBe(true);
        expect(MensagemRecebida.ehTipoConhecido('sticker')).toBe(false);
    });
});
