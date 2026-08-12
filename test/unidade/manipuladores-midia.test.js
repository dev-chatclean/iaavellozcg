import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const manipuladores = require('../../src/application/midia/manipuladores');

// =============================================================
//  SPEC 0005 — manipuladores de midia (Strategy)
//
//  Antes eram quatro blocos `if` dentro de processarMensagem, so alcancaveis
//  pelo teste dourado (que precisa montar o sistema inteiro). Agora cada tipo
//  e uma funcao pura em relacao as portas: da para testar o tratamento de
//  midia sem servidor, sem estado e sem fila.
// =============================================================

function criarDeps({ descricao = 'uma moto vermelha', transcricao = 'texto falado', falhas = {} } = {}) {
    return {
        chamadas: [],
        leitorDeImagem: {
            async descrever(url) {
                if (falhas.visao) return null;
                return url ? descricao : null;
            }
        },
        transcritor: {
            async transcrever() {
                if (falhas.transcricao) throw new Error('whisper fora do ar');
                return transcricao;
            }
        },
        baixadorDeMidia: {
            async baixar(url, timeout) {
                if (falhas.download) throw new Error('midia indisponivel');
                return Buffer.from(`conteudo de ${url} (timeout ${timeout})`);
            }
        }
    };
}

const mensagem = (over = {}) => ({
    tipo: 'text',
    texto: 'oi',
    mediaBase64: null,
    mediaUrl: null,
    mediaMimetype: null,
    ...over
});

describe('resolucao do manipulador', () => {
    it('reconhece os seis tipos tratados', () => {
        for (const tipo of ['text', 'image', 'document', 'video', 'audio', 'ptt']) {
            expect(manipuladores.tipoSuportado(tipo)).toBe(true);
        }
    });

    it('nao reconhece tipos sem tratamento proprio', () => {
        expect(manipuladores.tipoSuportado('sticker')).toBe(false);
        expect(manipuladores.tipoSuportado('location')).toBe(false);
    });

    it('tipo desconhecido cai no tratamento de texto, sem quebrar', async () => {
        const r = await manipuladores.tratar(mensagem({ tipo: 'sticker', texto: 'oi' }), criarDeps());
        expect(r.texto).toBe('oi');
        expect(r.encerrarTurno).toBe(false);
    });
});

describe('texto', () => {
    it('passa adiante sem tocar em nada', async () => {
        const r = await manipuladores.tratar(mensagem({ texto: 'quero uma moto' }), criarDeps());
        expect(r.texto).toBe('quero uma moto');
        expect(r.entradasNoHistorico).toEqual([]);
        expect(r.clienteJaNoHistorico).toBe(false);
        expect(r.analiseImagem).toBeNull();
    });
});

describe('imagem (RN-028)', () => {
    it('registra a descricao da visao no historico e no sinal transitorio', async () => {
        const deps = criarDeps({ descricao: 'Foto de uma AZ125 vermelha' });
        const r = await manipuladores.tratar(mensagem({ tipo: 'image', mediaUrl: 'https://x/foto.jpg' }), deps);

        expect(r.texto).toBe('Enviei uma imagem.');
        expect(r.analiseImagem).toBe('Foto de uma AZ125 vermelha');
        expect(r.entradasNoHistorico).toEqual([
            { role: 'user', content: '[O cliente enviou uma imagem] — Foto de uma AZ125 vermelha' }
        ]);
        expect(r.clienteJaNoHistorico).toBe(true);
        expect(r.encerrarTurno).toBe(false);
    });

    it('visao indisponivel: registra a imagem sem descricao e segue o turno', async () => {
        const deps = criarDeps({ falhas: { visao: true } });
        const r = await manipuladores.tratar(mensagem({ tipo: 'image', mediaUrl: 'https://x/foto.jpg' }), deps);

        expect(r.analiseImagem).toBeNull();
        expect(r.entradasNoHistorico).toEqual([{ role: 'user', content: '[O cliente enviou uma imagem]' }]);
        expect(r.encerrarTurno).toBe(false);
    });
});

describe('documento', () => {
    it('acusa o recebimento e encerra o turno', async () => {
        const r = await manipuladores.tratar(mensagem({ tipo: 'document' }), criarDeps());

        expect(r.encerrarTurno).toBe(true);
        expect(r.mensagemAoCliente).toBe(manipuladores.ACUSE_DOCUMENTO);
        expect(r.registrarRespostaNoHistorico).toBe(true);
        expect(r.entradasNoHistorico).toEqual([{ role: 'user', content: '[O cliente enviou um documento]' }]);
    });

    it('nao chama nenhuma porta', async () => {
        const deps = criarDeps();
        const espiao = vi.spyOn(deps.leitorDeImagem, 'descrever');
        await manipuladores.tratar(mensagem({ tipo: 'document' }), deps);
        expect(espiao).not.toHaveBeenCalled();
    });
});

describe('video', () => {
    it('a fala transcrita vira o texto do turno', async () => {
        const deps = criarDeps({ transcricao: 'quero uma moto pra trabalhar' });
        const r = await manipuladores.tratar(mensagem({ tipo: 'video', mediaUrl: 'https://x/v.mp4' }), deps);

        expect(r.texto).toBe('quero uma moto pra trabalhar');
        expect(r.entradasNoHistorico[0].content).toContain('Fala no vídeo: quero uma moto pra trabalhar');
        expect(r.encerrarTurno).toBe(false);
    });

    it('sem fala reconhecida, registra apenas que houve um video', async () => {
        const deps = criarDeps({ falhas: { transcricao: true } });
        const r = await manipuladores.tratar(mensagem({ tipo: 'video', mediaUrl: 'https://x/v.mp4' }), deps);

        expect(r.texto).toBe('Enviei um vídeo.');
        expect(r.entradasNoHistorico).toEqual([{ role: 'user', content: '[O cliente enviou um vídeo]' }]);
        expect(r.encerrarTurno).toBe(false);
    });

    it('falha no download nao encerra o turno (diferente do audio)', async () => {
        const deps = criarDeps({ falhas: { download: true } });
        const r = await manipuladores.tratar(mensagem({ tipo: 'video', mediaUrl: 'https://x/v.mp4' }), deps);

        expect(r.encerrarTurno).toBe(false);
        expect(r.texto).toBe('Enviei um vídeo.');
    });

    it('usa o mimetype informado, com padrao mp4', async () => {
        const deps = criarDeps();
        let recebido = null;
        deps.transcritor.transcrever = async (a) => {
            recebido = a;
            return 'fala';
        };
        await manipuladores.tratar(mensagem({ tipo: 'video', mediaUrl: 'https://x/v.mp4' }), deps);
        expect(recebido.nome).toBe('video.mp4');
        expect(recebido.mimetype).toBe('video/mp4');
    });
});

describe('audio e ptt', () => {
    it('a transcricao vira o texto do turno, sem entrada propria no historico', async () => {
        const deps = criarDeps({ transcricao: 'quanto custa a AZ1?' });
        const r = await manipuladores.tratar(mensagem({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' }), deps);

        expect(r.texto).toBe('quanto custa a AZ1?');
        // O turno registra o texto do cliente normalmente — por isso nao ha
        // entrada aqui e clienteJaNoHistorico e falso.
        expect(r.entradasNoHistorico).toEqual([]);
        expect(r.clienteJaNoHistorico).toBe(false);
        expect(r.encerrarTurno).toBe(false);
    });

    it('ptt recebe o mesmo tratamento de audio', async () => {
        const deps = criarDeps({ transcricao: 'mensagem de voz' });
        const r = await manipuladores.tratar(mensagem({ tipo: 'ptt', mediaUrl: 'https://x/a.ogg' }), deps);
        expect(r.texto).toBe('mensagem de voz');
    });

    it('falha na transcricao: pede texto e ENCERRA o turno', async () => {
        const deps = criarDeps({ falhas: { transcricao: true } });
        const r = await manipuladores.tratar(mensagem({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' }), deps);

        expect(r.encerrarTurno).toBe(true);
        expect(r.mensagemAoCliente).toBe(manipuladores.AVISO_AUDIO_SEM_TRANSCRICAO);
        expect(r.registrarRespostaNoHistorico).toBe(false);
        expect(r.entradasNoHistorico).toEqual([]);
    });

    it('falha no download: avisa que nao abriu e ENCERRA o turno', async () => {
        const deps = criarDeps({ falhas: { download: true } });
        const r = await manipuladores.tratar(mensagem({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' }), deps);

        expect(r.encerrarTurno).toBe(true);
        expect(r.mensagemAoCliente).toBe(manipuladores.AVISO_AUDIO_NAO_ABRIU);
    });

    it('sem base64 e sem url: avisa que nao abriu', async () => {
        const r = await manipuladores.tratar(mensagem({ tipo: 'audio' }), criarDeps());
        expect(r.encerrarTurno).toBe(true);
        expect(r.mensagemAoCliente).toBe(manipuladores.AVISO_AUDIO_NAO_ABRIU);
    });

    it('base64 dispensa o download', async () => {
        const deps = criarDeps({ transcricao: 'do base64' });
        let baixou = false;
        deps.baixadorDeMidia.baixar = async () => {
            baixou = true;
            return Buffer.from('x');
        };
        const r = await manipuladores.tratar(
            mensagem({ tipo: 'audio', mediaBase64: Buffer.from('audio').toString('base64') }),
            deps
        );
        expect(baixou).toBe(false);
        expect(r.texto).toBe('do base64');
    });

    it('usa o mimetype informado, com padrao ogg', async () => {
        const deps = criarDeps();
        let recebido = null;
        deps.transcritor.transcrever = async (a) => {
            recebido = a;
            return 'ok';
        };
        await manipuladores.tratar(
            mensagem({ tipo: 'audio', mediaUrl: 'https://x/a.ogg', mediaMimetype: 'audio/mpeg' }),
            deps
        );
        expect(recebido.nome).toBe('audio.ogg');
        expect(recebido.mimetype).toBe('audio/mpeg');
    });
});

describe('timeouts herdados do legado', () => {
    let recebidos;
    let deps;

    beforeEach(() => {
        recebidos = [];
        deps = criarDeps();
        deps.baixadorDeMidia.baixar = async (url, timeout) => {
            recebidos.push(timeout);
            return Buffer.from('x');
        };
    });

    it('video usa 60s e audio usa 30s', async () => {
        await manipuladores.tratar(mensagem({ tipo: 'video', mediaUrl: 'https://x/v.mp4' }), deps);
        await manipuladores.tratar(mensagem({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' }), deps);
        expect(recebidos).toEqual([60000, 30000]);
    });
});

describe('resultado e imutavel', () => {
    it('nao permite alteracao acidental', async () => {
        const r = await manipuladores.tratar(mensagem(), criarDeps());
        expect(Object.isFrozen(r)).toBe(true);
    });
});
