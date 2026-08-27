// =============================================================
//  MONTADOR DE RESUMO — RN-043
//
//  O texto que o vendedor le quando o lead chega ate ele. E o unico artefato
//  do atendimento que um humano consome inteiro, entao a ordem dos campos e a
//  redacao da ultima linha importam mais do que parecem: e o que decide se o
//  consultor entende o caso em cinco segundos ou reabre a conversa do zero.
//
//  Modulo puro. Catalogo de perfis e IDs de departamento entram por parametro.
// =============================================================

const CABECALHO = '\u{1F3CD}\u{FE0F} LEAD QUALIFICADO — Avelloz Campina';
const SETA = '\u{27A1}\u{FE0F}';
const NAO_INFORMADO = 'Não informado';

/** Campos do diagnostico e das escolhas, na ordem em que o vendedor le. */
const LINHAS_DO_DIAGNOSTICO = Object.freeze([
    ['Finalidade', 'finalidade'],
    ['Transporte hoje', 'transporteAtual'],
    ['Gasto atual', 'gastoMensal'],
    ['Situação de moto', 'situacaoMoto'],
    ['Modelo de interesse', 'modeloInteresse'],
    ['Forma de pagamento', 'formaPagamento']
]);

/** Dados coletados em bloco para a simulacao. So aparecem se houver algum. */
const LINHAS_DE_SIMULACAO = Object.freeze([
    ['Nome completo', 'nomeCompleto'],
    ['CPF', 'cpf'],
    ['Nascimento', 'dataNascimento'],
    ['Telefone', 'telefone'],
    ['CNH', 'cnh'],
    ['Cor/modelo', 'corModelo']
]);

/**
 * @param {object} deps
 * @param {(estado: object) => string} deps.nomeDoPerfil
 * @param {(departamento: string) => number|null} deps.idDoDepartamento
 * @param {(estado: object) => string} deps.destinoPadrao
 *   Departamento quando o chamador nao informa um explicitamente.
 */
function criar({ nomeDoPerfil, idDoDepartamento, destinoPadrao }) {
    /**
     * @param {object} estado estado do atendimento
     * @param {string} chatId
     * @param {{departamento?: string, tagExtra?: string, proximoExpediente?: string}} [opcoes]
     * @returns {string}
     */
    function montar(estado, chatId, opcoes = {}) {
        const departamento = opcoes.departamento || destinoPadrao(estado);
        const temDadosDeSimulacao = LINHAS_DE_SIMULACAO.some(([, campo]) => estado[campo]);

        const diagnostico = LINHAS_DO_DIAGNOSTICO.map(
            ([rotulo, campo]) => `${rotulo}: ${estado[campo] || NAO_INFORMADO}\n`
        ).join('');

        const simulacao = temDadosDeSimulacao
            ? '\nDados p/ simulação:\n' +
              LINHAS_DE_SIMULACAO.map(([rotulo, campo]) => `  ${rotulo}: ${estado[campo] || NAO_INFORMADO}\n`).join('')
            : '';

        // CONGELA (D-31): a ultima linha ramifica por "o departamento tem ID
        // cadastrado?", e nao por "o cliente escolheu loja?". Como "Pós-venda"
        // nasce sem ID, a nota diz "Sem loja escolhida" mesmo quando ele
        // escolheu — o vendedor le uma informacao falsa. Corrigir e mudanca de
        // comportamento; fica como divida.
        const id = idDoDepartamento(departamento);
        const destino = id
            ? `\n${SETA} Transferir para o departamento ${departamento} (#${id})`
            : `\n${SETA} Sem loja escolhida — o ticket permanece em ${departamento} para a equipe direcionar`;

        return (
            `${CABECALHO}${opcoes.tagExtra ? ' [' + opcoes.tagExtra + ']' : ''}\n\n` +
            `Contato: ${estado.nome || 'Lead'} (${chatId})\n` +
            `Perfil: ${nomeDoPerfil(estado)}\n` +
            diagnostico +
            `Loja escolhida: ${estado.loja || 'Não informada'}\n` +
            simulacao +
            (opcoes.proximoExpediente ? `Retorno sugerido: ${opcoes.proximoExpediente}\n` : '') +
            destino
        );
    }

    return { montar };
}

module.exports = { criar, LINHAS_DO_DIAGNOSTICO, LINHAS_DE_SIMULACAO, NAO_INFORMADO };
