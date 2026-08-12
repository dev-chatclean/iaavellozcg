// =============================================================
//  TRADUCAO DO PAYLOAD NA BORDA HTTP (SPEC 0018)
//
//  Casca fina sobre o Anti-Corruption Layer (spec 0003): aplica as politicas
//  vindas da configuracao, registra o motivo do descarte e devolve o formato
//  que o restante do fluxo espera (mensagem ou null).
//
//  As mensagens de log sao as mesmas de sempre, acrescidas do motivo nomeado.
// =============================================================

const acl = require('../chatclean/acl/tradutor');
const { MOTIVOS } = require('../../domain/mensageria/MotivoDeDescarte');

/**
 * @param {object} politicas { ignorarGrupos, apenasPendentes }
 */
function criar(politicas) {
    return function traduzir(corpo) {
        const r = acl.traduzir(corpo, politicas);

        if (r.aceita) {
            if (r.divergenciasDeEsquema) {
                // O formato do ChatClean mudou em algum detalhe. NAO barramos —
                // so registramos, para descobrir antes de virar incidente.
                console.warn(
                    `⚠️ Payload fora do esquema conhecido (processado mesmo assim): ${r.divergenciasDeEsquema.join('; ')}`
                );
            }
            return r;
        }

        switch (r.motivo) {
            case MOTIVOS.ECO:
                break; // silencioso, como sempre foi
            case MOTIVOS.GRUPO:
                console.log('👥 Mensagem de grupo ignorada');
                break;
            case MOTIVOS.TICKET_ASSUMIDO:
            case MOTIVOS.TICKET_ENCERRADO:
                console.log(`⏭️ Ticket "${r.detalhe || 'sem status'}" — ${r.descricao} [${r.motivo}]`);
                break;
            case MOTIVOS.FORMATO_DUPLICADO:
                console.log('↩️ Ignorando disparo duplicado (formato numero_cliente)');
                break;
            case MOTIVOS.SEM_TELEFONE:
                console.log(`⚠️ Payload sem telefone identificável [${r.motivo}]`);
                break;
            default:
                console.log(`⚠️ Payload não reconhecido [${r.motivo}]${r.detalhe ? ' — ' + r.detalhe : ''}`);
        }
        return null;
    };
}

module.exports = { criar };
