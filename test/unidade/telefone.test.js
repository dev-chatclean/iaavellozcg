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

// =============================================================
//  Tolerancia ao ID de dispositivo grudado — comportamento acrescentado
//  depois do commit raiz, por causa de um caso real de producao.
// =============================================================
describe('contatoPermitido: ID de dispositivo grudado no fim', () => {
    const LISTA = ['558494610845'];

    // ============================================================
    //  CONGELA (D-32) — as duas tolerancias colidem
    //
    //  Um ID de dispositivo de UM digito colado num numero de 12 digitos
    //  produz 13 digitos, que e exatamente o comprimento que dispara a regra
    //  do 9o digito. Se o 5o caractere for '9' — e ele e parte do numero, nao
    //  o 9o digito de celular — a regra remove o digito ERRADO:
    //
    //      558494610845 + 9  ->  5584946108459  -> nucleo 558446108459
    //                                                   (perdeu o 9 do meio)
    //
    //  e a comparacao falha. Com ID de 2 digitos (14 caracteres) nao acontece,
    //  porque a regra do 9o digito so age em 13.
    //
    //  Alcance real hoje e pequeno: a allow-list so vale na fase de teste
    //  (IA_ALLOWED_CONTACTS vazia libera todos). Corrigir e mudanca de
    //  comportamento — fica como divida.
    // ============================================================
    it('CONGELA: ID de dispositivo de 1 digito NAO e reconhecido', () => {
        expect(contatoPermitido('5584946108459', LISTA)).toBe(false);
    });

    it('o mesmo numero com ID de 2 digitos e reconhecido', () => {
        expect(contatoPermitido('55849461084559', LISTA)).toBe(true);
    });

    it('com base cujo 5o caractere NAO e 9, o ID de 1 digito funciona', () => {
        expect(contatoPermitido('5583812345678', ['558381234567'])).toBe(true);
    });

    it('aceita o numero com o ID de dispositivo colado (2 digitos)', () => {
        expect(contatoPermitido('55849461084559', LISTA)).toBe(true);
    });

    it('aceita quando o ID ainda vem separado por dois-pontos', () => {
        expect(contatoPermitido('558494610845:59@s.whatsapp.net', LISTA)).toBe(true);
    });

    it('a sobra para em 2 digitos: nao casa numero de outra pessoa por prefixo', () => {
        // 3 digitos a mais ja seria outro numero, nao um ID de dispositivo.
        expect(contatoPermitido('558494610845123', LISTA)).toBe(false);
    });

    it('nao aceita numero mais CURTO que o permitido', () => {
        expect(contatoPermitido('55849461084', LISTA)).toBe(false);
    });

    it('combina com a tolerancia ao 9o digito', () => {
        // Lista com 9o digito; chega sem o 9 e com ID de dispositivo colado.
        expect(contatoPermitido('55849461084559', ['5584994610845'])).toBe(true);
    });

    it('entrada vazia na lista e ignorada em vez de liberar geral', () => {
        expect(contatoPermitido('5583999998888', ['', '  '])).toBe(false);
    });
});
