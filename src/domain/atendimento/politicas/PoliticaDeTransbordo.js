// =============================================================
//  POLITICA DE TRANSBORDO — RN-040, RN-041
//
//  Para onde o atendimento vai quando sai da IA.
//
//  A regra tem uma sutileza que se perde facil: quando a loja NAO foi
//  identificada, o destino e a propria fila de entrada — ou seja, NAO ha
//  transferencia, o ticket fica onde ja esta para a equipe direcionar. Isso e
//  caminho normal, nao falha de configuracao.
//
//  Modulo puro. O catalogo de departamentos entra por parametro, porque quem
//  sabe os IDs cadastrados no CRM e a infraestrutura, nao a regra.
// =============================================================

/**
 * @param {object} deps
 * @param {(lojaTexto: string) => string|null} deps.resolverLoja
 *   Traduz o texto da loja escolhida pelo cliente para o nome do departamento.
 * @param {string} deps.departamentoDeEntrada
 *   Fila onde o lead ja esta enquanto a IA atende.
 * @param {(departamento: string) => number|null} deps.idDoDepartamento
 * @param {string} deps.departamentoDePosVenda
 */
function criar({ resolverLoja, departamentoDeEntrada, idDoDepartamento, departamentoDePosVenda }) {
    /**
     * Destino de um lead novo: a loja que ele escolheu. Sem loja, permanece na
     * entrada.
     */
    function destinoDoLead(estado = {}) {
        return resolverLoja(estado.loja) || departamentoDeEntrada;
    }

    /**
     * Destino de um cliente ANTIGO pedindo pos-venda. A operacao pode nao ter
     * um departamento proprio de pos-venda: nesse caso ele volta para a unidade
     * onde comprou, e so entao para a entrada.
     */
    function destinoDePosVenda(estado = {}) {
        if (idDoDepartamento(departamentoDePosVenda)) return departamentoDePosVenda;
        return resolverLoja(estado.loja) || departamentoDeEntrada;
    }

    /**
     * Ha para onde transferir de fato? Falso quando o destino e a propria fila
     * de entrada sem ID cadastrado — o ticket ja esta la.
     */
    function haParaOndeTransferir(departamento) {
        return !!idDoDepartamento(departamento);
    }

    return { destinoDoLead, destinoDePosVenda, haParaOndeTransferir };
}

module.exports = { criar };
