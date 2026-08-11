import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mascarar = require('../../src/shared/mascarar');

// =============================================================
//  SPEC 0002 — cobre o risco S1 (dados pessoais no log).
//  A mascara precisa esconder o dado E continuar util para correlacionar
//  um atendimento durante uma investigacao.
// =============================================================

describe('mascarar.telefone', () => {
    it('preserva pais, DDD e os quatro ultimos digitos', () => {
        expect(mascarar.telefone('5583999998888')).toBe('5583*****8888');
    });

    it('mascara numero de 12 digitos (sem o nono)', () => {
        expect(mascarar.telefone('558399998888')).toBe('5583****8888');
    });

    it('normaliza JID antes de mascarar', () => {
        expect(mascarar.telefone('558491756446:24@s.whatsapp.net')).toBe('5584****6446');
    });

    it('remove mascara de formatacao', () => {
        expect(mascarar.telefone('+55 (83) 99999-8888')).toBe('5583*****8888');
    });

    it('numeros curtos sao mascarados de forma conservadora', () => {
        expect(mascarar.telefone('12345678')).toBe('12******');
        expect(mascarar.telefone('123')).toBe('12*');
    });

    it('entrada vazia nao quebra', () => {
        expect(mascarar.telefone('')).toBe('(sem número)');
        expect(mascarar.telefone(null)).toBe('(sem número)');
        expect(mascarar.telefone(undefined)).toBe('(sem número)');
        expect(mascarar.telefone('sem digitos')).toBe('(sem número)');
    });

    it('dois numeros diferentes com mesmo DDD e final continuam distinguiveis pelo tamanho', () => {
        expect(mascarar.telefone('5583999998888')).not.toBe(mascarar.telefone('558399998888'));
    });
});

describe('mascarar.cpf', () => {
    it('esconde os seis primeiros digitos', () => {
        expect(mascarar.cpf('12345678900')).toBe('***.***.789-00');
    });

    it('aceita CPF formatado', () => {
        expect(mascarar.cpf('123.456.789-00')).toBe('***.***.789-00');
    });

    it('valor vazio devolve vazio', () => {
        expect(mascarar.cpf('')).toBe('');
        expect(mascarar.cpf(null)).toBe('');
    });

    it('quantidade errada de digitos nao vaza o valor', () => {
        expect(mascarar.cpf('123')).toBe('(cpf inválido)');
        expect(mascarar.cpf('123')).not.toContain('123');
    });
});

describe('mascarar.conteudo', () => {
    it('registra apenas o tamanho da mensagem, nunca o texto', () => {
        expect(mascarar.conteudo('meu CPF e 12345678900')).toBe('(21 caracteres)');
        expect(mascarar.conteudo('meu CPF e 12345678900')).not.toContain('12345678900');
    });

    it('mensagem vazia e sinalizada', () => {
        expect(mascarar.conteudo('')).toBe('(vazio)');
        expect(mascarar.conteudo(null)).toBe('(vazio)');
    });
});
