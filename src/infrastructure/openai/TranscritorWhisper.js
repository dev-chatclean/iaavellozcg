// =============================================================
//  TRANSCRITOR — Whisper
//
//  Unica chamada a OpenAI que NAO passa pelo SDK: o endpoint de transcricao
//  espera multipart/form-data com o arquivo, e aqui isso e montado a mao. Por
//  isso a chave da API entra por injecao, em vez de vir do cliente do SDK.
//
//  Serve tanto para audio (ogg) quanto para o audio de um video (mp4) — o
//  Whisper aceita os dois, e quem chama informa o nome e o mimetype.
//
//  Nao trata erro: quem chama decide o que dizer ao cliente.
// =============================================================

const FormData = require('form-data');

const URL_TRANSCRICAO = 'https://api.openai.com/v1/audio/transcriptions';
const MODELO = 'whisper-1';

/**
 * @param {object} deps
 * @param {import('../../application/portas').ClienteHttp} deps.http
 * @param {string} deps.apiKey
 */
function criar({ http, apiKey }) {
    /**
     * @param {{buffer: Buffer, nomeArquivo: string, mimetype: string}} entrada
     * @returns {Promise<string>} o texto falado
     * @throws se a transcricao falhar
     */
    async function transcrever({ buffer, nomeArquivo, mimetype }) {
        const formData = new FormData();
        formData.append('file', buffer, { filename: nomeArquivo, contentType: mimetype });
        formData.append('model', MODELO);

        const resp = await http.post(URL_TRANSCRICAO, formData, {
            headers: { ...formData.getHeaders(), Authorization: `Bearer ${apiKey}` }
        });
        return resp.data.text;
    }

    return { transcrever };
}

module.exports = { criar, URL_TRANSCRICAO, MODELO };
