// =============================================================
//  LOCK DE ATENDIMENTO — RN-056
//
//  Impede que o mesmo cliente seja processado duas vezes ao mesmo tempo. Sao
//  DOIS niveis, e a diferenca entre eles importa:
//
//    LOCAL  — um Map no processo. Protege contra duas mensagens do mesmo
//             cliente caindo em paralelo nesta instancia. Tem um temporizador
//             de seguranca: se o turno travar (rede pendurada, promessa que
//             nunca resolve), o lock se solta sozinho em vez de silenciar o
//             cliente para sempre.
//
//    REMOTO — no repositorio (Redis). Protege contra DUAS INSTANCIAS. E
//             FAIL-OPEN: se o Redis estiver fora, concede — um Redis instavel
//             nao pode impedir o atendimento. O preco e que, nesse cenario,
//             o mesmo lead pode ser processado em paralelo (D-15).
//
//  A liberacao e em duas etapas de proposito. O lock local sai primeiro, para
//  a fila poder drenar o proximo turno; o remoto sai por ultimo, DEPOIS de o
//  estado ter sido gravado — senao outra instancia leria um estado velho.
// =============================================================

const TTL_PADRAO_MS = 60000;

/**
 * @param {object} deps
 * @param {import('../portas').RepositorioDeAtendimento} deps.repositorio
 * @param {number} [deps.ttlMs]
 * @param {(chatId: string) => void} [deps.aoExpirar]
 *   Chamado quando o temporizador de seguranca solta um lock preso.
 */
function criar({ repositorio, ttlMs = TTL_PADRAO_MS, aoExpirar = () => {} }) {
    /** @type {Map<string, any>} chatId -> temporizador de seguranca */
    const emProcessamento = new Map();

    function ocupado(chatId) {
        return emProcessamento.has(chatId);
    }

    function liberarLocal(chatId) {
        const temporizador = emProcessamento.get(chatId);
        if (temporizador) clearTimeout(temporizador);
        emProcessamento.delete(chatId);
    }

    /**
     * @returns {Promise<{ok: boolean, motivo: 'em_processamento'|'outra_instancia'|null,
     *                     liberarLocal: () => void, liberarRemoto: () => Promise<void>}>}
     */
    async function adquirir(chatId) {
        if (ocupado(chatId)) {
            return { ok: false, motivo: 'em_processamento', liberarLocal: () => {}, liberarRemoto: async () => {} };
        }

        const temporizador = setTimeout(() => {
            if (emProcessamento.has(chatId)) {
                emProcessamento.delete(chatId);
                aoExpirar(chatId);
            }
        }, ttlMs);
        emProcessamento.set(chatId, temporizador);

        const concedidoNoCluster = await repositorio.acquireLock(chatId, ttlMs);
        if (!concedidoNoCluster) {
            liberarLocal(chatId);
            return { ok: false, motivo: 'outra_instancia', liberarLocal: () => {}, liberarRemoto: async () => {} };
        }

        return {
            ok: true,
            motivo: null,
            liberarLocal: () => liberarLocal(chatId),
            liberarRemoto: () => repositorio.releaseLock(chatId)
        };
    }

    return { adquirir, ocupado };
}

module.exports = { criar, TTL_PADRAO_MS };
