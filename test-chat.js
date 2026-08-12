// =============================================================
//  TESTER LOCAL — conversa com o consultor no terminal, SEM WhatsApp
//  e SEM ChatClean.
//
//  Desde a SPEC 0010 este arquivo NAO reimplementa o turno: ele monta o
//  container com um canal de terminal e um repositorio em memoria, e chama o
//  MESMO caso de uso que roda em producao. O que voce ve aqui e o que o
//  cliente veria — era esse o problema do D-04, em que os tres caminhos ja
//  divergiam entre si.
//
//  Precisa so de OPENAI_API_KEY no .env. GASTA CREDITO REAL.
//  Rodar:  npm run chat
//  Comandos: /reset  reinicia | /estado  mostra o lead | /sair  encerra
// =============================================================

require('dotenv').config();
const readline = require('readline');

const { carregar: carregarConfig } = require('./src/main/config');
const container = require('./src/main/container');
const CanalDeTerminal = require('./src/infrastructure/terminal/CanalDeTerminal');
const RepositorioMemoria = require('./src/infrastructure/memoria/RepositorioMemoria');
const ProcessarMensagemRecebida = require('./src/application/casos-de-uso/ProcessarMensagemRecebida');
const Qualificacao = require('./src/domain/atendimento/Qualificacao');
const { PERFIS } = require('./data');

const CHAT_ID = '5583999990000'; // numero ficticio para o atendimento local

const config = carregarConfig();
const canal = CanalDeTerminal.criar({ rotuloBot: 'bot' });
const repositorio = RepositorioMemoria.criar();
const deps = container.criar(config, { canal, notificador: canal, repositorio });
const atendimento = ProcessarMensagemRecebida.criar(deps, config);

async function mostrarEstado() {
    const lead = (await repositorio.buscar(CHAT_ID)) || {};
    console.log('\n  Estado do lead:');
    for (const campo of Qualificacao.TODOS_OS_CAMPOS) {
        if (lead[campo]) console.log(`     ${campo}: ${lead[campo]}`);
    }
    const perfil = lead.perfilKey && PERFIS[lead.perfilKey] ? PERFIS[lead.perfilKey].nome : null;
    if (perfil) console.log(`     perfil: ${perfil}`);
    console.log(`     qualificado: ${!!lead.qualificacaoCompleta} | finalizado: ${!!lead.finalizado}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\nIA Avelloz Campina — tester local (mesmo caso de uso da producao)');
console.log('   Digite como se fosse o cliente. Comandos: /reset  /estado  /sair\n');
rl.setPrompt('você > ');
rl.prompt();

rl.on('line', async (linha) => {
    const texto = linha.trim();
    if (!texto) return rl.prompt();
    if (texto === '/sair') return rl.close();
    if (texto === '/reset') {
        await repositorio.remover(CHAT_ID);
        console.log('  conversa reiniciada\n');
        return rl.prompt();
    }
    if (texto === '/estado') {
        await mostrarEstado();
        return rl.prompt();
    }

    try {
        process.stdout.write('  ...\r');
        await atendimento.processarMensagem({ chatId: CHAT_ID, texto, tipo: 'text' });
    } catch (e) {
        console.error('erro:', e.message, '\n');
    }
    rl.prompt();
});

rl.on('close', () => {
    console.log('\nencerrado.');
    process.exit(0);
});
