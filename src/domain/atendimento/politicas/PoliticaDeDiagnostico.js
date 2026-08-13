// =============================================================
//  POLÍTICA DE DIAGNÓSTICO — RN-001, a regra mais importante do produto
//
//  Enquanto o diagnóstico mínimo da realidade atual não estiver completo, o
//  bot NÃO revela preço, modelo, especificação nem condição de pagamento —
//  não importa como o cliente pergunte.
//
//  Por que existe: preço solto vira comparação com concorrente e o lead some.
//  A conta anual do que ele já gasta é o argumento que sustenta o preço.
//
//  Antes da SPEC 0006, esta regra vivia em DOIS lugares: no texto do
//  SYSTEM_SDR e numa expressão booleana solta dentro de promptResposta. Aqui
//  ela tem nome, um lugar só e teste próprio.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

// As três coisas que precisam estar respondidas antes de liberar produto.
const CAMPOS_DO_DIAGNOSTICO = Object.freeze(['transporteAtual', 'gastoMensal', 'situacaoMoto']);

/**
 * O diagnóstico mínimo está completo?
 * @param {import('../tipos').EstadoDoAtendimento} [campos]
 */
function completo(campos = {}) {
    return CAMPOS_DO_DIAGNOSTICO.every((campo) => !!campos[campo]);
}

/**
 * Pode revelar preço, modelo, especificação ou condição de pagamento?
 * @param {import('../tipos').EstadoDoAtendimento} [campos]
 */
function podeRevelarProduto(campos = {}) {
    return completo(campos);
}

/**
 * O que ainda falta perguntar. Útil para log e métrica.
 * @param {import('../tipos').EstadoDoAtendimento} [campos]
 */
function faltando(campos = {}) {
    return CAMPOS_DO_DIAGNOSTICO.filter((campo) => !campos[campo]);
}

module.exports = { CAMPOS_DO_DIAGNOSTICO, completo, podeRevelarProduto, faltando };
