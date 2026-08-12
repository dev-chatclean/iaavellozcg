// =============================================================
//  SIMULACAO — roda uma conversa de qualificacao COMPLETA e imprime o resumo
//  que iria para a equipe, mais o custo em tokens.
//
//  Desde a SPEC 0010 usa o MESMO caso de uso da producao (antes reimplementava
//  o turno e ate copiava o montarResumo, com divergencias — D-04). O resumo
//  impresso agora e literalmente o que a equipe receberia.
//
//  Rodar:  npm run sim        Precisa de OPENAI_API_KEY. GASTA CREDITO REAL.
//  SIM_DATA="2026-08-16T10:00:00-03:00" forca um instante para testar o plantao.
// =============================================================

require('dotenv').config();

const { carregar: carregarConfig } = require('./src/main/config');
const container = require('./src/main/container');
const CanalDeTerminal = require('./src/infrastructure/terminal/CanalDeTerminal');
const RepositorioMemoria = require('./src/infrastructure/memoria/RepositorioMemoria');
const ClienteComContagem = require('./src/infrastructure/openai/ClienteComContagem');
const ProcessarMensagemRecebida = require('./src/application/casos-de-uso/ProcessarMensagemRecebida');
const Expediente = require('./src/domain/expediente/Expediente');
const OpenAI = require('openai');

const CHAT_ID = '5583999990000';

// Roteiro do "cliente": motoboy que roda de moto alugada. Pede preco no comeco
// de proposito — o bot deve REDIRECIONAR para o diagnostico (RN-001).
const ROTEIRO = [
    'oi',
    'quanto custa a AZ1?',
    'primeira vez que ouço falar de vocês',
    'quero uma moto pra trabalhar de aplicativo',
    'hoje eu rodo de moto alugada',
    'pago 250 por semana de aluguel, a moto não é minha',
    'perco um tempão quando a alugada dá problema',
    'qual moto vocês indicam pra mim?',
    'gostei da AZ125',
    'seria no financiamento',
    'meu nome é Rafael, CPF 12345678900, nasci 10/05/1995, telefone 83999998888, tenho CNH, quero a AZ125 vermelha',
    'pode ser na loja Malvinas'
];

const config = carregarConfig();

// Instante fixo, quando pedido, para exercitar o modo plantao.
const instante = process.env.SIM_DATA ? new Date(process.env.SIM_DATA) : null;
const expedienteDoDominio = Expediente.criar({
    feriadosExtras: String(config.FERIADOS || '').split(',').map((f) => f.trim()).filter(Boolean)
});
const expediente = { consultar: () => expedienteDoDominio.estaEmExpediente(instante || new Date()) };

const canal = CanalDeTerminal.criar({ rotuloBot: 'BOT    ' });
const repositorio = RepositorioMemoria.criar();
const { cliente, contagem } = ClienteComContagem.envolver(new OpenAI({ apiKey: config.OPENAI_API_KEY }));
const deps = container.criar(config, { canal, notificador: canal, repositorio, cliente, expediente });
const atendimento = ProcessarMensagemRecebida.criar(deps, config);

(async () => {
    const exp = expediente.consultar();
    console.log('\n======== SIMULACAO — qualificacao de lead (motoboy / moto alugada) ========');
    console.log(
        exp.aberto
            ? '   Modo: EXPEDIENTE — transfere ao vivo\n'
            : `   Modo: PLANTAO (${exp.motivo}) — encaminha e sugere retorno para ${exp.proximoExpediente}\n`
    );

    for (const mensagem of ROTEIRO) {
        console.log('CLIENTE > ' + mensagem);
        await atendimento.processarMensagem({ chatId: CHAT_ID, texto: mensagem, tipo: 'text' });

        const lead = await repositorio.buscar(CHAT_ID);
        if (lead?.finalizado) {
            console.log('-------- FINALIZADO — resumo acima e o que a equipe recebe --------\n');
            break;
        }
    }

    console.log('-------- custo desta conversa --------');
    console.log(
        `chamadas: ${contagem.chamadas} | tokens: ${contagem.entrada} entrada + ${contagem.saida} saida` +
            ` | ~US$ ${contagem.custoEstimadoUsd().toFixed(4)}`
    );
})().catch((e) => console.error('ERR', e.message));
