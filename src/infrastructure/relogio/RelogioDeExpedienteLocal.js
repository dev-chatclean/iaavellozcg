// =============================================================
//  RELÓGIO DE EXPEDIENTE (SPEC 0004)
//
//  Adapter fino sobre horario.js. Na Fase 3 o cálculo de expediente vira
//  serviço de domínio e este adapter passa a apontar para lá — quem consome
//  não muda, porque depende da porta.
// =============================================================

const { estaEmExpediente } = require('../../../horario');

function criar() {
    return {
        consultar: (data) => estaEmExpediente(data)
    };
}

module.exports = { criar };
