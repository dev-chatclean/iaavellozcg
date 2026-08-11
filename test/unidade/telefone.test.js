import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizarPhone, nucleoNumero, contatoPermitido } = require('../../src/shared/telefone');

// =============================================================
//  SPEC 0001 — T16 · Cobre CA-002 (sufixo de dispositivo) e CA-010
//  (tolerancia ao 9o digito na allow-list, RN-058).
//
//  Escritos ANTES da extracao de index.js para src/shared/telefone.js:
//  sao eles que provam que a mudanca foi mecanica.
// =============================================================

describe('normalizarPhone', () => {
    it('CA-002: corta o sufixo de dispositivo e o servidor do JID', () => {
        // Sem cortar antes de remover nao-digitos, o ":24" grudaria no numero.
        expect(normalizarPhone('558491756446:24@s.whatsapp.net')).toBe('558491756446');
    });

    it('corta apenas o servidor quando nao ha id de dispositivo', () => {
        expect(normalizarPhone('5583999998888@s.whatsapp.net')).toBe('5583999998888');
    });

    it('remove mascara e separadores', () => {
        expect(normalizarPhone('+55 (83) 99999-8888')).toBe('5583999998888');
        expect(normalizarPhone('55-83-99999.8888')).toBe('5583999998888');
    });

    it('mantem um numero ja limpo', () => {
        expect(normalizarPhone('5583999998888')).toBe('5583999998888');
    });

    it('aceita entrada numerica', () => {
        expect(normalizarPhone(5583999998888)).toBe('5583999998888');
    });

    it('devolve string vazia quando nao ha digito', () => {
        expect(normalizarPhone('')).toBe('');
        expect(normalizarPhone('sem numero')).toBe('');
    });

    it('nao lanca com null ou undefined', () => {
        expect(() => normalizarPhone(null)).not.toThrow();
        expect(() => normalizarPhone(undefined)).not.toThrow();
    });
});

describe('nucleoNumero (comparacao ignorando o 9o digito)', () => {
    it('remove o 9 logo apos o DDD em celular de 13 digitos', () => {
        expect(nucleoNumero('5584994610845')).toBe('558494610845');
    });

    it('mantem o numero de 12 digitos inalterado', () => {
        expect(nucleoNumero('558494610845')).toBe('558494610845');
    });

    it('as duas formas do mesmo celular colapsam no mesmo nucleo', () => {
        expect(nucleoNumero('5584994610845')).toBe(nucleoNumero('558494610845'));
    });

    it('nao mexe em numero de 13 digitos que nao comeca com 55', () => {
        expect(nucleoNumero('1234994610845')).toBe('1234994610845');
    });

    it('nao mexe em 13 digitos cujo 5o digito nao e 9', () => {
        expect(nucleoNumero('5584894610845')).toBe('5584894610845');
    });

    it('tambem normaliza JID com sufixo de dispositivo', () => {
        expect(nucleoNumero('5584994610845:12@s.whatsapp.net')).toBe('558494610845');
    });
});

describe('contatoPermitido (allow-list de homologacao, RN-058)', () => {
    it('lista vazia libera qualquer contato', () => {
        expect(contatoPermitido('5583999998888', [])).toBe(true);
        expect(contatoPermitido('5583999998888', undefined)).toBe(true);
    });

    it('permite numero identico ao da lista', () => {
        expect(contatoPermitido('5583999998888', ['5583999998888'])).toBe(true);
    });

    it('CA-010: tolera o 9o digito nos dois sentidos', () => {
        expect(contatoPermitido('558494610845', ['5584994610845'])).toBe(true);
        expect(contatoPermitido('5584994610845', ['558494610845'])).toBe(true);
    });

    it('tolera mascara e JID na comparacao', () => {
        expect(contatoPermitido('5584994610845:24@s.whatsapp.net', ['+55 (84) 99461-0845'])).toBe(true);
    });

    it('bloqueia numero fora da lista', () => {
        expect(contatoPermitido('5583911112222', ['5584994610845'])).toBe(false);
    });

    it('basta casar com um item da lista', () => {
        const lista = ['5511999990000', '5584994610845', '5583988887777'];
        expect(contatoPermitido('558494610845', lista)).toBe(true);
        expect(contatoPermitido('5599999999999', lista)).toBe(false);
    });
});
