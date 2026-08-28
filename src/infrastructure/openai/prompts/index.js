// =============================================================
//  PROMPTS — seletor de versao
//
//  Quem consome prompts pede a este modulo, nunca a um arquivo de versao
//  direto. Assim, trocar a versao em producao e mudar UMA linha aqui, e a
//  versao antiga continua no repositorio para comparacao.
//
//  Prompt e comportamento: a troca so acontece depois de a suite de evals
//  comparar as duas versoes nos mesmos roteiros.
// =============================================================

const v1 = require('./v1');

/** Versao em producao. */
const ATUAL = 'v1';

const VERSOES = { v1 };

/**
 * @param {string} [versao]
 * @returns {typeof v1}
 */
function carregar(versao = ATUAL) {
    const escolhida = VERSOES[versao];
    if (!escolhida) throw new Error(`Versao de prompt desconhecida: ${versao}`);
    return escolhida;
}

module.exports = { ...v1, carregar, ATUAL, VERSOES };
