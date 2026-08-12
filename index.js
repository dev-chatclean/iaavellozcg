// =============================================================
//  IA AVELLOZ CAMPINA — BOOTSTRAP
//
//  Este arquivo tinha 1040 linhas e oito responsabilidades. Depois da
//  estrangulacao, ele so monta as pecas e liga o servidor:
//
//    src/main/config.js          configuracao validada
//    src/main/container.js       adapters concretos (composition root)
//    src/application/            casos de uso e fila
//    src/domain/                 regras de negocio
//    src/infrastructure/         OpenAI, ChatClean, Redis, HTTP
//
//  Ver docs/10-arquitetura-alvo.md e docs/11-plano-refatoracao-strangler.md.
// =============================================================

require('dotenv').config();

const { carregar: carregarConfig, avisos: avisosDeConfiguracao } = require('./src/main/config');
const container = require('./src/main/container');
const ProcessarMensagemRecebida = require('./src/application/casos-de-uso/ProcessarMensagemRecebida');
const FilaDeTurnos = require('./src/application/fila/FilaDeTurnos');
const servidorHttp = require('./src/infrastructure/http/servidor');
const mascarar = require('./src/shared/mascarar');
const { EMPRESA_INFO } = require('./src/domain/catalogo/Catalogo');

/**
 * Monta o sistema a partir da configuracao e das dependencias.
 * Os testes chamam esta funcao com adapters fake — nao ha mais costura de
 * injecao no meio do caminho (a `usarDependencias` morreu aqui).
 */
function montar(config, deps) {
    const atendimento = ProcessarMensagemRecebida.criar(deps, config);

    const fila = FilaDeTurnos.criar({
        processarTurno: (turno) => atendimento.processarMensagem(turno),
        estaProcessando: (chatId) => atendimento.estaProcessando(chatId),
        janelaDeAgrupamentoMs: config.AGRUPAR_MENSAGENS_MS,
        aoFalhar: (erro, chatId) =>
            console.error(`❌ Erro ao drenar fila de ${mascarar.telefone(chatId)}:`, erro.message)
    });

    const { app, handleWebhook } = servidorHttp.criar({
        config,
        atendimento,
        fila,
        repositorio: deps.repositorio,
        expediente: deps.expediente,
        avisosDeConfiguracao
    });

    return { config, deps, atendimento, fila, app, handleWebhook };
}

function iniciar(sistema) {
    const { config, deps, atendimento, app } = sistema;

    setInterval(() => atendimento.varrerFollowUps(), ProcessarMensagemRecebida.FOLLOWUP_SWEEP).unref?.();

    const servidor = app.listen(config.PORT, () => {
        console.log('');
        console.log('🚀 ================================');
        console.log(`🏍️  IA ${EMPRESA_INFO.nome} — VIA CHATCLEAN (Webhook + Push)`);
        console.log(`📡 Servidor rodando na porta ${config.PORT}`);
        console.log(`🔗 Webhook: https://SEU_DOMINIO/webhook`);
        console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
        console.log('🚀 ================================');
        console.log('');
        for (const aviso of avisosDeConfiguracao(config)) console.warn(`⚠️  ${aviso}`);
        console.log(
            deps.repositorio.ehDuravel()
                ? '🗄️  Estado das conversas: Redis (persistente)'
                : '🗄️  Estado das conversas: memória (defina REDIS_URL para persistir entre restarts)'
        );
    });

    // ATENCAO: o encerramento ainda e abrupto — turnos em voo e mensagens na
    // fila sao perdidos, e o lock do Redis fica pendurado ate o TTL (D-16).
    // O shutdown gracioso e a spec 0014.
    async function encerrar(sinal) {
        console.log(`\n⚠️  Recebido sinal ${sinal}. Encerrando servidor...`);
        process.exit(0);
    }
    process.on('SIGINT', () => encerrar('SIGINT'));
    process.on('SIGTERM', () => encerrar('SIGTERM'));
    process.on('SIGUSR2', () => encerrar('SIGUSR2'));

    return servidor;
}

if (require.main === module) {
    const config = carregarConfig();
    iniciar(montar(config, container.criar(config)));
}

module.exports = { montar, iniciar };
