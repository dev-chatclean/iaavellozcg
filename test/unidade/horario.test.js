import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { estaEmExpediente, ehFeriado, TZ } = require('../../horario');

// =============================================================
//  SPEC 0001 — T13 · Cobre RN-060, RN-061, RN-062 e CA-009.
//
//  Todas as datas sao construidas com o deslocamento -03:00 (America/Recife
//  nao tem horario de verao), para que os testes independam do fuso da maquina
//  que roda a suite.
// =============================================================

const emRecife = (iso) => new Date(`${iso}-03:00`);

// Referencia de dias da semana (confirmados):
//   2026-08-11 terca | 2026-08-15 sabado | 2026-08-16 domingo
//   2026-09-07 segunda (Independencia) | 2026-12-25 sexta (Natal)
//   2026-12-31 quinta | 2027-01-01 sexta (Confraternizacao) | 2027-01-04 segunda

describe('horario: fuso', () => {
    it('opera em America/Recife', () => {
        expect(TZ).toBe('America/Recife');
    });
});

describe('horario: dia util dentro e fora do expediente (RN-060)', () => {
    it('terca as 10h esta aberto', () => {
        expect(estaEmExpediente(emRecife('2026-08-11T10:00:00'))).toEqual({
            aberto: true,
            motivo: null,
            proximoExpediente: null
        });
    });

    it('abre exatamente as 9h', () => {
        expect(estaEmExpediente(emRecife('2026-08-11T09:00:00')).aberto).toBe(true);
    });

    it('as 8h59 ainda esta fechado, e o proximo expediente e hoje', () => {
        const r = estaEmExpediente(emRecife('2026-08-11T08:59:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('antes do horário');
        expect(r.proximoExpediente).toBe('hoje às 9h');
    });

    it('as 17h59 ainda esta aberto', () => {
        expect(estaEmExpediente(emRecife('2026-08-11T17:59:00')).aberto).toBe(true);
    });

    it('as 18h fecha (atende enquanto hora < 18)', () => {
        const r = estaEmExpediente(emRecife('2026-08-11T18:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('amanhã às 9h');
    });
});

describe('horario: fim de semana (RN-060, CA-009)', () => {
    // CONGELA BUG D-19 — o negocio confirmou (2026-08-11) que a loja ATENDE
    // sabado, em horario comercial. O codigo atual trata sabado como fim de
    // semana. Este teste registra o comportamento ATUAL e deve ser INVERTIDO
    // pela spec 0009.
    it('CONGELA BUG D-19: sabado as 10h e tratado como fim de semana', () => {
        const r = estaEmExpediente(emRecife('2026-08-15T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fim de semana');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('domingo as 10h esta fechado e aponta para segunda', () => {
        const r = estaEmExpediente(emRecife('2026-08-16T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fim de semana');
        expect(r.proximoExpediente).toBe('amanhã às 9h');
    });
});

describe('horario: feriados nacionais fixos (RN-062)', () => {
    it.each([
        ['2026-01-01', 'Confraternizacao'],
        ['2026-04-21', 'Tiradentes'],
        ['2026-05-01', 'Dia do Trabalho'],
        ['2026-09-07', 'Independencia'],
        ['2026-10-12', 'Nossa Senhora Aparecida'],
        ['2026-11-02', 'Finados'],
        ['2026-11-15', 'Proclamacao da Republica'],
        ['2026-11-20', 'Consciencia Negra'],
        ['2026-12-25', 'Natal']
    ])('%s (%s) e feriado', (data) => {
        expect(ehFeriado(new Date(`${data}T12:00:00-03:00`))).toBe(true);
    });

    it('segunda-feira 07/09 (Independencia) fecha o expediente mesmo em dia util', () => {
        const r = estaEmExpediente(emRecife('2026-09-07T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
        expect(r.proximoExpediente).toBe('amanhã às 9h');
    });

    it('dia comum nao e feriado', () => {
        expect(ehFeriado(new Date('2026-08-11T12:00:00-03:00'))).toBe(false);
    });
});

describe('horario: virada de ano pulando feriado e fim de semana', () => {
    it('quinta 31/12 as 19h aponta para segunda 04/01 (pula 01/01, sabado e domingo)', () => {
        const r = estaEmExpediente(emRecife('2026-12-31T19:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('sexta 25/12 (Natal) aponta para a segunda seguinte', () => {
        const r = estaEmExpediente(emRecife('2026-12-25T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });
});

describe('horario: feriados extras por variavel de ambiente (RN-062)', () => {
    // O modulo le FERIADOS no carregamento, entao e preciso reimportar.
    let originalFeriados;

    beforeEach(() => {
        originalFeriados = process.env.FERIADOS;
        vi.resetModules();
    });

    afterEach(() => {
        if (originalFeriados === undefined) delete process.env.FERIADOS;
        else process.env.FERIADOS = originalFeriados;
        vi.resetModules();
    });

    const recarregar = () => {
        delete require.cache[require.resolve('../../horario')];
        return require('../../horario');
    };

    it('aceita data completa YYYY-MM-DD (feriado movel de um ano especifico)', () => {
        process.env.FERIADOS = '2026-02-17';
        const h = recarregar();
        expect(h.ehFeriado(new Date('2026-02-17T12:00:00-03:00'))).toBe(true);
        expect(h.ehFeriado(new Date('2027-02-17T12:00:00-03:00'))).toBe(false);
    });

    it('aceita MM-DD como feriado recorrente (ex.: municipal)', () => {
        process.env.FERIADOS = '06-24';
        const h = recarregar();
        expect(h.ehFeriado(new Date('2026-06-24T12:00:00-03:00'))).toBe(true);
        expect(h.ehFeriado(new Date('2027-06-24T12:00:00-03:00'))).toBe(true);
    });

    it('aceita lista com espacos e entradas vazias', () => {
        process.env.FERIADOS = ' 2026-02-17 , , 06-24 ';
        const h = recarregar();
        expect(h.ehFeriado(new Date('2026-02-17T12:00:00-03:00'))).toBe(true);
        expect(h.ehFeriado(new Date('2026-06-24T12:00:00-03:00'))).toBe(true);
    });

    it('feriado extra fecha o expediente num dia util', () => {
        process.env.FERIADOS = '2026-08-12';
        const h = recarregar();
        const r = h.estaEmExpediente(new Date('2026-08-12T10:00:00-03:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
    });
});

describe('horario: chamada sem argumento', () => {
    it('usa a hora atual e devolve o contrato completo', () => {
        const r = estaEmExpediente();
        expect(r).toHaveProperty('aberto');
        expect(r).toHaveProperty('motivo');
        expect(r).toHaveProperty('proximoExpediente');
        expect(typeof r.aberto).toBe('boolean');
        if (r.aberto) expect(r.proximoExpediente).toBeNull();
        else expect(typeof r.proximoExpediente).toBe('string');
    });
});
