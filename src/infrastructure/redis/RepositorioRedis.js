// =============================================================
//  REPOSITÓRIO NO REDIS (SPEC 0004)
//
//  Implementa a porta RepositorioDeAtendimento. Extraído de store.js.
//
//  Diferença estrutural: o store.js antigo era Redis E memória no mesmo
//  módulo, decidindo sozinho qual usar. Agora são dois adapters, e quem
//  escolhe é o container. O comportamento observável continua o mesmo:
//  erro de Redis cai para memória, e o lock é fail-open.
//
//  Chaves:
//    <prefixo>:lead:<chatId>   estado do atendimento, TTL 30 dias
//    <prefixo>:leads           histórico append-only de leads qualificados
//    <prefixo>:lock:<chatId>   lock de processamento (SET NX PX)
// =============================================================

const TTL_LEAD_SEGUNDOS = 60 * 60 * 24 * 30; // 30 dias

/**
 * @param {object} deps
 * @param {string} deps.url        REDIS_URL
 * @param {string} deps.prefixo    REDIS_PREFIX
 * @param {object} deps.reserva    Repositório usado quando o Redis falha (memória)
 */
function criar({ url, prefixo = 'avellozcg', reserva }) {
    const Redis = require('ioredis');
    const redis = new Redis(url, { maxRetriesPerRequest: 3 });
    redis.on('connect', () => console.log('🗄️  Redis conectado'));
    redis.on('error', (e) => console.error('❌ Redis:', e.message));

    const chaveLead = (chatId) => `${prefixo}:lead:${chatId}`;
    const chaveLock = (chatId) => `${prefixo}:lock:${chatId}`;
    const chaveLista = `${prefixo}:leads`;

    return {
        ehDuravel: () => true,

        async buscar(chatId) {
            try {
                const s = await redis.get(chaveLead(chatId));
                return s ? JSON.parse(s) : null;
            } catch (e) {
                console.error('❌ getLead:', e.message);
                return reserva.buscar(chatId);
            }
        },

        async salvar(chatId, dados) {
            try {
                await redis.set(chaveLead(chatId), JSON.stringify(dados), 'EX', TTL_LEAD_SEGUNDOS);
                return;
            } catch (e) {
                console.error('❌ saveLead:', e.message);
            }
            await reserva.salvar(chatId, dados);
        },

        async remover(chatId) {
            try {
                await redis.del(chaveLead(chatId));
                return;
            } catch (e) {
                console.error('❌ deleteLead:', e.message);
            }
            await reserva.remover(chatId);
        },

        async listarIds() {
            try {
                const ids = [];
                const inicio = `${prefixo}:lead:`;
                let cursor = '0';
                do {
                    const [proximo, chaves] = await redis.scan(cursor, 'MATCH', `${inicio}*`, 'COUNT', 200);
                    cursor = proximo;
                    for (const k of chaves) ids.push(k.slice(inicio.length));
                } while (cursor !== '0');
                return ids;
            } catch (e) {
                console.error('❌ scanLeadIds:', e.message);
                return reserva.listarIds();
            }
        },

        async registrarLeadFinalizado(registro) {
            try {
                await redis.rpush(chaveLista, JSON.stringify(registro));
                return;
            } catch (e) {
                console.error('❌ appendLeadFinalizado:', e.message);
            }
            await reserva.registrarLeadFinalizado(registro);
        },

        // Lock cross-instância. Fail-open de propósito: instabilidade de infra
        // não pode travar o atendimento.
        async adquirirLock(chatId, ttlMs = 60000) {
            try {
                const r = await redis.set(chaveLock(chatId), '1', 'PX', ttlMs, 'NX');
                return r === 'OK';
            } catch (e) {
                console.error('❌ acquireLock:', e.message);
                return true;
            }
        },

        async liberarLock(chatId) {
            try {
                await redis.del(chaveLock(chatId));
            } catch (e) {
                console.error('❌ releaseLock:', e.message);
            }
        },

        async fechar() {
            try {
                await redis.quit();
            } catch {
                // encerrando mesmo assim
            }
        }
    };
}

module.exports = { criar };
