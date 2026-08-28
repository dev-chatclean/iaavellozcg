// =============================================================
//  POLITICA DE DIAGNOSTICO — RN-001
//
//  A regra comercial mais importante do sistema: o bot NAO revela preco,
//  modelo, especificacao nem condicao de pagamento antes de entender a
//  realidade de transporte do cliente.
//
//  Nao e capricho de roteiro. O metodo de venda depende disso: quem ouve o
//  preco antes de fazer a conta do que ja gasta hoje compara a moto com zero,
//  e ela fica cara. Quem faz a conta primeiro compara com o que ja perde por
//  mes, e ela fica barata.
//
//  Antes esta regra existia como uma expressao solta dentro de um template de
//  prompt. Nao tinha nome, nao tinha teste proprio, e acrescentar um quarto
//  campo ao diagnostico nao a atualizaria.
//
//  Modulo puro: sem I/O, sem ambiente.
// =============================================================

/**
 * Os campos que compoem o diagnostico minimo. A ordem e a de coleta.
 * Acrescentar um campo aqui muda a regra em TODOS os lugares que a consultam.
 */
const CAMPOS_DO_DIAGNOSTICO = Object.freeze(['transporteAtual', 'gastoMensal', 'situacaoMoto']);

/**
 * O diagnostico minimo esta completo?
 * @param {object} [campos] estado do atendimento
 * @returns {boolean}
 */
function completo(campos = {}) {
    return CAMPOS_DO_DIAGNOSTICO.every((campo) => !!campos[campo]);
}

/**
 * O bot pode falar de produto — preco, modelo, especificacao, condicao?
 * Hoje e o mesmo que ter o diagnostico completo, mas o nome existe porque a
 * PERGUNTA e outra: quem chama quer saber se pode revelar, nao se coletou.
 *
 * @param {object} [campos] estado do atendimento
 * @returns {boolean}
 */
function podeRevelarProduto(campos = {}) {
    return completo(campos);
}

/**
 * O que ainda falta coletar, na ordem. Vazio quando o diagnostico fechou.
 * @param {object} [campos]
 * @returns {string[]}
 */
function faltando(campos = {}) {
    return CAMPOS_DO_DIAGNOSTICO.filter((campo) => !campos[campo]);
}

module.exports = { CAMPOS_DO_DIAGNOSTICO, completo, podeRevelarProduto, faltando };
