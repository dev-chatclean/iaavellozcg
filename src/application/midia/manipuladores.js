// =============================================================
//  MANIPULADORES DE MIDIA (Strategy)
//
//  Um manipulador por tipo de midia. Antes eram quatro blocos `if (tipo ===
//  ...)` empilhados dentro do processarMensagem, e a unica forma de saber o
//  que cada um fazia com o turno era ler os 90 lines inteiros procurando
//  `return`.
//
//  Todos falham para o MESMO lado: se a midia nao pode ser interpretada, o
//  turno segue com um texto generico ou encerra com um pedido gentil. Nunca
//  lanca — o cliente do outro lado nao pode ficar sem resposta porque um
//  download deu timeout.
//
//  As assimetrias entre os tipos sao herdadas e estao marcadas onde aparecem.
// =============================================================

const ResultadoDeMidia = require('./ResultadoDeMidia');

const TIMEOUT_VIDEO_MS = 60000;
const TIMEOUT_AUDIO_MS = 30000;

const ACK_DOCUMENTO =
    'Recebi o arquivo! Vou deixar registrado pro nosso consultor analisar junto com você. Quer me adiantar do que se trata? \u{1F60A}';
const PEDIDO_DE_TEXTO_TRANSCRICAO =
    'Recebi seu áudio! Por aqui prefiro que a gente converse por texto pra eu anotar tudo certinho. Pode me escrever? \u{1F60A}';
const PEDIDO_DE_TEXTO_DOWNLOAD = 'Recebi seu áudio, mas não consegui abrir por aqui. Pode me escrever, por favor? \u{1F60A}';

/**
 * @param {object} deps
 * @param {{baixar: (url: string, o?: object) => Promise<Buffer>}} deps.baixador
 * @param {{transcrever: (e: object) => Promise<string>}} deps.transcritor
 * @param {(mediaUrl: string) => Promise<string|null>} deps.descreverImagem
 *   Ja encapsula a instrucao de visao e o tratamento de erro: devolve null
 *   quando nao foi possivel enxergar.
 */
function criar({ baixador, transcritor, descreverImagem }) {
    /** Bytes da midia: do base64 embutido ou baixando a URL. null se falhar. */
    async function obterBytes({ mediaBase64, mediaUrl }, { timeoutMs, rotulo }) {
        try {
            if (mediaBase64) return Buffer.from(mediaBase64, 'base64');
            if (mediaUrl) return await baixador.baixar(mediaUrl, { timeoutMs });
        } catch (e) {
            console.error(`\u{274C} Erro ao baixar ${rotulo}:`, e.message);
        }
        return null;
    }

    /**
     * Imagem: a IA ENXERGA (visao) e usa o conteudo na resposta.
     * O texto do turno e sempre o mesmo — o que muda e o histórico.
     */
    async function imagem({ mediaUrl }) {
        const descricao = await descreverImagem(mediaUrl);
        if (descricao) console.log(`\u{1F5BC}\u{FE0F} Visão: ${descricao}`);

        return ResultadoDeMidia.continuar({
            texto: 'Enviei uma imagem.',
            analiseImagem: descricao,
            usuarioNoHistorico: true,
            historico: [
                {
                    role: 'user',
                    content: descricao ? `[O cliente enviou uma imagem] — ${descricao}` : '[O cliente enviou uma imagem]'
                }
            ]
        });
    }

    /**
     * Documento (PDF/planilha): nao ha o que interpretar. Acusa o recebimento e
     * ENCERRA o turno — a proxima mensagem do cliente retoma a qualificacao.
     */
    async function documento() {
        return ResultadoDeMidia.encerrar({
            resposta: ACK_DOCUMENTO,
            historico: [
                { role: 'user', content: '[O cliente enviou um documento]' },
                { role: 'assistant', content: ACK_DOCUMENTO }
            ]
        });
    }

    /**
     * Video: transcreve o audio (o Whisper aceita mp4). Se nada for entendido,
     * o turno CONTINUA com um texto generico — diferente do audio, que pede
     * texto e encerra. Assimetria herdada.
     */
    async function video(entrada) {
        const bytes = await obterBytes(entrada, { timeoutMs: TIMEOUT_VIDEO_MS, rotulo: 'vídeo' });

        let fala = '';
        if (bytes) {
            try {
                const crua = await transcritor.transcrever({
                    buffer: bytes,
                    nomeArquivo: 'video.mp4',
                    mimetype: entrada.mediaMimetype || 'video/mp4'
                });
                fala = (crua || '').trim();
            } catch (e) {
                console.error('\u{274C} Erro ao transcrever vídeo:', e.message);
            }
        }

        if (fala) {
            console.log(`\u{1F3AC} Vídeo transcrito: "${fala}"`);
            return ResultadoDeMidia.continuar({
                texto: fala,
                usuarioNoHistorico: true,
                historico: [{ role: 'user', content: `[O cliente enviou um vídeo] Fala no vídeo: ${fala}` }]
            });
        }

        return ResultadoDeMidia.continuar({
            texto: 'Enviei um vídeo.',
            usuarioNoHistorico: true,
            historico: [{ role: 'user', content: '[O cliente enviou um vídeo]' }]
        });
    }

    /**
     * Audio e PTT: transcreve. Se falhar, pede texto e ENCERRA — sem registrar
     * nada no histórico, ao contrario do video. Assimetria herdada.
     */
    async function audio(entrada) {
        const bytes = await obterBytes(entrada, { timeoutMs: TIMEOUT_AUDIO_MS, rotulo: 'áudio' });
        if (!bytes) return ResultadoDeMidia.encerrar({ resposta: PEDIDO_DE_TEXTO_DOWNLOAD });

        try {
            const texto = await transcritor.transcrever({
                buffer: bytes,
                nomeArquivo: 'audio.ogg',
                mimetype: entrada.mediaMimetype || 'audio/ogg'
            });
            console.log(`\u{1F4DD} Transcrição: "${texto}"`);
            // NAO marca usuarioNoHistorico: a transcricao entra no histórico
            // pelo caminho normal do turno, como se o cliente tivesse digitado.
            return ResultadoDeMidia.continuar({ texto });
        } catch (e) {
            console.error('\u{274C} Erro ao transcrever áudio:', e.message);
            return ResultadoDeMidia.encerrar({ resposta: PEDIDO_DE_TEXTO_TRANSCRICAO });
        }
    }

    /** @type {Record<string, (entrada: object) => Promise<object>>} */
    const porTipo = { image: imagem, document: documento, video, audio, ptt: audio };

    /** Devolve o manipulador do tipo, ou null quando nao ha midia a tratar. */
    function para(tipo) {
        return porTipo[tipo] || null;
    }

    return { para, imagem, documento, video, audio };
}

module.exports = {
    criar,
    TIMEOUT_VIDEO_MS,
    TIMEOUT_AUDIO_MS,
    ACK_DOCUMENTO,
    PEDIDO_DE_TEXTO_TRANSCRICAO,
    PEDIDO_DE_TEXTO_DOWNLOAD
};
