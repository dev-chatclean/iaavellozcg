// =============================================================
//  STORE — costura entre o index.js e os repositorios
//
//  A implementacao vive em src/infrastructure: RepositorioRedis (durável,
//  compartilhado) e RepositorioMemoria (processo local, e fallback do Redis).
//
//  Este arquivo faz só a montagem: le o ambiente, escolhe o adapter e expoe a
//  mesma superficie de sempre. Some quando o composition root nascer.
//
//  Env:
//    REDIS_URL     = redis://:senha@host:6379  (ex.: instância da Hostinger)
//    REDIS_PREFIX  = namespace das chaves (padrão: avellozcg)
// =============================================================

const RepositorioMemoria = require('./src/infrastructure/memoria/RepositorioMemoria');
const RepositorioRedis = require('./src/infrastructure/redis/RepositorioRedis');

const REDIS_URL = process.env.REDIS_URL || '';
const PREFIX = process.env.REDIS_PREFIX || 'avellozcg';

const memoria = RepositorioMemoria.criar();

function montar() {
    if (!REDIS_URL) return memoria;
    try {
        const Redis = require('ioredis');
        const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
        redis.on('connect', () => console.log('🗄️  Redis conectado'));
        redis.on('error', (e) => console.error('❌ Redis:', e.message));
        return RepositorioRedis.criar({ redis, fallback: memoria, prefixo: PREFIX });
    } catch (e) {
        console.error('❌ Falha ao iniciar o Redis, usando memória:', e.message);
        return memoria;
    }
}

const repositorio = montar();

module.exports = {
    isRedis: () => repositorio.isRedis(),
    getLead: (chatId) => repositorio.getLead(chatId),
    saveLead: (chatId, leadData) => repositorio.saveLead(chatId, leadData),
    deleteLead: (chatId) => repositorio.deleteLead(chatId),
    appendLeadFinalizado: (registro) => repositorio.appendLeadFinalizado(registro),
    scanLeadIds: () => repositorio.scanLeadIds(),
    acquireLock: (chatId, ttlMs) => repositorio.acquireLock(chatId, ttlMs),
    releaseLock: (chatId) => repositorio.releaseLock(chatId)
};
