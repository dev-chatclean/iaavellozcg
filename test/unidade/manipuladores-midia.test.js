import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const manipuladores = require('../../src/application/midia/manipuladores');

// =============================================================
//  Os manipuladores de midia, isolados.
//
//  O teste dourado ja exercita esses caminhos de ponta a ponta. O que ele nao
//  consegue mostrar e a ASSIMETRIA entre os tipos — que audio e video, diante
//  da mesma falha, fazem coisas opostas. Aqui isso fica lado a lado.
// =============================================================

function deps({ bytes = Buffer.from('midia'), transcricao = 'texto falado', descricao = 'uma moto vermelha' } = {}) {
    return {
        baixador: {
            baixar: vi.fn(async () => {
                if (bytes instanceof Error) throw bytes;
                return bytes;
            })
        },
        transcritor: {
            transcrever: vi.fn(async () => {
                if (transcricao instanceof Error) throw transcricao;
                return transcricao;
            })
        },
        descreverImagem: vi.fn(async () => (descricao instanceof Error ? null : descricao))
    };
}

const criar = (o) => manipuladores.criar(deps(o));

describe('despacho por tipo', () => {
    it.each(['image', 'document', 'video', 'audio', 'ptt'])('reconhece o tipo "%s"', (tipo) => {
        expect(criar().para(tipo)).toBeTypeOf('function');
    });

    it('ptt e audio usam o MESMO manipulador', () => {
        const m = criar();
        expect(m.para('ptt')).toBe(m.para('audio'));
    });

    it.each(['text', 'sticker', 'location', '', undefined])('tipo "%s" nao tem manipulador', (tipo) => {
        expect(criar().para(tipo)).toBeNull();
    });
});

describe('imagem', () => {
    it('a descricao entra no histórico e fica disponivel para a resposta', async () => {
        const r = await criar().imagem({ mediaUrl: 'https://x/foto.jpg' });

        expect(r.encerra).toBe(false);
        expect(r.analiseImagem).toBe('uma moto vermelha');
        expect(r.historico[0].content).toContain('uma moto vermelha');
        expect(r.usuarioNoHistorico).toBe(true);
    });

    it('o texto do turno e sempre o mesmo — o que muda e o histórico', async () => {
        const comVisao = await criar().imagem({ mediaUrl: 'https://x/f.jpg' });
        const semVisao = await criar({ descricao: new Error('visao fora') }).imagem({ mediaUrl: 'https://x/f.jpg' });

        expect(comVisao.texto).toBe('Enviei uma imagem.');
        expect(semVisao.texto).toBe('Enviei uma imagem.');
        expect(semVisao.analiseImagem).toBeNull();
        expect(semVisao.historico[0].content).toBe('[O cliente enviou uma imagem]');
    });

    it('falha da visao NAO encerra o turno: a IA responde do mesmo jeito', async () => {
        const r = await criar({ descricao: new Error('x') }).imagem({ mediaUrl: 'https://x/f.jpg' });
        expect(r.encerra).toBe(false);
    });
});

describe('documento', () => {
    it('acusa o recebimento e ENCERRA o turno', async () => {
        const r = await criar().documento();

        expect(r.encerra).toBe(true);
        expect(r.resposta).toBe(manipuladores.ACK_DOCUMENTO);
    });

    it('registra a pergunta e a resposta no histórico, para o consultor', async () => {
        const r = await criar().documento();
        expect(r.historico.map((h) => h.role)).toEqual(['user', 'assistant']);
        expect(r.historico[1].content).toBe(manipuladores.ACK_DOCUMENTO);
    });
});

describe('video', () => {
    it('a fala transcrita vira o texto do turno', async () => {
        const r = await criar({ transcricao: 'quero uma moto pra trabalhar' }).video({ mediaUrl: 'https://x/v.mp4' });

        expect(r.encerra).toBe(false);
        expect(r.texto).toBe('quero uma moto pra trabalhar');
        expect(r.historico[0].content).toContain('Fala no vídeo: quero uma moto pra trabalhar');
    });

    it('espera mais que o audio para baixar', async () => {
        const d = deps();
        await manipuladores.criar(d).video({ mediaUrl: 'https://x/v.mp4' });
        expect(d.baixador.baixar).toHaveBeenCalledWith('https://x/v.mp4', {
            timeoutMs: manipuladores.TIMEOUT_VIDEO_MS
        });
    });

    it('base64 embutido dispensa o download', async () => {
        const d = deps();
        await manipuladores.criar(d).video({ mediaBase64: Buffer.from('mp4').toString('base64') });
        expect(d.baixador.baixar).not.toHaveBeenCalled();
    });

    it('transcricao vazia ainda CONTINUA o turno, com texto generico', async () => {
        const r = await criar({ transcricao: '   ' }).video({ mediaUrl: 'https://x/v.mp4' });

        expect(r.encerra).toBe(false);
        expect(r.texto).toBe('Enviei um vídeo.');
        expect(r.historico[0].content).toBe('[O cliente enviou um vídeo]');
    });

    it('falha do download ou da transcricao tambem CONTINUA', async () => {
        for (const quebrado of [{ bytes: new Error('404') }, { transcricao: new Error('whisper fora') }]) {
            const r = await criar(quebrado).video({ mediaUrl: 'https://x/v.mp4' });
            expect(r.encerra).toBe(false);
            expect(r.texto).toBe('Enviei um vídeo.');
        }
    });
});

describe('audio', () => {
    it('a transcricao vira o texto do turno', async () => {
        const r = await criar({ transcricao: 'bom dia' }).audio({ mediaUrl: 'https://x/a.ogg' });

        expect(r.encerra).toBe(false);
        expect(r.texto).toBe('bom dia');
    });

    it('NAO registra nada no histórico: a fala entra pelo caminho normal do turno', async () => {
        const r = await criar().audio({ mediaUrl: 'https://x/a.ogg' });

        expect(r.historico).toEqual([]);
        expect(r.usuarioNoHistorico).toBe(false);
    });

    it('espera menos que o video para baixar', async () => {
        const d = deps();
        await manipuladores.criar(d).audio({ mediaUrl: 'https://x/a.ogg' });
        expect(d.baixador.baixar).toHaveBeenCalledWith('https://x/a.ogg', {
            timeoutMs: manipuladores.TIMEOUT_AUDIO_MS
        });
    });

    it('download que falha pede texto e ENCERRA', async () => {
        const r = await criar({ bytes: new Error('404') }).audio({ mediaUrl: 'https://x/a.ogg' });

        expect(r.encerra).toBe(true);
        expect(r.resposta).toBe(manipuladores.PEDIDO_DE_TEXTO_DOWNLOAD);
    });

    it('transcricao que falha pede texto com outra mensagem e ENCERRA', async () => {
        const r = await criar({ transcricao: new Error('whisper fora') }).audio({ mediaUrl: 'https://x/a.ogg' });

        expect(r.encerra).toBe(true);
        expect(r.resposta).toBe(manipuladores.PEDIDO_DE_TEXTO_TRANSCRICAO);
    });

    it('nenhum dos dois desfechos de falha registra histórico', async () => {
        const semBytes = await criar({ bytes: new Error('x') }).audio({ mediaUrl: 'u' });
        const semTexto = await criar({ transcricao: new Error('x') }).audio({ mediaUrl: 'u' });
        expect(semBytes.historico).toEqual([]);
        expect(semTexto.historico).toEqual([]);
    });
});

describe('CONGELA: a assimetria entre audio e video', () => {
    it('diante da MESMA falha, o video continua e o audio encerra', async () => {
        const quebrado = { transcricao: new Error('whisper fora do ar') };

        const doVideo = await criar(quebrado).video({ mediaUrl: 'https://x/v.mp4' });
        const doAudio = await criar(quebrado).audio({ mediaUrl: 'https://x/a.ogg' });

        expect(doVideo.encerra).toBe(false);
        expect(doAudio.encerra).toBe(true);
    });

    it('o video registra o envio no histórico mesmo sem entender; o audio nao', async () => {
        const quebrado = { transcricao: new Error('x') };
        expect((await criar(quebrado).video({ mediaUrl: 'u' })).historico).toHaveLength(1);
        expect((await criar(quebrado).audio({ mediaUrl: 'u' })).historico).toHaveLength(0);
    });
});
