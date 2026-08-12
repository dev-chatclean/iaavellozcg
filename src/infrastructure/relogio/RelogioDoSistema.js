// =============================================================
//  RELÓGIO DO SISTEMA (SPEC 0004)
//
//  Implementa a porta Relogio. Existe para que o tempo deixe de ser uma
//  chamada global espalhada pelo código: reativação (30 min) e reset por
//  inatividade (24h) passam a ser testáveis sem esperar de verdade.
// =============================================================

function criar() {
    return {
        agora: () => Date.now(),
        data: () => new Date()
    };
}

module.exports = { criar };
