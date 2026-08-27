// =============================================================
//  TESTER LOCAL — conversa com o consultor no terminal, SEM WhatsApp
//  e SEM ChatClean.
//
//  Usa o ATENDIMENTO DE PRODUCAO: o mesmo caso de uso, as mesmas politicas,
//  a mesma fila, o mesmo transbordo. A UNICA coisa trocada e o canal de
//  saida, que escreve na tela em vez de falar com o CRM.
//
//  Isso importa. Ate a refatoracao, este arquivo tinha a PROPRIA copia do
//  turno — montava o proprio cliente da OpenAI, o proprio prompt, o proprio
//  loop. As duas implementacoes divergiram: a copia daqui nao passava o
//  expediente ao prompt (a conversa no terminal nunca sabia se a loja estava
//  aberta) e ainda citava um departamento que nao existe mais. Ou seja:
//  validar uma mudanca de prompt por aqui validava outro sistema.
//
//  Precisa so de OPENAI_API_KEY no .env.
//  Rodar:  npm run chat   (ou: node test-chat.js)
//  Comandos: /reset  reinicia | /estado  mostra o lead | /sair  encerra
//
//  ATENCAO: gasta credito real da OpenAI.
// =============================================================

require('dotenv').config();
const readline = require('readline');

const carregarConfig = require('./src/main/config').carregar;
const CanalDeTerminal = require('./src/infrastructure/terminal/CanalDeTerminal');
const { PERFIS } = require('./data');

if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Defina OPENAI_API_KEY no .env antes de rodar o tester.');
    process.exit(1);
}

const CHAT = '5583999990000'; // numero ficticio; o estado fica so em memoria

// Sem CC_PUSH_URL e sem REDIS_URL: nada sai para o mundo, estado em memoria.
// O atraso de digitacao vai a zero — no terminal ele so atrapalha.
const config = carregarConfig({ ...process.env, CC_PUSH_URL: '', REDIS_URL: '', AGRUPAR_MENSAGENS_MS: '0' });

const canal = CanalDeTerminal.criar();
const container = require('./src/main/container').criar(config, { canal });
const { processarMensagem, store } = container;

async function turno(texto) {
    await processarMensagem({
        chatId: CHAT,
        contactId: null,
        texto,
        tipo: 'text',
        msgId: 'TERMINAL-' + Date.now(),
        nomeContato: '',
        quotedText: null,
        mediaBase64: null,
        mediaUrl: null,
        mediaMimetype: null
    });
}

async function mostrarEstado() {
    const lead = (await store.getLead(CHAT)) || {};
    const perfil = lead.perfilKey && PERFIS[lead.perfilKey] ? PERFIS[lead.perfilKey].nome : null;
    console.log('\n  Estado do lead:');
    for (const k of [
        'nome', 'finalidade', 'transporteAtual', 'gastoMensal', 'situacaoMoto',
        'modeloInteresse', 'formaPagamento', 'loja',
        'nomeCompleto', 'cpf', 'dataNascimento', 'telefone', 'cnh', 'corModelo'
    ]) {
        if (lead[k]) console.log(`     ${k}: ${lead[k]}`);
    }
    if (perfil) console.log(`     perfil: ${perfil}`);
    console.log(`     qualificado: ${!!lead.qualificacaoCompleta} | finalizado: ${!!lead.finalizado}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\nIA Avelloz Campina — tester local (atendimento de producao, canal de terminal)');
console.log('   Digite como se fosse o cliente. Comandos: /reset  /estado  /sair\n');
rl.setPrompt('você > ');
rl.prompt();

rl.on('line', async (linha) => {
    const texto = linha.trim();
    if (!texto) return rl.prompt();
    if (texto === '/sair') return rl.close();
    if (texto === '/reset') {
        await store.deleteLead(CHAT);
        console.log('  conversa reiniciada\n');
        return rl.prompt();
    }
    if (texto === '/estado') {
        await mostrarEstado();
        return rl.prompt();
    }

    try {
        process.stdout.write('  ...\r');
        await turno(texto);
        console.log('');
    } catch (e) {
        console.error('❌ erro:', e.message, '\n');
    }
    rl.prompt();
});

rl.on('close', () => {
    console.log('\nencerrado.');
    process.exit(0);
});
