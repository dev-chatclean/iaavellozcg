// =============================================================
//  RESULTADO DE MÍDIA (SPEC 0005)
//
//  O que um manipulador devolve ao turno. Antes, cada tipo de mídia mexia
//  direto nas variáveis do processarMensagem (`texto`, `usuarioNoHistorico`,
//  `leadData.analiseImagem`) e alguns davam `return` no meio da função — o
//  que tornava impossível saber, olhando um bloco, se o turno seguia ou não.
//
//  Agora cada manipulador DESCREVE o que aconteceu, e quem orquestra decide.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

/**
 * @param {object} campos
 * @param {string} campos.texto                    Texto que representa o turno daqui em diante.
 * @param {Array<{role: string, content: string}>} [campos.entradasNoHistorico]
 *   O que registrar no histórico antes de processar. Quando vazio, o turno
 *   registra o texto do cliente normalmente.
 * @param {string|null} [campos.analiseImagem]     Sinal transitório da visão.
 * @param {boolean} [campos.encerrarTurno]         Se true, o turno para aqui.
 * @param {string|null} [campos.mensagemAoCliente] Resposta imediata, antes de encerrar.
 * @param {boolean} [campos.registrarRespostaNoHistorico]
 */
function criar({
    texto,
    entradasNoHistorico = [],
    analiseImagem = null,
    encerrarTurno = false,
    mensagemAoCliente = null,
    registrarRespostaNoHistorico = false
}) {
    return Object.freeze({
        texto,
        entradasNoHistorico,
        analiseImagem,
        encerrarTurno,
        mensagemAoCliente,
        registrarRespostaNoHistorico,
        // O turno já registrou a fala do cliente? Se sim, não empurra de novo.
        clienteJaNoHistorico: entradasNoHistorico.some((e) => e.role === 'user')
    });
}

/** Nada a fazer: o texto segue como veio. */
function semTratamento(texto) {
    return criar({ texto });
}

module.exports = { criar, semTratamento };
