// =============================================================
//  SIMULAÇÃO — roda uma conversa de qualificação COMPLETA no mesmo
//  cérebro do bot (prompts + flow), sequencialmente, e imprime o
//  resumo que iria para a equipe. Sem WhatsApp/ChatClean.
//
//  Rodar:  node sim-lead.js   (ou: npm run sim)
//  Precisa de OPENAI_API_KEY no .env.
// =============================================================

require('dotenv').config();
const OpenAI = require('openai');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { PERFIS, DEPARTAMENTOS, lojaParaDepartamento } = require('./data');
const { determinarProximoCampo, aplicarCampos, detectarPerfil, registrarPedidoPreco } = require('./flow');
const { estaEmExpediente } = require('./horario');

// Força um horário para testar o modo plantão: SIM_DATA="2026-07-25T21:00:00-03:00"
const exp = process.env.SIM_DATA ? estaEmExpediente(new Date(process.env.SIM_DATA)) : estaEmExpediente();

if (!process.env.OPENAI_API_KEY) { console.error('❌ Defina OPENAI_API_KEY no .env'); process.exit(1); }
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const chatId = '5583999990000';
const leadData = { conversationHistory: [] };
let tokensEntrada = 0, tokensSaida = 0;

// Roteiro do "cliente" (motoboy que roda de moto alugada). Pede preço no começo
// (deve ser REDIRECIONADO pro diagnóstico antes de liberar modelo/preço).
const ROTEIRO = [
    'oi',
    'quanto custa a AZ1?',                                  // <- preço cedo: deve REDIRECIONAR
    'primeira vez que ouço falar de vocês',
    'quero uma moto pra trabalhar de aplicativo',
    'hoje eu rodo de moto alugada',                         // transporte + situação
    'pago 250 por semana de aluguel, a moto não é minha',  // gasto + situação de moto
    'perco um tempão quando a alugada dá problema',
    'qual moto vocês indicam pra mim?',                     // <- diagnóstico OK: pode apresentar
    'gostei da AZ125',                                      // modeloInteresse
    'seria no financiamento',                               // formaPagamento
    'meu nome é Rafael, CPF 12345678900, nasci 10/05/1995, telefone 83999998888, tenho CNH, quero a AZ125 vermelha', // dados
    'pode ser na loja Malvinas'                             // loja
];

async function extrair(mensagem, campoAtual, hist) {
    const prompt = promptExtracao({ mensagemSanitizada: mensagem.substring(0, 1000), campoAtual });
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0,
        messages: [...hist, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
    });
    tokensEntrada += c.usage.prompt_tokens; tokensSaida += c.usage.completion_tokens;
    let res = c.choices[0].message.content.trim();
    if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(res); } catch { return null; }
}

async function responder(mensagem, proximoCampo, hist) {
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada: mensagem.substring(0, 1000), proximoCampo, leadData, expediente: exp });
    const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0.7,
        messages: [{ role: 'system', content: SYSTEM_SDR }, ...hist, { role: 'user', content: prompt }]
    });
    tokensEntrada += c.usage.prompt_tokens; tokensSaida += c.usage.completion_tokens;
    return c.choices[0].message.content.trim();
}

function resumoEquipe() {
    const perfilNome = leadData.perfilKey && PERFIS[leadData.perfilKey] ? PERFIS[leadData.perfilKey].nome : 'Não informado';
    const departamento = lojaParaDepartamento(leadData.loja) || DEPARTAMENTOS.geral;
    return [
        '🏍️ LEAD QUALIFICADO — Avelloz Campina',
        '',
        `Contato: ${leadData.nome || 'Lead'} (${chatId})`,
        `Perfil: ${perfilNome}`,
        `Finalidade: ${leadData.finalidade || 'Não informado'}`,
        `Transporte hoje: ${leadData.transporteAtual || 'Não informado'}`,
        `Gasto atual: ${leadData.gastoMensal || 'Não informado'}`,
        `Situação de moto: ${leadData.situacaoMoto || 'Não informado'}`,
        `Modelo de interesse: ${leadData.modeloInteresse || 'Não informado'}`,
        `Forma de pagamento: ${leadData.formaPagamento || 'Não informado'}`,
        `Loja escolhida: ${leadData.loja || 'Não informada'}`,
        '',
        'Dados p/ simulação:',
        `  Nome completo: ${leadData.nomeCompleto || 'Não informado'}`,
        `  CPF: ${leadData.cpf || 'Não informado'}`,
        `  Nascimento: ${leadData.dataNascimento || 'Não informado'}`,
        `  Telefone: ${leadData.telefone || 'Não informado'}`,
        `  CNH: ${leadData.cnh || 'Não informado'}`,
        `  Cor/modelo: ${leadData.corModelo || 'Não informado'}`,
        '',
        `➡️ Transferir para o departamento ${departamento}${exp.aberto ? '' : ' [FORA DE EXPEDIENTE — AGENDAR RETORNO]'}`
    ].filter(l => l !== null).join('\n');
}

async function turno(texto) {
    const proximoAntes = determinarProximoCampo(leadData);
    const hist = leadData.conversationHistory.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
    const extraido = await extrair(texto, proximoAntes?.campo, hist.slice(-4));
    leadData.objecaoAtiva = null;
    leadData.perguntouAgora = null;
    registrarPedidoPreco(leadData, texto, extraido);
    if (extraido) {
        aplicarCampos(leadData, extraido);
        if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
        if (extraido.perguntou) leadData.perguntouAgora = true;
        if (!leadData.perfilKey) {
            leadData.perfilKey = detectarPerfil([extraido.finalidade, extraido.transporteAtual, extraido.situacaoMoto, texto].filter(Boolean).join(' '));
        }
    }
    const proximoDepois = determinarProximoCampo(leadData);
    const resposta = await responder(texto, proximoDepois, hist);
    leadData.conversationHistory.push({ role: 'user', content: texto });
    leadData.conversationHistory.push({ role: 'assistant', content: resposta });
    return resposta;
}

(async () => {
    console.log('\n════════ SIMULAÇÃO — Qualificação de lead (motoboy / moto alugada) ════════');
    console.log(exp.aberto
        ? '   Modo: EXPEDIENTE — transfere ao vivo\n'
        : `   Modo: PLANTÃO (${exp.motivo}) — encaminha e sugere retorno para ${exp.proximoExpediente}\n`);
    for (const msg of ROTEIRO) {
        console.log('CLIENTE > ' + msg);
        const resp = await turno(msg);
        console.log('BOT     > ' + resp + '\n');
        // Finaliza quando a qualificação está completa (loja identificada)
        if (leadData.qualificacaoCompleta && !leadData.finalizado) {
            leadData.finalizado = true;
        }
        if (leadData.finalizado) {
            console.log('──────── ✅ FINALIZADO — resumo enviado à equipe ────────\n');
            console.log(resumoEquipe());
            console.log('\n(no CRM: nota interna no ticket + WhatsApp p/ EQUIPE_NUMERO)\n');
            break;
        }
    }
    const custo = (tokensEntrada * 0.15 / 1e6) + (tokensSaida * 0.60 / 1e6);
    console.log('──────── custo desta conversa ────────');
    console.log(`tokens: ${tokensEntrada} entrada + ${tokensSaida} saída | ~US$ ${custo.toFixed(4)}`);
})().catch(e => console.error('ERR', e.message));
