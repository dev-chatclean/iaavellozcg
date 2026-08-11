import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validar, avisos } = require('../../src/main/config');

// =============================================================
//  SPEC 0002 — cobre D-23 (configuracao nao validada) e S4.
//  Usamos validar(), que e puro e devolve o erro em vez de derrubar o
//  processo; carregar() apenas embrulha validar() com process.exit.
// =============================================================

const ambienteMinimo = (extra = {}) => ({ OPENAI_API_KEY: 'sk-teste', ...extra });

describe('config: validacao basica', () => {
    it('aceita o minimo necessario e aplica os padroes', () => {
        const r = validar(ambienteMinimo());
        expect(r.ok).toBe(true);
        expect(r.config.PORT).toBe(3000);
        expect(r.config.REDIS_PREFIX).toBe('avellozcg');
        expect(r.config.RATE_LIMIT_MSGS).toBe(20);
        expect(r.config.RATE_LIMIT_JANELA_S).toBe(60);
        expect(r.config.LOOP_MAX_TURNOS).toBe(15);
        expect(r.config.AGRUPAR_MENSAGENS_MS).toBe(2000);
        expect(r.config.RESET_INATIVIDADE_HORAS).toBe(24);
        expect(r.config.IGNORAR_GRUPOS).toBe(true);
        expect(r.config.IA_SO_PENDENTES).toBe(true);
        expect(r.config.LOG_PAYLOAD).toBe(false);
    });

    it('calcula os derivados em milissegundos', () => {
        const r = validar(ambienteMinimo({ RATE_LIMIT_JANELA_S: '30', LOOP_JANELA_MIN: '5', RESET_INATIVIDADE_HORAS: '2' }));
        expect(r.config.RATE_LIMIT_JANELA_MS).toBe(30_000);
        expect(r.config.LOOP_JANELA_MS).toBe(300_000);
        expect(r.config.RESET_INATIVIDADE_MS).toBe(7_200_000);
    });

    it('CA-001: OPENAI_API_KEY ausente invalida a configuracao', () => {
        const r = validar({});
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('OPENAI_API_KEY');
    });

    it('OPENAI_API_KEY em branco tambem e rejeitada', () => {
        expect(validar({ OPENAI_API_KEY: '   ' }).ok).toBe(false);
    });

    it('CA-003: PORT nao numerica falha informando o valor recebido', () => {
        const r = validar(ambienteMinimo({ PORT: 'abc' }));
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('PORT');
        expect(r.mensagem).toContain('número inteiro');
        expect(r.mensagem).toContain('"abc"');
    });

    it('PORT fora da faixa valida falha', () => {
        expect(validar(ambienteMinimo({ PORT: '0' })).ok).toBe(false);
        expect(validar(ambienteMinimo({ PORT: '70000' })).ok).toBe(false);
        expect(validar(ambienteMinimo({ PORT: '3000' })).ok).toBe(true);
    });

    it('CA-002: lista TODOS os problemas de uma vez', () => {
        const r = validar({ PORT: 'abc', RATE_LIMIT_MSGS: 'x', LOOP_MAX_TURNOS: 'y' });
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('OPENAI_API_KEY');
        expect(r.mensagem).toContain('PORT');
        expect(r.mensagem).toContain('RATE_LIMIT_MSGS');
        expect(r.mensagem).toContain('LOOP_MAX_TURNOS');
    });

    it('a mensagem orienta onde corrigir', () => {
        expect(validar({}).mensagem).toContain('.env.example');
    });
});

describe('config: coercao de tipos', () => {
    it('IA_ALLOWED_CONTACTS vira lista, ignorando espacos e vazios', () => {
        const r = validar(ambienteMinimo({ IA_ALLOWED_CONTACTS: ' 5583999998888 , , 5584994610845 ' }));
        expect(r.config.IA_ALLOWED_CONTACTS).toEqual(['5583999998888', '5584994610845']);
    });

    it('lista vazia ou ausente vira array vazio (libera todos)', () => {
        expect(validar(ambienteMinimo({ IA_ALLOWED_CONTACTS: '' })).config.IA_ALLOWED_CONTACTS).toEqual([]);
        expect(validar(ambienteMinimo()).config.IA_ALLOWED_CONTACTS).toEqual([]);
    });

    it('booleanos seguem o legado: so "false" desliga', () => {
        expect(validar(ambienteMinimo({ IGNORAR_GRUPOS: 'false' })).config.IGNORAR_GRUPOS).toBe(false);
        expect(validar(ambienteMinimo({ IGNORAR_GRUPOS: 'qualquer' })).config.IGNORAR_GRUPOS).toBe(true);
        expect(validar(ambienteMinimo({ IA_SO_PENDENTES: 'false' })).config.IA_SO_PENDENTES).toBe(false);
    });

    it('LOG_PAYLOAD so liga com "true" explicito', () => {
        expect(validar(ambienteMinimo({ LOG_PAYLOAD: 'true' })).config.LOG_PAYLOAD).toBe(true);
        expect(validar(ambienteMinimo({ LOG_PAYLOAD: '1' })).config.LOG_PAYLOAD).toBe(false);
        expect(validar(ambienteMinimo({ LOG_PAYLOAD: 'sim' })).config.LOG_PAYLOAD).toBe(false);
    });

    it('RATE_LIMIT_MSGS=0 e valido (desativa o limite)', () => {
        expect(validar(ambienteMinimo({ RATE_LIMIT_MSGS: '0' })).config.RATE_LIMIT_MSGS).toBe(0);
    });
});

describe('config: producao e fail-closed (S4)', () => {
    const producao = (extra = {}) => ({
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'sk-teste',
        CC_PUSH_URL: 'https://api.chatclean.com.br/v1/api/external/uuid/?token=jwt',
        WEBHOOK_SECRET: 'um-segredo-bem-longo-123',
        ...extra
    });

    it('producao completa e valida', () => {
        const r = validar(producao());
        expect(r.ok).toBe(true);
        expect(r.config.ehProducao).toBe(true);
    });

    it('CA-004: producao sem WEBHOOK_SECRET nao sobe', () => {
        const r = validar(producao({ WEBHOOK_SECRET: '' }));
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('WEBHOOK_SECRET');
        expect(r.mensagem).toContain('ABERTO');
    });

    it('producao com segredo curto demais nao sobe', () => {
        const r = validar(producao({ WEBHOOK_SECRET: 'curto' }));
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('16 caracteres');
    });

    it('producao sem CC_PUSH_URL nao sobe (a IA nao conseguiria responder)', () => {
        const r = validar(producao({ CC_PUSH_URL: '' }));
        expect(r.ok).toBe(false);
        expect(r.mensagem).toContain('CC_PUSH_URL');
    });

    it('producao com CC_PUSH_URL invalida nao sobe', () => {
        expect(validar(producao({ CC_PUSH_URL: 'nao-e-url' })).ok).toBe(false);
    });

    it('CA-005: fora de producao, segredo e push vazios sao aceitos', () => {
        const r = validar(ambienteMinimo({ NODE_ENV: 'development' }));
        expect(r.ok).toBe(true);
        expect(r.config.ehProducao).toBe(false);
    });
});

describe('config: avisos operacionais', () => {
    it('avisa sobre o que e legal mas merece atencao', () => {
        const { config } = validar(ambienteMinimo());
        const lista = avisos(config).join(' | ');
        expect(lista).toContain('ADMIN_KEY');
        expect(lista).toContain('REDIS_URL');
        expect(lista).toContain('CC_PUSH_URL');
        expect(lista).toContain('WEBHOOK_SECRET');
    });

    it('nao avisa sobre o que esta configurado', () => {
        const { config } = validar(
            ambienteMinimo({
                ADMIN_KEY: 'k',
                REDIS_URL: 'redis://localhost:6379',
                CC_PUSH_URL: 'https://x/y',
                WEBHOOK_SECRET: 's',
                EQUIPE_NUMERO: '5583999998888'
            })
        );
        expect(avisos(config)).toEqual([]);
    });

    it('avisa em destaque quando LOG_PAYLOAD esta ligado', () => {
        const { config } = validar(ambienteMinimo({ LOG_PAYLOAD: 'true' }));
        expect(avisos(config).join(' ')).toContain('dados pessoais');
    });
});
