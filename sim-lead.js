// =============================================================
//  SIMULACAO — um lead percorrendo o funil inteiro, sem interacao
//
//  Roda o ATENDIMENTO DE PRODUCAO de ponta a ponta com um roteiro fixo, e
//  mostra o que o cliente leria, o que a equipe receberia e para qual fila o
//  ticket iria. Serve para conferir uma mudanca de prompt ou de funil sem
//  precisar digitar a conversa toda.
//
//  Como o test-chat.js, troca APENAS o canal de saida. Antes da refatoracao
//  este arquivo tinha a propria copia do turno, que ja havia divergido da
//  producao.
//
//  Rodar:  npm run sim
//  ATENCAO: gasta credito real da OpenAI (uma chamada de extracao e uma de
//  redacao por mensagem do roteiro).
// =============================================================

require('dotenv').config();

const carregarConfig = require('./src/main/config').carregar;
const CanalDeTerminal = require('./src/infrastructure/terminal/CanalDeTerminal');
const { PERFIS } = require('./src/domain/catalogo/Catalogo');

if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Defina OPENAI_API_KEY no .env antes de rodar a simulacao.');
    process.exit(1);
}

// Motoboy que aluga moto: o perfil de maior conversao, e o que exercita a
// conta da economia (o argumento central da venda).
const ROTEIRO = [
    'oi, vi o anuncio de voces',
    'quero uma moto pra trabalhar de aplicativo',
    'hoje eu alugo uma moto',
    'pago 250 por semana no aluguel',
    'a moto alugada vive quebrando, ja gastei muito com manutencao',
    'quanto custa a AZ125?',
    'gostei da AZ125',
    'queria financiar',
    'pode ser na Malvinas',
    'meu nome e Rafael Souza, CPF 123.456.789-00, nasci em 10/05/1995'
];

const CHAT = '5583999990000';

const config = carregarConfig({ ...process.env, CC_PUSH_URL: '', REDIS_URL: '', AGRUPAR_MENSAGENS_MS: '0' });
const canal = CanalDeTerminal.criar({ mostrarInterno: false });
const container = require('./src/main/container').criar(config, { canal });
const { processarMensagem, store } = container;

const mensagem = (texto, i) => ({
    chatId: CHAT,
    contactId: null,
    texto,
    tipo: 'text',
    msgId: 'SIM-' + i,
    nomeContato: '',
    quotedText: null,
    mediaBase64: null,
    mediaUrl: null,
    mediaMimetype: null
});

(async () => {
    console.log('\nSIMULACAO — lead percorrendo o funil (atendimento de producao)\n');

    for (const [i, texto] of ROTEIRO.entries()) {
        console.log(`você > ${texto}`);
        const antes = canal.mensagens().length;
        try {
            await processarMensagem(mensagem(texto, i));
        } catch (e) {
            console.error('  ❌ turno falhou:', e.message);
        }
        for (const resposta of canal.mensagens().slice(antes)) console.log('bot  > ' + resposta);
        console.log('');
    }

    const lead = (await store.getLead(CHAT)) || {};
    const perfil = lead.perfilKey && PERFIS[lead.perfilKey] ? PERFIS[lead.perfilKey].nome : 'não detectado';

    console.log('='.repeat(60));
    console.log('ESTADO FINAL DO LEAD');
    console.log('='.repeat(60));
    for (const k of [
        'nome', 'finalidade', 'transporteAtual', 'gastoMensal', 'situacaoMoto',
        'modeloInteresse', 'formaPagamento', 'loja',
        'nomeCompleto', 'cpf', 'dataNascimento', 'telefone', 'cnh', 'corModelo'
    ]) {
        if (lead[k]) console.log(`  ${k}: ${lead[k]}`);
    }
    console.log(`  perfil: ${perfil}`);
    console.log(`  qualificado: ${!!lead.qualificacaoCompleta} | finalizado: ${!!lead.finalizado}`);

    const notas = canal.notas();
    if (notas.length) {
        console.log('\n' + '='.repeat(60));
        console.log('O QUE A EQUIPE RECEBE');
        console.log('='.repeat(60));
        console.log(notas[0]);
    } else {
        console.log('\n(o funil nao fechou: a equipe nao recebeu resumo)');
    }

    const transferencias = canal.transferencias();
    console.log('\n' + '='.repeat(60));
    console.log(
        transferencias.length
            ? `TICKET TRANSFERIDO para a fila #${transferencias[0].queueId}`
            : 'TICKET NAO TRANSFERIDO — permanece na fila de entrada'
    );
    console.log('='.repeat(60) + '\n');

    process.exit(0);
})();
