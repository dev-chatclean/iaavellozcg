import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Expediente = require('../../src/domain/expediente/Expediente');
const { estaEmExpediente, ehFeriado, TZ } = Expediente;

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

describe('horario: sabado e domingo (RN-060, SPEC 0009)', () => {
    // D-19 CORRIGIDO pela spec 0009: a loja atende sabado, das 08h as 18h.
    // Este teste era o congelamento do bug e foi invertido.
    it('CA-001: sabado as 10h esta ABERTO', () => {
        expect(estaEmExpediente(emRecife('2026-08-15T10:00:00'))).toEqual({
            aberto: true,
            motivo: null,
            proximoExpediente: null
        });
    });

    it('sabado abre as 8h (uma hora antes dos dias uteis)', () => {
        expect(estaEmExpediente(emRecife('2026-08-15T08:00:00')).aberto).toBe(true);
    });

    it('CA-002: sabado as 7h59 ainda esta fechado e aponta para hoje as 8h', () => {
        const r = estaEmExpediente(emRecife('2026-08-15T07:59:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('antes do horário');
        expect(r.proximoExpediente).toBe('hoje às 8h');
    });

    it('CA-003: sabado as 18h fecha e pula o domingo', () => {
        const r = estaEmExpediente(emRecife('2026-08-15T18:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('CA-004: sexta a noite aponta para o sabado as 8h', () => {
        const r = estaEmExpediente(emRecife('2026-08-14T19:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.proximoExpediente).toBe('amanhã às 8h');
    });

    it('CA-005: domingo as 10h esta fechado e aponta para segunda', () => {
        const r = estaEmExpediente(emRecife('2026-08-16T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fim de semana');
        expect(r.proximoExpediente).toBe('amanhã às 9h');
    });

    it('CA-006: sabado que e feriado continua fechado', () => {
        // 21/11/2026 e sabado; 20/11 (Consciencia Negra) cai na sexta. Usamos
        // um feriado fixo que caia no sabado: 01/05/2027 (Dia do Trabalho).
        const r = estaEmExpediente(new Date('2027-05-01T10:00:00-03:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
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

describe('horario: virada de ano pulando feriado', () => {
    it('quinta 31/12 as 19h aponta para o sabado 02/01 (pula o feriado de 01/01)', () => {
        // 01/01/2027 e sexta e feriado; 02/01 e sabado, que agora e dia de
        // atendimento. Antes da SPEC 0009 este caso ia parar na segunda.
        const r = estaEmExpediente(emRecife('2026-12-31T19:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('no sábado às 8h');
    });

    it('sexta 25/12 (Natal) aponta para o sabado seguinte', () => {
        const r = estaEmExpediente(emRecife('2026-12-25T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
        expect(r.proximoExpediente).toBe('amanhã às 8h');
    });

    it('usa a preposicao correta por genero do dia', () => {
        // Domingo 27/12/2026 -> proximo e segunda 28: "amanha". Para pegar o
        // rotulo com preposicao, usamos um caso a dois dias de distancia.
        const sabadoNoite = estaEmExpediente(emRecife('2026-08-15T19:00:00'));
        expect(sabadoNoite.proximoExpediente).toBe('na segunda-feira às 9h');
        const quintaFeriadoLongo = estaEmExpediente(emRecife('2026-12-31T19:00:00'));
        expect(quintaFeriadoLongo.proximoExpediente).toMatch(/^no sábado/);
    });
});

describe('horario: feriados extras injetados (RN-062)', () => {
    // Antes da SPEC 0022 estes casos precisavam mexer em process.env e
    // recarregar o modulo. Agora os feriados sao parametro: o dominio nao le
    // ambiente, e o teste ficou direto.

    it('aceita data completa YYYY-MM-DD (feriado movel de um ano especifico)', () => {
        const e = Expediente.criar({ feriadosExtras: ['2026-02-17'] });
        expect(e.ehFeriado(new Date('2026-02-17T12:00:00-03:00'))).toBe(true);
        expect(e.ehFeriado(new Date('2027-02-17T12:00:00-03:00'))).toBe(false);
    });

    it('aceita MM-DD como feriado recorrente (ex.: municipal)', () => {
        const e = Expediente.criar({ feriadosExtras: ['06-24'] });
        expect(e.ehFeriado(new Date('2026-06-24T12:00:00-03:00'))).toBe(true);
        expect(e.ehFeriado(new Date('2027-06-24T12:00:00-03:00'))).toBe(true);
    });

    it('aceita lista com espacos e entradas vazias', () => {
        const e = Expediente.criar({ feriadosExtras: [' 2026-02-17 ', '', ' 06-24 '] });
        expect(e.ehFeriado(new Date('2026-02-17T12:00:00-03:00'))).toBe(true);
        expect(e.ehFeriado(new Date('2026-06-24T12:00:00-03:00'))).toBe(true);
    });

    it('feriado extra fecha o expediente num dia util', () => {
        const e = Expediente.criar({ feriadosExtras: ['2026-08-12'] });
        const r = e.estaEmExpediente(new Date('2026-08-12T10:00:00-03:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
    });

    it('sem feriados extras, o mesmo dia esta aberto', () => {
        expect(estaEmExpediente(new Date('2026-08-12T10:00:00-03:00')).aberto).toBe(true);
    });

    it('instancias diferentes nao compartilham feriados', () => {
        const a = Expediente.criar({ feriadosExtras: ['2026-08-12'] });
        const b = Expediente.criar({ feriadosExtras: [] });
        expect(a.ehFeriado(new Date('2026-08-12T12:00:00-03:00'))).toBe(true);
        expect(b.ehFeriado(new Date('2026-08-12T12:00:00-03:00'))).toBe(false);
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
