// =============================================================
//  COMPOSITION ROOT (SPEC 0004)
//
//  Único lugar do sistema que conhece adapters concretos. Recebe a
//  configuração já validada e devolve o conjunto de dependências que a
//  aplicação consome pelas portas.
//
//  Sem container de injeção e sem decorators: em Node, montar as
//  dependências à mão é mais fácil de ler e de depurar do que qualquer
//  resolução mágica.
// =============================================================

const OpenAI = require('openai');

const RelogioDoSistema = require('../infrastructure/relogio/RelogioDoSistema');
const RelogioDeExpedienteLocal = require('../infrastructure/relogio/RelogioDeExpedienteLocal');
const CanalChatClean = require('../infrastructure/chatclean/CanalChatClean');
const RepositorioMemoria = require('../infrastructure/memoria/RepositorioMemoria');
const RepositorioRedis = require('../infrastructure/redis/RepositorioRedis');
const ExtratorOpenAI = require('../infrastructure/openai/ExtratorOpenAI');
const RedatorOpenAI = require('../infrastructure/openai/RedatorOpenAI');
const TranscritorWhisper = require('../infrastructure/openai/TranscritorWhisper');
const LeitorDeImagemOpenAI = require('../infrastructure/openai/LeitorDeImagemOpenAI');
const BaixadorHttp = require('../infrastructure/midia/BaixadorHttp');

/**
 * Escolhe o repositório. Antes da SPEC 0004 essa decisão vivia DENTRO do
 * store.js, que era Redis e memória ao mesmo tempo. Agora está explícita
 * aqui — o comportamento observável é o mesmo: sem REDIS_URL, memória.
 */
function montarRepositorio(config) {
    const memoria = RepositorioMemoria.criar();
    if (!config.REDIS_URL) return memoria;
    try {
        return RepositorioRedis.criar({
            url: config.REDIS_URL,
            prefixo: config.REDIS_PREFIX,
            reserva: memoria
        });
    } catch (e) {
        console.error('❌ Falha ao iniciar o Redis, usando memória:', e.message);
        return memoria;
    }
}

/**
 * @param {object} config Configuração validada (src/main/config.js).
 * @returns {object} Dependências, todas conformes às portas de src/application/portas.
 */
function criar(config) {
    const cliente = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const canal = CanalChatClean.criar({
        urlDePush: config.CC_PUSH_URL,
        numeroDaEquipe: config.EQUIPE_NUMERO
    });

    return {
        canal,
        notificador: canal, // mesma origem, capacidades distintas (ISP)
        repositorio: montarRepositorio(config),
        extrator: ExtratorOpenAI.criar({ cliente }),
        redator: RedatorOpenAI.criar({ cliente }),
        transcritor: TranscritorWhisper.criar({ cliente }),
        leitorDeImagem: LeitorDeImagemOpenAI.criar({ cliente }),
        baixadorDeMidia: BaixadorHttp.criar(),
        relogio: RelogioDoSistema.criar(),
        expediente: RelogioDeExpedienteLocal.criar()
    };
}

module.exports = { criar, montarRepositorio };
