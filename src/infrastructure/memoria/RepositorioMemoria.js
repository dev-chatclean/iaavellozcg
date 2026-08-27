// =============================================================
//  REPOSITORIO EM MEMORIA
//
//  Guarda o estado das conversas no proprio processo. Serve para dois papeis:
//  o modo local/dev (sem REDIS_URL) e o FALLBACK do adapter de Redis quando o
//  Redis falha — nesse caso o atendimento continua, degradado, em vez de cair.
//
//  Limite conhecido: o estado morre com o processo e nao e compartilhado entre
//  instancias. Com mais de um container, cada um tem a sua propria verdade.
// =============================================================

/**
 * @returns {import('../../application/portas').RepositorioDeAtendimento}
 */
function criar() {
    /** @type {Map<string, object>} */
    const leads = new Map();
    /** @type {object[]} */
    const finalizados = [];

    return {
        isRedis: () => false,

        // ATENCAO: devolve a REFERENCIA do objeto guardado, nao uma copia.
        // Quem receber e mutar altera o estado guardado sem chamar saveLead.
        // O adapter de Redis nao se comporta assim (la o JSON e reparseado a
        // cada leitura). E divergencia herdada, congelada no teste de contrato.
        getLead: async (chatId) => leads.get(chatId) || null,

        saveLead: async (chatId, leadData) => {
            leads.set(chatId, leadData);
        },

        deleteLead: async (chatId) => {
            leads.delete(chatId);
        },

        scanLeadIds: async () => [...leads.keys()],

        appendLeadFinalizado: async (registro) => {
            finalizados.push(registro);
        },

        // Sem Redis nao ha lock cross-instancia: o lock em memoria do turno ja
        // basta para uma instancia so. Sempre concede.
        acquireLock: async () => true,
        releaseLock: async () => {},

        // Usados pelo adapter de Redis como fallback e pelos testes.
        _leads: leads,
        _finalizados: finalizados
    };
}

module.exports = { criar };
