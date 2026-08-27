// =============================================================
//  REPOSITORIO EM REDIS
//
//  Estado durável das conversas, compartilhado entre instancias.
//
//  Cada operacao tem FALLBACK EXPLICITO para memoria: se o Redis falhar, o
//  atendimento continua degradado em vez de cair. Antes esse fallback estava
//  espalhado em oito try/catch identicos; agora e uma dependencia declarada,
//  o que o torna testavel.
//
//  O lock e fail-OPEN de proposito: um Redis instavel nao pode impedir o
//  cliente de ser atendido. O preco e que, nesse cenario, duas instancias
//  podem processar o mesmo lead em paralelo.
// =============================================================

const TTL_PADRAO_SEG = 60 * 60 * 24 * 30; // 30 dias — conversas paradas expiram sozinhas
const TTL_LOCK_PADRAO_MS = 60000;

/**
 * @param {object} deps
 * @param {any} deps.redis cliente ioredis (injetado)
 * @param {import('../../application/portas').RepositorioDeAtendimento} deps.fallback
 * @param {string} [deps.prefixo]
 * @param {number} [deps.ttlSegundos]
 */
function criar({ redis, fallback, prefixo = 'avellozcg', ttlSegundos = TTL_PADRAO_SEG }) {
    const chaveDoLead = (chatId) => `${prefixo}:lead:${chatId}`;
    const chaveDaLista = `${prefixo}:leads`;
    const chaveDoLock = (chatId) => `${prefixo}:lock:${chatId}`;
    const prefixoDeBusca = `${prefixo}:lead:`;

    /** Executa a operacao; se o Redis falhar, loga e cai no fallback. */
    async function comFallback(nome, operacao, aoFalhar) {
        try {
            return await operacao();
        } catch (e) {
            console.error(`\u{274C} ${nome}:`, e.message);
            return aoFalhar();
        }
    }

    return {
        isRedis: () => true,

        getLead: (chatId) =>
            comFallback(
                'getLead',
                async () => {
                    const s = await redis.get(chaveDoLead(chatId));
                    return s ? JSON.parse(s) : null;
                },
                () => fallback.getLead(chatId)
            ),

        saveLead: (chatId, leadData) =>
            comFallback(
                'saveLead',
                () => redis.set(chaveDoLead(chatId), JSON.stringify(leadData), 'EX', ttlSegundos),
                () => fallback.saveLead(chatId, leadData)
            ),

        deleteLead: (chatId) =>
            comFallback(
                'deleteLead',
                () => redis.del(chaveDoLead(chatId)),
                () => fallback.deleteLead(chatId)
            ),

        scanLeadIds: () =>
            comFallback(
                'scanLeadIds',
                async () => {
                    const ids = [];
                    let cursor = '0';
                    do {
                        const [proximo, chaves] = await redis.scan(
                            cursor,
                            'MATCH',
                            `${prefixoDeBusca}*`,
                            'COUNT',
                            200
                        );
                        cursor = proximo;
                        for (const k of chaves) ids.push(k.slice(prefixoDeBusca.length));
                    } while (cursor !== '0');
                    return ids;
                },
                () => fallback.scanLeadIds()
            ),

        appendLeadFinalizado: (registro) =>
            comFallback(
                'appendLeadFinalizado',
                () => redis.rpush(chaveDaLista, JSON.stringify(registro)),
                () => fallback.appendLeadFinalizado(registro)
            ),

        // Lock cross-instancia (SET NX PX). Fail-open: Redis instavel nao pode
        // travar o atendimento.
        acquireLock: (chatId, ttlMs = TTL_LOCK_PADRAO_MS) =>
            comFallback(
                'acquireLock',
                async () => (await redis.set(chaveDoLock(chatId), '1', 'PX', ttlMs, 'NX')) === 'OK',
                () => true
            ),

        releaseLock: (chatId) =>
            comFallback(
                'releaseLock',
                async () => {
                    await redis.del(chaveDoLock(chatId));
                },
                () => {}
            )
    };
}

module.exports = { criar, TTL_PADRAO_SEG, TTL_LOCK_PADRAO_MS };
