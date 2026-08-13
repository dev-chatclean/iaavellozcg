// =============================================================
//  MANIPULADORES DE MÍDIA — Strategy (SPEC 0005)
//
//  Um manipulador por tipo de mídia. Antes eram quatro blocos `if` dentro do
//  processarMensagem, misturando "que mídia é" com "o que fazer com ela" —
//  acrescentar um tipo novo exigia editar a função de 290 linhas.
//
//  Agora: tipo novo = entrada nova no mapa. Nenhum `if` existente é tocado (OCP).
//
//  Estas funções não conhecem adapters: recebem as portas por parâmetro. As
//  mensagens ao cliente e as linhas de log são as MESMAS do legado, byte a
//  byte — a linha de base é o contrato.
// =============================================================

const Resultado = require('./ResultadoDeMidia');

const AVISO_AUDIO_SEM_TRANSCRICAO =
    'Recebi seu áudio! Por aqui prefiro que a gente converse por texto pra eu anotar tudo certinho. Pode me escrever? 😊';
const AVISO_AUDIO_NAO_ABRIU = 'Recebi seu áudio, mas não consegui abrir por aqui. Pode me escrever, por favor? 😊';
const ACUSE_DOCUMENTO =
    'Recebi o arquivo! Vou deixar registrado pro nosso consultor analisar junto com você. Quer me adiantar do que se trata? 😊';

// Obtém o conteúdo binário: base64 embutido no payload ou download da URL.
// Devolve null quando não foi possível — o chamador decide o que fazer.
async function obterConteudo({ mediaBase64, mediaUrl }, deps, timeoutMs, rotuloDoErro) {
    try {
        if (mediaBase64) return Buffer.from(mediaBase64, 'base64');
        // O `await` é obrigatório: sem ele, a promise rejeitada escapa deste
        // try/catch e o erro sobe para o turno, em vez de virar "não consegui
        // abrir". O teste dourado pegou exatamente isso.
        if (mediaUrl) return await deps.baixadorDeMidia.baixar(mediaUrl, timeoutMs);
    } catch (e) {
        console.error(`❌ Erro ao baixar ${rotuloDoErro}:`, e.message);
    }
    return null;
}

// -------------------------------------------------------------
//  Texto: nada a tratar.
// -------------------------------------------------------------
async function texto(mensagem) {
    return Resultado.semTratamento(mensagem.texto);
}

// -------------------------------------------------------------
//  Imagem: a IA enxerga e usa a descrição na resposta (RN-028).
// -------------------------------------------------------------
async function imagem(mensagem, deps) {
    const descricao = await deps.leitorDeImagem.descrever(mensagem.mediaUrl);
    if (descricao) {
        console.log(`🖼️ Visão: ${descricao}`);
        return Resultado.criar({
            texto: 'Enviei uma imagem.',
            analiseImagem: descricao,
            entradasNoHistorico: [{ role: 'user', content: `[O cliente enviou uma imagem] — ${descricao}` }]
        });
    }
    return Resultado.criar({
        texto: 'Enviei uma imagem.',
        entradasNoHistorico: [{ role: 'user', content: '[O cliente enviou uma imagem]' }]
    });
}

// -------------------------------------------------------------
//  Documento: acusa o recebimento e ENCERRA o turno. A próxima mensagem do
//  cliente retoma a qualificação normalmente.
// -------------------------------------------------------------
async function documento(mensagem) {
    return Resultado.criar({
        texto: mensagem.texto,
        mensagemAoCliente: ACUSE_DOCUMENTO,
        entradasNoHistorico: [{ role: 'user', content: '[O cliente enviou um documento]' }],
        registrarRespostaNoHistorico: true,
        encerrarTurno: true
    });
}

// -------------------------------------------------------------
//  Vídeo: transcreve a fala (o Whisper aceita mp4). Sem fala reconhecida,
//  registra apenas que houve um vídeo.
// -------------------------------------------------------------
async function video(mensagem, deps) {
    const conteudo = await obterConteudo(mensagem, deps, 60000, 'vídeo');

    let fala = '';
    if (conteudo) {
        try {
            fala = await deps.transcritor.transcrever({
                buffer: conteudo,
                nome: 'video.mp4',
                mimetype: mensagem.mediaMimetype || 'video/mp4'
            });
        } catch (e) {
            console.error('❌ Erro ao transcrever vídeo:', e.message);
        }
    }

    if (fala) {
        console.log(`🎬 Vídeo transcrito: "${fala}"`);
        return Resultado.criar({
            texto: fala,
            entradasNoHistorico: [{ role: 'user', content: `[O cliente enviou um vídeo] Fala no vídeo: ${fala}` }]
        });
    }
    return Resultado.criar({
        texto: 'Enviei um vídeo.',
        entradasNoHistorico: [{ role: 'user', content: '[O cliente enviou um vídeo]' }]
    });
}

// -------------------------------------------------------------
//  Áudio: a transcrição VIRA o texto do turno. Se falhar, pede texto e
//  encerra — sem registrar nada no histórico, como no legado.
// -------------------------------------------------------------
async function audio(mensagem, deps) {
    const conteudo = await obterConteudo(mensagem, deps, 30000, 'áudio');

    if (!conteudo) {
        return Resultado.criar({
            texto: mensagem.texto,
            mensagemAoCliente: AVISO_AUDIO_NAO_ABRIU,
            encerrarTurno: true
        });
    }

    try {
        const transcrito = await deps.transcritor.transcrever({
            buffer: conteudo,
            nome: 'audio.ogg',
            mimetype: mensagem.mediaMimetype || 'audio/ogg'
        });
        console.log(`📝 Transcrição: "${transcrito}"`);
        return Resultado.criar({ texto: transcrito });
    } catch (e) {
        console.error('❌ Erro ao transcrever áudio:', e.message);
        return Resultado.criar({
            texto: mensagem.texto,
            mensagemAoCliente: AVISO_AUDIO_SEM_TRANSCRICAO,
            encerrarTurno: true
        });
    }
}

// Tipo novo entra aqui — nenhum manipulador existente é tocado.
const MANIPULADORES = Object.freeze({
    text: texto,
    image: imagem,
    document: documento,
    video,
    audio,
    ptt: audio // mensagem de voz do WhatsApp: mesmo tratamento
});

/**
 * Trata a mídia da mensagem e descreve o que o turno deve fazer.
 *
 * Recebe só a parte da mensagem que interessa ao tratamento de mídia — nem
 * chatId, nem contactId, nem msgId. Um manipulador não precisa saber de quem
 * é a mensagem para transcrever um áudio.
 *
 * @param {{tipo?: string, texto?: string, mediaBase64?: string|null, mediaUrl?: string|null, mediaMimetype?: string|null}} mensagem
 * @param {import('../portas').Dependencias} deps
 */
async function tratar(mensagem, deps) {
    const manipulador = MANIPULADORES[mensagem.tipo] || texto;
    return manipulador(mensagem, deps);
}

function tipoSuportado(tipo) {
    return Object.prototype.hasOwnProperty.call(MANIPULADORES, tipo);
}

module.exports = {
    tratar,
    tipoSuportado,
    MANIPULADORES,
    AVISO_AUDIO_SEM_TRANSCRICAO,
    AVISO_AUDIO_NAO_ABRIU,
    ACUSE_DOCUMENTO
};
