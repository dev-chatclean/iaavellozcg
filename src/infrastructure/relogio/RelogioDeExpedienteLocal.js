// =============================================================
//  RELOGIO DE EXPEDIENTE (SPEC 0004, atualizado na SPEC 0022)
//
//  Implementa a porta RelogioDeExpediente sobre o dominio
//  src/domain/expediente. E aqui que a configuracao encontra a regra: os
//  feriados extras vem do ambiente e sao injetados no dominio, que nao le
//  process.env.
// =============================================================

const Expediente = require('../../domain/expediente/Expediente');

/**
 * @param {object} [opcoes]
 * @param {string} [opcoes.feriados] Lista separada por virgula (env FERIADOS).
 */
function criar({ feriados = '' } = {}) {
    const expediente = Expediente.criar({
        feriadosExtras: String(feriados).split(',').map((s) => s.trim()).filter(Boolean)
    });

    return {
        consultar: (data) => expediente.estaEmExpediente(data)
    };
}

module.exports = { criar };
