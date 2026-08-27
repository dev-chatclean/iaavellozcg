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

describe('horario: sabado e domingo (RN-060)', () => {
    // ============================================================
    //  CONGELA (D-19) — DIVERGE DA REGRA DE NEGOCIO APROVADA
    //
    //  O codigo em producao trata SABADO COMO FIM DE SEMANA: fechado o dia
    //  inteiro, em qualquer hora. Mas o negocio ja confirmou que a loja atende
    //  sabado das 08h as 18h.
    //
    //  Estes testes congelam o comportamento ERRADO que esta no ar, para a
    //  refatoracao nao mudar nada sem querer. A correcao e mudanca de
    //  comportamento e tem spec propria — ver docs/15-inventario-de-comportamento.md.
    // ============================================================
    it('CONGELA: sabado as 10h esta FECHADO (o negocio diz que deveria abrir)', () => {
        expect(estaEmExpediente(emRecife('2026-08-15T10:00:00'))).toEqual({
            aberto: false,
            motivo: 'fim de semana',
            proximoExpediente: 'na segunda-feira às 9h'
        });
    });

    it('CONGELA: sabado esta fechado em qualquer hora, inclusive dentro de 08h-18h', () => {
        for (const hora of ['08:00:00', '12:00:00', '17:59:00']) {
            const r = estaEmExpediente(emRecife(`2026-08-15T${hora}`));
            expect(r.aberto).toBe(false);
            expect(r.motivo).toBe('fim de semana');
        }
    });

    it('CONGELA: sexta a noite pula o sabado inteiro e aponta para segunda', () => {
        const r = estaEmExpediente(emRecife('2026-08-14T19:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('domingo as 10h esta fechado e aponta para segunda', () => {
        const r = estaEmExpediente(emRecife('2026-08-16T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fim de semana');
        expect(r.proximoExpediente).toBe('amanhã às 9h');
    });

    it('sabado que e feriado continua fechado', () => {
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
    // CONGELA: como o sabado conta como fim de semana, todo salto que passa por
    // um sabado vai parar na segunda. Se a regra do sabado for corrigida, estes
    // tres casos mudam junto — sao o efeito visivel de D-19 para o cliente.
    it('CONGELA: quinta 31/12 as 19h pula o feriado e o fim de semana inteiro', () => {
        // 01/01/2027 e sexta e feriado; 02/01 e sabado. Cai na segunda 04/01.
        const r = estaEmExpediente(emRecife('2026-12-31T19:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('fora do horário (noite)');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('CONGELA: sexta 25/12 (Natal) aponta para a segunda, nao para o sabado', () => {
        const r = estaEmExpediente(emRecife('2026-12-25T10:00:00'));
        expect(r.aberto).toBe(false);
        expect(r.motivo).toBe('feriado');
        expect(r.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('usa a preposicao correta por genero do dia', () => {
        // "amanha" quando e o dia seguinte; "na <dia>" quando esta mais longe.
        expect(estaEmExpediente(emRecife('2026-08-16T10:00:00')).proximoExpediente).toBe('amanhã às 9h');
        expect(estaEmExpediente(emRecife('2026-08-15T19:00:00')).proximoExpediente).toBe('na segunda-feira às 9h');
    });
});

describe('expediente: feriados extras injetados (RN-062)', () => {
    // D-30 RESOLVIDA: os feriados eram lidos de process.env no carregamento do
    // modulo. Agora sao parametro — o dominio nao le ambiente, e da para ter
    // dois calendarios no mesmo processo.
    //
    // O comportamento do SISTEMA nao mudou: quem le a variavel e o
    // src/main/config, e continua lendo uma vez, no boot.

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

    it('tolera espacos e entradas vazias na lista', () => {
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
        expect(Expediente.criar().estaEmExpediente(new Date('2026-08-12T10:00:00-03:00')).aberto).toBe(true);
    });

    it('instancias diferentes NAO compartilham feriados', () => {
        // Era impossivel de escrever antes: com o Set no escopo do modulo, o
        // primeiro require vencia para todo o processo.
        const a = Expediente.criar({ feriadosExtras: ['2026-08-12'] });
        const b = Expediente.criar({ feriadosExtras: [] });
        expect(a.ehFeriado(new Date('2026-08-12T12:00:00-03:00'))).toBe(true);
        expect(b.ehFeriado(new Date('2026-08-12T12:00:00-03:00'))).toBe(false);
    });

    it('os feriados FIXOS nao dependem de configuracao: sao lei', () => {
        const e = Expediente.criar({ feriadosExtras: [] });
        expect(e.ehFeriado(new Date('2026-12-25T12:00:00-03:00'))).toBe(true);
        expect(e.ehFeriado(new Date('2026-09-07T12:00:00-03:00'))).toBe(true);
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
