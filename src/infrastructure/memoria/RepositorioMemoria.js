// =============================================================
//  REPOSITÓRIO EM MEMÓRIA (SPEC 0004)
//
//  Implementa a porta RepositorioDeAtendimento. Serve para duas coisas:
//    1. desenvolvimento e teste, escolhido explicitamente pelo container;
//    2. reserva do adapter Redis quando ele falha (comportamento herdado).
//
//  O estado NÃO sobrevive ao restart — ehDuravel() devolve false, e é isso
//  que /diag informa.
// =============================================================

function criar() {
    const leads = new Map();
    const finalizados = [];
    const locks = new Set();

    return {
        ehDuravel: () => false,

        async buscar(chatId) {
            return leads.get(chatId) || null;
        },

        async salvar(chatId, dados) {
            leads.set(chatId, dados);
        },

        async remover(chatId) {
            leads.delete(chatId);
        },

        async listarIds() {
            return [...leads.keys()];
        },

        async registrarLeadFinalizado(registro) {
            finalizados.push(registro);
        },

        // Sem Redis não há concorrência entre instâncias; o lock em memória do
        // index.js já basta. Mantido o comportamento do store.js: sempre true.
        async adquirirLock(chatId) {
            locks.add(chatId);
            return true;
        },

        async liberarLock(chatId) {
            locks.delete(chatId);
        },

        async fechar() {
            // nada a fechar
        }
    };
}

module.exports = { criar };
