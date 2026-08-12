// =============================================================
//  npm run eval — avaliacao da qualidade conversacional (SPEC 0011)
//
//  ATENCAO: GASTA CREDITO REAL DA OPENAI (~28 turnos, 2 chamadas por turno).
//  Rode antes e depois de qualquer mudanca de prompt e compare as metricas.
//
//  Sai com codigo 1 se alguma regra BLOQUEANTE for violada (RN-001, RN-010,
//  RN-020) — assim da para usar como gate num pipeline, se um dia quiser.
// =============================================================

require('dotenv').config();

const { carregar: carregarConfig } = require('./src/main/config');
const container = require('./src/main/container');
const CanalDeTerminal = require('./src/infrastructure/terminal/CanalDeTerminal');
const RepositorioMemoria = require('./src/infrastructure/memoria/RepositorioMemoria');
const ProcessarMensagemRecebida = require('./src/application/casos-de-uso/ProcessarMensagemRecebida');
const { executar, imprimirResumo } = require('./src/eval/executar');
const { VERSAO_EM_USO } = require('./src/infrastructure/openai/prompts');

const config = carregarConfig();

// Cada roteiro comeca do zero: canal, repositorio e atendimento proprios.
function montarAtendimento(coletar) {
    const canal = CanalDeTerminal.criar({ escrever: () => {} });
    const canalColetor = {
        ...canal,
        async enviarTexto(chatId, texto) {
            if (!texto || !String(texto).trim()) return false;
            coletar(texto);
            return true;
        }
    };
    const repositorio = RepositorioMemoria.criar();
    const deps = container.criar(config, { canal: canalColetor, notificador: canalColetor, repositorio });

    return {
        atendimento: ProcessarMensagemRecebida.criar(deps, config),
        repositorio,
        chatId: '5583999990000'
    };
}

(async () => {
    console.log(`\nAvaliando a versao de prompt: ${VERSAO_EM_USO}`);
    console.log('ATENCAO: esta execucao gasta credito real da OpenAI.\n');

    const relatorio = await executar({ montarAtendimento });
    const aprovado = imprimirResumo(relatorio);
    process.exit(aprovado ? 0 : 1);
})().catch((e) => {
    console.error('ERRO na avaliacao:', e.message);
    process.exit(1);
});
