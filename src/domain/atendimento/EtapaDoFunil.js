// =============================================================
//  ETAPA DO FUNIL — a ordem oficial da qualificação (RN-002)
//
//  O diagnóstico da realidade atual vem ANTES de liberar modelo e preço.
//  A ordem é um GUIA: se o cliente perguntou algo, responder vem primeiro; a
//  etapa é puxada depois. A ordem forte está no SYSTEM_SDR.
//
//  Extraído de flow.js na SPEC 0006. Diferença estrutural importante:
//  `proxima()` é PURA — apenas consulta. O legado mutava o lead ao consultar
//  (D-06); a fachada em flow.js preserva esse efeito por enquanto, e a
//  correção vem numa spec própria, para não mudar comportamento aqui.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

const ETAPAS = Object.freeze([
    Object.freeze({
        campo: 'finalidade',
        instrucao:
            'Pergunte pra que ele quer a moto (trabalhar, economizar, passear, pra esposa) e se já viu algum modelo nosso (passo 2 — interesse).'
    }),
    Object.freeze({
        campo: 'transporteAtual',
        instrucao:
            'Pergunte como ele se locomove HOJE: carro, Uber, ônibus, carona ou moto alugada (passo 3 — diagnóstico). Uma coisa de cada vez.'
    }),
    Object.freeze({
        campo: 'gastoMensal',
        instrucao:
            'Pergunte quanto ele gasta por mês nesse transporte (faça ele dizer o número em reais) e o quanto de tempo perde esperando/no trânsito.'
    }),
    Object.freeze({
        campo: 'situacaoMoto',
        instrucao:
            'Descubra se ele já tem moto e a situação (própria, alugada, velha, manutenção cara). Se roda de app, pergunte quanto paga de aluguel por semana/mês.'
    }),
    Object.freeze({
        campo: 'modeloInteresse',
        instrucao:
            'Diagnóstico feito: mostre a conta (o gasto dele projetado no ano) e recomende o modelo que encaixa (AZ1 economia, AZ125 equilíbrio, AZX160 potência). Confirme qual interessou.'
    }),
    Object.freeze({
        campo: 'formaPagamento',
        instrucao:
            'Pergunte qual forma de pagamento faz mais sentido: cartão (até 21x), financiamento (entrada zero em até 48x dependendo do CPF), consórcio ou à vista.'
    }),
    Object.freeze({
        campo: 'loja',
        instrucao:
            'Pergunte qual unidade fica melhor pra ele: Matriz, Malvinas (Campina Grande) ou Monteiro. Identificar a loja é OBRIGATÓRIO antes de transferir.'
    })
]);

const CAMPOS = Object.freeze(ETAPAS.map((e) => e.campo));

/**
 * Próxima etapa: a primeira cujo campo ainda está vazio.
 * @param {import('./tipos').EstadoDoAtendimento} [campos]
 * @returns {{campo: string, instrucao: string}|null} null quando o funil fechou.
 */
function proxima(campos = {}) {
    return ETAPAS.find((e) => !campos[e.campo]) || null;
}

/**
 * O funil está completo? Consulta pura, sem efeito colateral.
 * @param {import('./tipos').EstadoDoAtendimento} [campos]
 */
function completo(campos = {}) {
    return proxima(campos) === null;
}

module.exports = { ETAPAS, CAMPOS, proxima, completo };
