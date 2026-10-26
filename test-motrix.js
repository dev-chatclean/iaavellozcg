// =============================================================
//  REGRESSÃO — financiamento Motrix (sem OpenAI, determinístico).
//  Reproduz o print de 13/10/2026: "Como funciona o financiamento
//  Motrix?" recebeu "Desculpe, mas não consigo ajudar com isso". O
//  fluxo certo é apresentar a Motrix e pedir o CPF, perguntar só a
//  unidade e transferir.
//
//  Rodar:  node test-motrix.js   (ou: npm run test:motrix)
// =============================================================

const assert = require('assert');
const { etapaMotrix, extrairCpf, cpfValido, aplicarCampos, determinarProximoCampo } = require('./flow');
const { promptResposta, SYSTEM_SDR } = require('./prompts');

const CPF = '52998224725';

const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

caso('print: a pergunta do anúncio apresenta a Motrix e pede o CPF', () => {
    const lead = { conversationHistory: [] };
    assert.deepStrictEqual(etapaMotrix(lead, 'Como funciona o financiamento Motrix?'), { acao: 'apresentar' });
    assert.strictEqual(lead.formaPagamento, 'financiamento');
});

caso('CPF recebido: pede só a unidade e liga o atalho (sem diagnóstico)', () => {
    const lead = { conversationHistory: [] };
    etapaMotrix(lead, 'Como funciona o financiamento Motrix?');
    assert.deepStrictEqual(etapaMotrix(lead, '529.982.247-25'), { acao: 'pedirUnidade' });
    assert.strictEqual(lead.cpf, CPF);
    const prox = determinarProximoCampo(lead);
    assert.strictEqual(prox.campo, 'loja', 'depois do CPF o único dado que falta é a loja');
});

caso('loja escolhida depois do CPF fecha a qualificação (transfere)', () => {
    const lead = { conversationHistory: [] };
    etapaMotrix(lead, 'financiamento motrix');
    etapaMotrix(lead, `meu cpf é ${CPF}`);
    assert.strictEqual(etapaMotrix(lead, 'Malvinas'), null, 'depois do CPF o fluxo Motrix sai de cena');
    aplicarCampos(lead, { loja: 'Malvinas' }, 'Malvinas');
    assert.strictEqual(determinarProximoCampo(lead), null);
    assert.ok(lead.qualificacaoCompleta);
});

caso('CPF junto com a loja na mesma mensagem: encaminha direto', () => {
    const lead = { conversationHistory: [], loja: 'Matriz' };
    assert.deepStrictEqual(etapaMotrix(lead, `Quero o financiamento Motrix, CPF ${CPF}`), { acao: 'encaminhar' });
});

caso('telefone com DDD não é confundido com CPF', () => {
    assert.ok(!cpfValido('83999998888'));
    assert.strictEqual(extrairCpf('meu zap é 83999998888'), null);
    assert.strictEqual(extrairCpf('cpf 529 982 247 25'), CPF);
});

caso('CPF com dígito errado pede para conferir', () => {
    const lead = { conversationHistory: [] };
    etapaMotrix(lead, 'Motrix?');
    assert.deepStrictEqual(etapaMotrix(lead, '529.982.247-26'), { acao: 'cpfInvalido' });
    assert.ok(!lead.cpf);
});

caso('sem CPF: pede de novo uma vez e depois volta ao fluxo normal', () => {
    const lead = { conversationHistory: [] };
    etapaMotrix(lead, 'Como funciona o financiamento Motrix?');
    assert.deepStrictEqual(etapaMotrix(lead, 'precisa de entrada?'), { acao: 'responderEPedirCpf' });
    assert.strictEqual(etapaMotrix(lead, 'quais motos vocês têm?'), null);
    assert.ok(!lead.modoAtalho, 'sem CPF não pula o diagnóstico');
    assert.strictEqual(determinarProximoCampo(lead).campo, 'finalidade');
});

caso('quem não cita a Motrix segue o fluxo de sempre', () => {
    const lead = { conversationHistory: [] };
    assert.strictEqual(etapaMotrix(lead, 'Oi, quero uma moto'), null);
    assert.ok(!lead.motrix);
});

caso('prompt: pedido de CPF substitui o diagnóstico e proíbe emoji', () => {
    const p = promptResposta({ isInicioConversa: false, mensagemSanitizada: 'precisa de entrada?', proximoCampo: { campo: 'finalidade', pergunta: 'PERGUNTA-DE-FINALIDADE' }, leadData: { conversationHistory: [], pedirCpfMotrix: true, perguntouAgora: true } });
    assert.ok(p.includes('FINANCIAMENTO MOTRIX'));
    assert.ok(!p.includes('PERGUNTA-DE-FINALIDADE') && !p.includes('O CLIENTE FEZ UMA PERGUNTA'));
    assert.ok(!p.includes('o DIAGNÓSTICO ainda NÃO terminou'));
    assert.ok(p.includes('NÃO use emoji'));
});

caso('system prompt conhece a Motrix', () => {
    assert.ok(/MOTRIX: é um dos bancos/.test(SYSTEM_SDR));
});

let falhas = 0;
for (const [nome, fn] of casos) {
    try { fn(); console.log(`✅ ${nome}`); }
    catch (e) { falhas++; console.log(`❌ ${nome}\n   ${e.message}`); }
}
console.log(`\n${casos.length - falhas}/${casos.length} casos ok`);
process.exit(falhas ? 1 : 0);
