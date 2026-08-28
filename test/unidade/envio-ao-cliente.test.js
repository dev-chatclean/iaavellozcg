import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const EnvioAoCliente = require('../../src/application/envio/EnvioAoCliente');

// =============================================================
//  Envio ao cliente, isolado.
//
//  Duas decisoes de produto vivem aqui — quebrar a resposta em baloes e a
//  pausa de digitacao — e as duas tem divida documentada. O teste dourado ve
//  o resultado; aqui da para ver a REGRA, inclusive onde ela erra.
// =============================================================

function canalFake({ ok = true } = {}) {
    const enviados = [];
    return {
        enviados,
        enviar: vi.fn(async (numero, payload) => {
            enviados.push({ numero, body: payload.body });
            return { ok };
        }),
        textos: () => enviados.map((e) => e.body)
    };
}

/** Espera falsa: registra quanto teria esperado, sem esperar. */
function esperaFalsa() {
    const esperas = [];
    return { esperas, esperar: async (ms) => void esperas.push(ms) };
}

const criar = (canal, espera = esperaFalsa()) =>
    EnvioAoCliente.criar({ canal, esperar: espera.esperar });

const CHAT = '5583999998888';

describe('enviar: uma mensagem', () => {
    it('entrega o texto ao canal e devolve o ok', async () => {
        const canal = canalFake();
        expect(await criar(canal).enviar(CHAT, 'oi')).toBe(true);
        expect(canal.enviados).toEqual([{ numero: CHAT, body: 'oi' }]);
    });

    it('devolve false quando o canal recusa', async () => {
        expect(await criar(canalFake({ ok: false })).enviar(CHAT, 'oi')).toBe(false);
    });

    it.each([['', 'vazio'], ['   ', 'so espacos'], [null, 'nulo'], [undefined, 'indefinido']])(
        'texto %s (%s) NAO vira mensagem — o cliente nao pode receber balao em branco',
        async (texto) => {
            const canal = canalFake();
            expect(await criar(canal).enviar(CHAT, texto)).toBe(false);
            expect(canal.enviar).not.toHaveBeenCalled();
        }
    );
});

describe('enviarEmPartes: quebra por linha', () => {
    it('cada linha vira uma mensagem', async () => {
        const canal = canalFake();
        await criar(canal).enviarEmPartes(CHAT, 'primeira\nsegunda\nterceira');

        expect(canal.textos()).toEqual(['primeira', 'segunda', 'terceira']);
    });

    it('linhas em branco sao descartadas', async () => {
        const canal = canalFake();
        await criar(canal).enviarEmPartes(CHAT, 'uma\n\n   \nduas');

        expect(canal.textos()).toEqual(['uma', 'duas']);
    });

    it('texto de uma linha so sai numa mensagem', async () => {
        const canal = canalFake();
        await criar(canal).enviarEmPartes(CHAT, 'so uma linha');
        expect(canal.textos()).toEqual(['so uma linha']);
    });
});

describe('enviarEmPartes: atraso de digitacao', () => {
    it('espera antes de CADA parte, proporcional ao tamanho', async () => {
        const canal = canalFake();
        const espera = esperaFalsa();
        await criar(canal, espera).enviarEmPartes(CHAT, 'oi\nmensagem mais longa');

        expect(espera.esperas).toEqual([
            EnvioAoCliente.ATRASO_BASE_MS + 2 * EnvioAoCliente.ATRASO_POR_CARACTERE_MS,
            EnvioAoCliente.ATRASO_BASE_MS + 'mensagem mais longa'.length * EnvioAoCliente.ATRASO_POR_CARACTERE_MS
        ]);
    });

    it('a espera vem ANTES do envio, nao depois', async () => {
        const ordem = [];
        const canal = {
            enviar: async () => {
                ordem.push('envio');
                return { ok: true };
            }
        };
        const envio = EnvioAoCliente.criar({
            canal,
            esperar: async () => void ordem.push('espera')
        });

        await envio.enviarEmPartes(CHAT, 'a\nb');
        expect(ordem).toEqual(['espera', 'envio', 'espera', 'envio']);
    });

    it('mensagem enviada inteira NAO tem atraso', async () => {
        const espera = esperaFalsa();
        await criar(canalFake(), espera).enviarEmPartes(CHAT, 'já estou repassando pro time');
        expect(espera.esperas).toEqual([]);
    });
});

describe('CONGELA (D-08): a decisao de nao quebrar usa palavras comuns', () => {
    const inteiro = async (texto) => {
        const canal = canalFake();
        await criar(canal).enviarEmPartes(CHAT, texto);
        return canal.textos().length === 1;
    };

    it('resumo e encaminhamento vao inteiros — que era a intencao', async () => {
        expect(await inteiro('Estou encaminhando\nseu atendimento')).toBe(true);
        expect(await inteiro('Segue o resumo\ndo seu caso')).toBe(true);
        expect(await inteiro('Já estou repassando\npro time')).toBe(true);
    });

    // ------------------------------------------------------------------
    //  O efeito colateral: "consultor" e "especialista" sao palavras comuns
    //  neste dominio. Qualquer resposta normal que as mencione deixa de ser
    //  quebrada e chega num balao unico e longo — exatamente o que a quebra
    //  existe para evitar.
    // ------------------------------------------------------------------
    it('resposta COMUM que menciona "consultor" tambem vai inteira', async () => {
        const resposta = 'A AZ125 sai por R$ 14.190,00 já com emplacamento.\nO consultor fecha a condição com você.\nQual unidade fica melhor?';
        expect(await inteiro(resposta)).toBe(true);
    });

    it('resposta COMUM que menciona "especialista" tambem vai inteira', async () => {
        expect(await inteiro('Nosso especialista te ajuda nisso.\nQuer que eu já veja?')).toBe(true);
    });

    it('a mesma resposta SEM essas palavras e quebrada normalmente', async () => {
        const resposta = 'A AZ125 sai por R$ 14.190,00 já com emplacamento.\nQual unidade fica melhor?';
        expect(await inteiro(resposta)).toBe(false);
    });

    it('a palavra basta em qualquer lugar do texto, e ignora caixa', async () => {
        expect(await inteiro('bom dia\nCONSULTOR')).toBe(true);
    });
});
