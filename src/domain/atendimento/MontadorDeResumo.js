// =============================================================
//  MONTADOR DE RESUMO — o que o vendedor recebe no transbordo (RN-043)
//
//  Este texto é o produto final do bot: é por ele que o consultor humano
//  entende o lead sem reler a conversa. Extraído de index.js: montarResumo,
//  byte a byte — a caracterização em test/caracterizacao é o contrato.
//
//  ATENÇÃO (risco S2): o CPF vai INTEIRO no resumo, que é publicado como nota
//  no ticket e enviado por WhatsApp à equipe. O mascaramento é da spec 0016 —
//  mudar aqui alteraria o que a equipe recebe.
//
//  Depende de data.js (conteúdo de negócio, sem I/O).
// =============================================================

const { PERFIS } = require('../catalogo/Catalogo');
const { departamentoDaLoja } = require('./politicas/PoliticaDeTransbordo');

const NAO_INFORMADO = 'Não informado';

function nomeDoPerfil(perfilKey) {
    return perfilKey && PERFIS[perfilKey] ? PERFIS[perfilKey].nome : NAO_INFORMADO;
}

function temDadosDeSimulacao(campos) {
    return !!(
        campos.nomeCompleto ||
        campos.cpf ||
        campos.dataNascimento ||
        campos.telefone ||
        campos.cnh ||
        campos.corModelo
    );
}

/**
 * @param {object} campos  Estado do atendimento (leadData).
 * @param {string} chatId
 * @param {object} opcoes  { departamento, tagExtra, proximoExpediente }
 */
function montar(campos, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || departamentoDaLoja(campos.loja);

    return (
        `🏍️ LEAD QUALIFICADO — Avelloz Campina${opcoes.tagExtra ? ' [' + opcoes.tagExtra + ']' : ''}\n\n` +
        `Contato: ${campos.nome || 'Lead'} (${chatId})\n` +
        `Perfil: ${nomeDoPerfil(campos.perfilKey)}\n` +
        `Finalidade: ${campos.finalidade || NAO_INFORMADO}\n` +
        `Transporte hoje: ${campos.transporteAtual || NAO_INFORMADO}\n` +
        `Gasto atual: ${campos.gastoMensal || NAO_INFORMADO}\n` +
        `Situação de moto: ${campos.situacaoMoto || NAO_INFORMADO}\n` +
        `Modelo de interesse: ${campos.modeloInteresse || NAO_INFORMADO}\n` +
        `Forma de pagamento: ${campos.formaPagamento || NAO_INFORMADO}\n` +
        `Loja escolhida: ${campos.loja || 'Não informada'}\n` +
        (temDadosDeSimulacao(campos)
            ? `\nDados p/ simulação:\n` +
              `  Nome completo: ${campos.nomeCompleto || NAO_INFORMADO}\n` +
              `  CPF: ${campos.cpf || NAO_INFORMADO}\n` +
              `  Nascimento: ${campos.dataNascimento || NAO_INFORMADO}\n` +
              `  Telefone: ${campos.telefone || NAO_INFORMADO}\n` +
              `  CNH: ${campos.cnh || NAO_INFORMADO}\n` +
              `  Cor/modelo: ${campos.corModelo || NAO_INFORMADO}\n`
            : '') +
        (opcoes.proximoExpediente ? `Retorno sugerido: ${opcoes.proximoExpediente}\n` : '') +
        `\n➡️ Transferir para o departamento ${departamento}`
    );
}

/** Registro do lead para o histórico append-only. */
function paraRegistro(campos, chatId, departamento, dataIso) {
    return {
        chatId,
        nome: campos.nome || null,
        perfil: nomeDoPerfil(campos.perfilKey),
        finalidade: campos.finalidade || null,
        transporteAtual: campos.transporteAtual || null,
        gastoMensal: campos.gastoMensal || null,
        modeloInteresse: campos.modeloInteresse || null,
        formaPagamento: campos.formaPagamento || null,
        loja: campos.loja || null,
        departamento,
        data: dataIso
    };
}

module.exports = { montar, paraRegistro, nomeDoPerfil, temDadosDeSimulacao };
