// =============================================================
//  TRANSCRITOR — Whisper (SPEC 0004, resolve D-26)
//
//  Implementa a porta TranscritorDeAudio.
//
//  O legado montava o multipart na mão com axios + form-data e colava o
//  Authorization manualmente, enquanto todo o resto usava o SDK — dois
//  caminhos de autenticação e dois de tratamento de erro para o mesmo
//  fornecedor. Agora usa o SDK, enviando a MESMA requisição para o MESMO
//  endpoint (POST /v1/audio/transcriptions, modelo whisper-1).
//
//  Lança em caso de falha, como antes: quem chama decide o que dizer ao
//  cliente (pedir texto, avisar que não abriu o áudio).
// =============================================================

const { toFile } = require('openai');

const MODELO = 'whisper-1';

function criar({ cliente }) {
    return {
        async transcrever({ buffer, nome, mimetype }) {
            const arquivo = await toFile(buffer, nome, { type: mimetype });
            const resultado = await cliente.audio.transcriptions.create({ file: arquivo, model: MODELO });
            return (resultado.text || '').trim();
        }
    };
}

module.exports = { criar };
