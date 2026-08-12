// =============================================================
//  POLÍTICA DE TRANSBORDO — quando e para onde entregar ao humano
//
//  RN-040: nenhum transbordo por qualificação acontece sem a loja escolhida.
//  RN-041: a loja define o departamento; sem loja, cai no Comercial.
//  RN-042: pedido explícito de humano transfere na hora, funil incompleto ou não.
//
//  Antes da SPEC 0006 estas decisões eram `if`s soltos no meio do
//  processarMensagem, com strings de departamento no próprio fluxo.
//
//  Depende de data.js (conteúdo de negócio, sem I/O) — que vira
//  domain/catalogo na fatia do catálogo.
// =============================================================

const { DEPARTAMENTOS, lojaParaDepartamento } = require('../../catalogo/Catalogo');

const MOTIVOS = Object.freeze({
    QUALIFICACAO_COMPLETA: 'qualificacao-completa',
    PEDIDO_DO_CLIENTE: 'pedido-do-cliente',
    CLIENTE_ATUAL: 'cliente-atual'
});

/**
 * Departamento de destino a partir da loja escolhida (RN-041).
 * Sem loja identificada, Comercial.
 */
function departamentoDaLoja(loja) {
    return lojaParaDepartamento(loja) || DEPARTAMENTOS.geral;
}

/**
 * Há motivo para transbordar AGORA, antes do fluxo normal?
 * Avalia os sinais da extração, na ordem de precedência do legado:
 * cliente atual primeiro, depois pedido explícito de humano.
 * @returns {{motivo: string, departamento: string}|null}
 */
function transbordoImediato(extracao, campos = {}) {
    if (!extracao) return null;

    if (extracao.tipoContato === 'cliente') {
        return { motivo: MOTIVOS.CLIENTE_ATUAL, departamento: DEPARTAMENTOS.posvenda };
    }
    if (extracao.querFalarComHumano) {
        return { motivo: MOTIVOS.PEDIDO_DO_CLIENTE, departamento: departamentoDaLoja(campos.loja) };
    }
    return null;
}

/**
 * Etiqueta e retorno sugerido do resumo, conforme o expediente (RN-061).
 * Dentro do expediente, nenhum dos dois.
 */
function marcacaoDeExpediente(expediente, { etiquetaForaDeExpediente } = {}) {
    if (!expediente || expediente.aberto) {
        return { tagExtra: undefined, proximoExpediente: null };
    }
    return {
        tagExtra: etiquetaForaDeExpediente || 'FORA DE EXPEDIENTE',
        proximoExpediente: expediente.proximoExpediente
    };
}

module.exports = { MOTIVOS, departamentoDaLoja, transbordoImediato, marcacaoDeExpediente, DEPARTAMENTOS };
