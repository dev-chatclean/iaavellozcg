// =============================================================
//  RESULTADO DE MIDIA
//
//  O que fazer com o turno depois de interpretar o que o cliente mandou. Sao
//  duas saidas possiveis, e a diferenca entre elas nao era visivel no codigo
//  antigo — cada bloco de midia decidia sozinho, com um `return` solto no meio
//  de 400 linhas:
//
//    CONTINUAR — a midia virou texto; o turno segue e a IA responde.
//                (imagem, video, audio transcrito)
//
//    ENCERRAR  — o turno acaba aqui, opcionalmente com uma resposta pronta.
//                (documento; audio que nao deu para transcrever)
//
//  Objeto de valor: sem I/O, so o que aconteceu.
// =============================================================

/**
 * @typedef {object} ResultadoDeMidia
 * @property {boolean} encerra
 * @property {string} [texto]            texto que substitui a mensagem do turno
 * @property {Array<{role: string, content: string}>} historico  o que registrar
 * @property {string|null} [analiseImagem] descricao da imagem, quando houver
 * @property {boolean} [usuarioNoHistorico] a fala do cliente ja foi registrada
 * @property {string|null} [resposta]    texto a enviar antes de encerrar
 */

/**
 * O turno continua: a midia virou texto.
 * @returns {ResultadoDeMidia}
 */
function continuar({ texto, historico = [], analiseImagem = null, usuarioNoHistorico = false }) {
    return { encerra: false, texto, historico, analiseImagem, usuarioNoHistorico };
}

/**
 * O turno acaba aqui. A proxima mensagem do cliente retoma a qualificacao.
 * @returns {ResultadoDeMidia}
 */
function encerrar({ resposta = null, historico = [] } = {}) {
    return { encerra: true, resposta, historico };
}

module.exports = { continuar, encerrar };
