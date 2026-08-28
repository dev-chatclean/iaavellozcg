import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PoliticaAntiLoop = require('../../src/domain/atendimento/politicas/PoliticaAntiLoop');

// =============================================================
//  Blindagem anti-loop (RN-056).
//
//  A regra existia dentro de um bloco anonimo `{ ... }` no meio do turno, com
//  cinco variaveis de estado mutadas em linha. Nao tinha teste: o unico jeito
//  de exercita-la era disparar 16 mensagens no teste dourado.
// =============================================================

const T0 = 1_700_000_000_000; // instante fixo; o relogio entra por parametro
const JANELA = 3 * 60 * 1000;

const politica = ({ maxTurnos = 15, janelaMs = JANELA } = {}) => PoliticaAntiLoop.criar({ maxTurnos, janelaMs });

/** Dispara n mensagens diferentes, uma por segundo. */
function disparar(p, estado, n, inicio = T0, textoBase = 'msg') {
    let r;
    for (let i = 0; i < n; i++) r = p.avaliar(estado, `${textoBase} ${i}`, inicio + i * 1000);
    return r;
}

describe('anti-loop: volume', () => {
    it('conversa normal nao pausa', () => {
        const estado = {};
        const r = disparar(politica(), estado, 5);
        expect(r.pausar).toBe(false);
        expect(r.motivo).toBeNull();
    });

    it('pausa quando ULTRAPASSA o teto — no teto ainda passa', () => {
        const p = politica({ maxTurnos: 5 });

        const noTeto = disparar(p, {}, 5);
        expect(noTeto.pausar).toBe(false);

        const acima = disparar(p, {}, 6);
        expect(acima.pausar).toBe(true);
        expect(acima.motivo).toBe('volume');
    });

    it('mensagens FORA da janela nao contam', () => {
        const p = politica({ maxTurnos: 3 });
        const estado = {};

        disparar(p, estado, 3, T0); // T0, T0+1s, T0+2s
        // Depois da janela inteira contada a partir da ULTIMA mensagem.
        const r = p.avaliar(estado, 'depois', T0 + 2000 + JANELA);

        expect(r.pausar).toBe(false);
        expect(r.turnosNaJanela).toBe(1);
    });

    it('a janela e contada a partir de CADA mensagem, nao da primeira', () => {
        const p = politica({ maxTurnos: 3 });
        const estado = {};

        disparar(p, estado, 3, T0);
        // A terceira mensagem (T0+2s) ainda esta dentro da janela.
        const r = p.avaliar(estado, 'depois', T0 + JANELA + 1000);

        expect(r.turnosNaJanela).toBe(2);
    });

    it('a janela desliza: so as mensagens recentes contam', () => {
        const p = politica({ maxTurnos: 3, janelaMs: 10_000 });
        const estado = {};

        p.avaliar(estado, 'a', T0);
        p.avaliar(estado, 'b', T0 + 4000);
        p.avaliar(estado, 'c', T0 + 8000);
        // A primeira ja saiu da janela quando esta chega.
        const r = p.avaliar(estado, 'd', T0 + 12000);

        expect(r.turnosNaJanela).toBe(3);
        expect(r.pausar).toBe(false);
    });
});

describe('anti-loop: repeticao', () => {
    it('a MESMA mensagem tres vezes pausa, mesmo dentro do teto de volume', () => {
        const p = politica({ maxTurnos: 100 });
        const estado = {};

        expect(p.avaliar(estado, 'oi', T0).pausar).toBe(false);
        expect(p.avaliar(estado, 'oi', T0 + 1000).pausar).toBe(false);
        const terceira = p.avaliar(estado, 'oi', T0 + 2000);

        expect(terceira.pausar).toBe(true);
        expect(terceira.motivo).toBe('repeticao');
    });

    it('caixa e espacos nao distinguem: um bot repetindo continua sendo repeticao', () => {
        const p = politica({ maxTurnos: 100 });
        const estado = {};

        p.avaliar(estado, 'Bom dia', T0);
        p.avaliar(estado, '  bom   DIA  ', T0 + 1000);
        expect(p.avaliar(estado, 'BOM DIA', T0 + 2000).pausar).toBe(true);
    });

    it('mensagem de UM caractere nao conta como repeticao', () => {
        const p = politica({ maxTurnos: 100 });
        const estado = {};
        for (let i = 0; i < 5; i++) {
            expect(p.avaliar(estado, '?', T0 + i * 1000).pausar).toBe(false);
        }
    });

    it('o histórico de textos e limitado: repeticao antiga nao acusa para sempre', () => {
        const p = politica({ maxTurnos: 100 });
        const estado = {};

        p.avaliar(estado, 'oi', T0);
        p.avaliar(estado, 'oi', T0 + 1000);
        // Empurra as duas para fora do histórico com mensagens diferentes.
        for (let i = 0; i < PoliticaAntiLoop.HISTORICO_DE_TEXTOS; i++) {
            p.avaliar(estado, `outra ${i}`, T0 + 2000 + i * 1000);
        }

        expect(p.avaliar(estado, 'oi', T0 + 20000).pausar).toBe(false);
        expect(estado.ultimasMsgs.length).toBeLessThanOrEqual(PoliticaAntiLoop.HISTORICO_DE_TEXTOS);
    });
});

describe('anti-loop: aviso a equipe', () => {
    it('avisa UMA vez, nao a cada mensagem do loop', () => {
        const p = politica({ maxTurnos: 3 });
        const estado = {};

        const primeira = disparar(p, estado, 4);
        expect(primeira).toMatchObject({ pausar: true, avisar: true });

        const seguinte = p.avaliar(estado, 'mais uma', T0 + 5000);
        expect(seguinte).toMatchObject({ pausar: true, avisar: false });
    });

    it('quando a conversa normaliza, um loop futuro volta a avisar', () => {
        const p = politica({ maxTurnos: 3 });
        const estado = {};

        expect(disparar(p, estado, 4).avisar).toBe(true);

        // Silencio: a janela esvazia e a conversa volta ao normal.
        p.avaliar(estado, 'oi de novo', T0 + JANELA + 10_000);
        expect(estado.loopAvisado).toBe(false);

        // Coleta cada resultado: o aviso sai no turno em que a pausa comeca,
        // e nao no ultimo do loop.
        const inicio = T0 + JANELA + 11_000;
        const resultados = [];
        for (let i = 0; i < 4; i++) resultados.push(p.avaliar(estado, `nova ${i}`, inicio + i * 1000));

        expect(resultados.some((r) => r.pausar && r.avisar)).toBe(true);
        expect(resultados.filter((r) => r.avisar)).toHaveLength(1);
    });

    it('volume tem precedencia sobre repeticao no motivo relatado', () => {
        const p = politica({ maxTurnos: 2 });
        const estado = {};
        p.avaliar(estado, 'oi', T0);
        p.avaliar(estado, 'oi', T0 + 1000);
        const r = p.avaliar(estado, 'oi', T0 + 2000); // as duas condicoes valem

        expect(r.motivo).toBe('volume');
    });
});

describe('anti-loop: o estado sobrevive ao turno', () => {
    it('turnosTs, ultimasMsgs e loopAvisado ficam no estado persistido', () => {
        const estado = {};
        politica().avaliar(estado, 'oi', T0);

        expect(estado.turnosTs).toEqual([T0]);
        expect(estado.ultimasMsgs).toEqual(['oi']);
        expect(estado.loopAvisado).toBe(false);
    });

    it('estado vindo do Redis (ja com historico) continua de onde parou', () => {
        const p = politica({ maxTurnos: 3 });
        const doRedis = { turnosTs: [T0, T0 + 1000, T0 + 2000], ultimasMsgs: ['a', 'b', 'c'] };

        const r = p.avaliar(doRedis, 'd', T0 + 3000);
        expect(r.turnosNaJanela).toBe(4);
        expect(r.pausar).toBe(true);
    });

    it('texto nulo ou vazio nao lanca', () => {
        const p = politica();
        expect(() => p.avaliar({}, null, T0)).not.toThrow();
        expect(() => p.avaliar({}, undefined, T0)).not.toThrow();
        expect(PoliticaAntiLoop.normalizar(null)).toBe('');
    });

    it('textos longos sao truncados antes de comparar', () => {
        const longo = 'x'.repeat(500);
        expect(PoliticaAntiLoop.normalizar(longo)).toHaveLength(PoliticaAntiLoop.TAMANHO_MAXIMO_DO_TEXTO);
    });
});
