import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const BaixadorHttp = require('../../src/infrastructure/midia/BaixadorHttp');
const TranscritorWhisper = require('../../src/infrastructure/openai/TranscritorWhisper');

// =============================================================
//  Baixador de midia e transcritor Whisper, isolados.
//
//  Os dois cobrem o caminho de audio e video, que antes era codigo duplicado
//  em dois lugares do index.js — cada um com seu proprio timeout e seu proprio
//  FormData montado a mao.
// =============================================================

function httpFake({ dados = Buffer.from('bytes-de-midia'), texto = 'oi tudo bem', erro = null } = {}) {
    const gets = [];
    const posts = [];
    return {
        gets,
        posts,
        get: vi.fn(async (url, config) => {
            gets.push({ url, config });
            if (erro) throw erro;
            return { status: 200, data: dados };
        }),
        post: vi.fn(async (url, corpo, config) => {
            posts.push({ url, corpo, config });
            if (erro) throw erro;
            return { status: 200, data: { text: texto } };
        })
    };
}

describe('BaixadorHttp', () => {
    it('devolve os bytes como Buffer', async () => {
        const http = httpFake({ dados: Buffer.from('conteudo') });
        const r = await BaixadorHttp.criar({ http }).baixar('https://x/audio.ogg');

        expect(Buffer.isBuffer(r)).toBe(true);
        expect(r.toString()).toBe('conteudo');
    });

    it('pede arraybuffer — sem isso o binario chegaria corrompido como texto', async () => {
        const http = httpFake();
        await BaixadorHttp.criar({ http }).baixar('https://x/a.ogg');

        expect(http.gets[0].config.responseType).toBe('arraybuffer');
    });

    it('o timeout entra por chamada: video espera mais que audio', async () => {
        const http = httpFake();
        const baixador = BaixadorHttp.criar({ http });

        await baixador.baixar('https://x/audio.ogg', { timeoutMs: 30000 });
        await baixador.baixar('https://x/video.mp4', { timeoutMs: 60000 });

        expect(http.gets.map((g) => g.config.timeout)).toEqual([30000, 60000]);
    });

    it('sem timeout explicito usa o padrao de 30s', async () => {
        const http = httpFake();
        await BaixadorHttp.criar({ http }).baixar('https://x/a.ogg');

        expect(http.gets[0].config.timeout).toBe(BaixadorHttp.TIMEOUT_PADRAO_MS);
    });

    it('falha do download LANCA — quem chama decide pedir texto ao cliente', async () => {
        const http = httpFake({ erro: new Error('404 not found') });
        await expect(BaixadorHttp.criar({ http }).baixar('https://x/sumiu.ogg')).rejects.toThrow('404 not found');
    });
});

describe('TranscritorWhisper', () => {
    const criar = (http) => TranscritorWhisper.criar({ http, apiKey: 'sk-teste' });
    const audio = { buffer: Buffer.from('ogg'), nomeArquivo: 'audio.ogg', mimetype: 'audio/ogg' };

    it('devolve o texto falado', async () => {
        const http = httpFake({ texto: 'quero uma moto pra trabalhar' });
        const r = await criar(http).transcrever(audio);

        expect(r).toBe('quero uma moto pra trabalhar');
    });

    it('posta no endpoint de transcricao com a chave no header', async () => {
        const http = httpFake();
        await criar(http).transcrever(audio);

        expect(http.posts[0].url).toBe(TranscritorWhisper.URL_TRANSCRICAO);
        expect(http.posts[0].config.headers.Authorization).toBe('Bearer sk-teste');
    });

    it('envia multipart com o modelo whisper-1', async () => {
        const http = httpFake();
        await criar(http).transcrever(audio);

        const form = http.posts[0].corpo;
        // form-data expoe o boundary pelos headers; o corpo e um stream.
        expect(http.posts[0].config.headers['content-type']).toMatch(/multipart\/form-data/);
        expect(form.getBuffer().toString()).toContain(TranscritorWhisper.MODELO);
    });

    it('o mesmo adapter serve audio e video — muda so nome e mimetype', async () => {
        const http = httpFake();
        const transcritor = criar(http);

        await transcritor.transcrever(audio);
        await transcritor.transcrever({ buffer: Buffer.from('mp4'), nomeArquivo: 'video.mp4', mimetype: 'video/mp4' });

        expect(http.posts).toHaveLength(2);
        expect(http.posts[0].corpo.getBuffer().toString()).toContain('audio.ogg');
        expect(http.posts[1].corpo.getBuffer().toString()).toContain('video.mp4');
    });

    it('falha da transcricao LANCA', async () => {
        const http = httpFake({ erro: new Error('whisper indisponivel') });
        await expect(criar(http).transcrever(audio)).rejects.toThrow('whisper indisponivel');
    });
});
