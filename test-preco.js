// =============================================================
//  REGRESSÃO — insistência no preço (sem OpenAI, determinístico).
//  Reproduz os prints em que a IA segurou o preço até o cliente ir
//  embora: o 1º pedido é redirecionado pro diagnóstico; o 2º pedido,
//  ou um "só quero saber o preço", libera o preço.
//
//  Rodar:  node test-preco.js   (ou: npm run test:preco)
// =============================================================

const assert = require('assert');
const { registrarPedidoPreco } = require('./flow');
const { promptResposta } = require('./prompts');

const LIBERADO = 'PREÇO LIBERADO';
const BLOQUEADO = 'o DIAGNÓSTICO ainda NÃO terminou';

// Simula os turnos do cliente. `extraido` imita a extração (null = extração
// falhou, sobra só o regex). Devolve o rodapé do prompt de cada turno.
function conversa(turnos, leadInicial = {}) {
    const leadData = { conversationHistory: [], ...leadInicial };
    return turnos.map(({ texto, extraido = null, bot = 'Me conta, como você se locomove hoje?' }) => {
        registrarPedidoPreco(leadData, texto, extraido);
        const prompt = promptResposta({ isInicioConversa: false, mensagemSanitizada: texto, proximoCampo: null, leadData });
        leadData.conversationHistory.push({ role: 'user', content: texto }, { role: 'assistant', content: bot });
        return prompt;
    });
}

const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

caso('print 2: "Qual é o preço?" duas vezes libera no 2º pedido', () => {
    const [p1, p2] = conversa([{ texto: 'Qual é o preço?' }, { texto: 'Qual é o preço?' }]);
    assert.ok(p1.includes(BLOQUEADO) && !p1.includes(LIBERADO), '1º pedido deveria ficar bloqueado');
    assert.ok(p2.includes(LIBERADO), '2º pedido deveria liberar');
    assert.ok(/11\.390/.test(p2) && /14\.390/.test(p2) && /20\.990/.test(p2) && !/19\.990/.test(p2) && !/14\.190/.test(p2) && !/13\.390/.test(p2), 'deveria passar os valores dos 3 modelos');
});

caso('print 1: "Só quero saber o preço" libera de cara', () => {
    const [p] = conversa([{ texto: 'Nao existe principal razao . So quero saber o preco' }]);
    assert.ok(p.includes(LIBERADO));
});

caso('extração pega pedido que o regex não pega ("me passa quanto tá")', () => {
    const [, p2] = conversa([
        { texto: 'oi, quanto tá?', extraido: { pediuPreco: true } },
        { texto: 'me passa aí', extraido: { pediuPreco: true } }
    ]);
    assert.ok(p2.includes(LIBERADO));
});

caso('pergunta de parcela não conta como pedido de preço', () => {
    const [, p2] = conversa([{ texto: 'qual o valor da parcela?' }, { texto: 'e a entrada, quanto é?' }]);
    assert.ok(!p2.includes(LIBERADO));
});

caso('depois de informado, não libera de novo e segue o diagnóstico', () => {
    const [, , p3] = conversa([
        { texto: 'qual o preço?' },
        { texto: 'qual o preço?', bot: 'A AZ1 está R$ 11.390,00, a AZ125 R$ 14.390,00 e a AZX160 R$ 20.990,00, todas já com emplacamento. Pra que você pretende usar a moto?' },
        { texto: 'pra trabalhar' }
    ]);
    assert.ok(!p3.includes(LIBERADO), 'não deveria liberar de novo');
    assert.ok(p3.includes('Você JÁ passou os preços'), 'deveria seguir o diagnóstico sem repetir');
});

caso('modo atalho (pressa): libera o preço e pergunta a loja', () => {
    const [, p2] = conversa([{ texto: 'qual o preço?' }, { texto: 'qual o preço?' }], { modoAtalho: true });
    assert.ok(p2.includes(LIBERADO) && p2.includes('Matriz, Malvinas e Monteiro'));
});

caso('diagnóstico completo: fluxo normal, sem o aviso de liberação', () => {
    const [, p2] = conversa([{ texto: 'qual o preço?' }, { texto: 'qual o preço?' }],
        { transporteAtual: 'uber', gastoMensal: '400', situacaoMoto: 'nao_tem' });
    assert.ok(!p2.includes(LIBERADO) && p2.includes('Diagnóstico mínimo OK'));
});

// --- Valor errado escrito pela IA (corrigirPreco) ---
const { corrigirPreco } = require('./flow');

caso('print 16/10: "O valor da AZ125 é R$ 12.390,00" vira o preço oficial', () => {
    assert.strictEqual(
        corrigirPreco('O valor da AZ125 é R$ 12.390,00. O consultor já vai continuar o atendimento!'),
        'O valor da AZ125 é R$ 14.390,00. O consultor já vai continuar o atendimento!');
});

caso('preço antigo de qualquer modelo é corrigido (14.190, 13.390 e 19.990)', () => {
    assert.strictEqual(corrigirPreco('A AZ125 sai por R$ 14.190,00'), 'A AZ125 sai por R$ 14.390,00');
    assert.strictEqual(corrigirPreco('a AZX160 está R$ 19990'), 'a AZX160 está R$ 20.990,00');
});

caso('print 19/10: AZ125 a R$ 13.390,00 (valor antigo) vira R$ 14.390,00', () => {
    assert.strictEqual(
        corrigirPreco('Uma opção que pode te atender bem é a AZ125, que tem um bom equilíbrio entre conforto e economia. Ela tá com preço promocional de R$ 13.390,00 já com emplacamento incluso.'),
        'Uma opção que pode te atender bem é a AZ125, que tem um bom equilíbrio entre conforto e economia. Ela tá com preço promocional de R$ 14.390,00 já com emplacamento incluso.');
});

caso('lista com os três valores: cada um fica com o do seu modelo', () => {
    const t = 'A AZ1 está R$ 11.390,00, a AZ125 R$ 14.390,00 e a AZX160 R$ 20.990,00.';
    assert.strictEqual(corrigirPreco(t), t);
});

caso('valor depois de outro modelo não é atribuído ao primeiro', () => {
    assert.strictEqual(corrigirPreco('Entre a AZ1 e a AZ125, que sai por R$ 14.390,00'), 'Entre a AZ1 e a AZ125, que sai por R$ 14.390,00');
});

caso('bonificação de indicação não é confundida com preço', () => {
    const t = 'Indicou e o amigo comprou a AZ125, você ganha R$ 100,00.';
    assert.strictEqual(corrigirPreco(t), t);
});

caso('detector de preço já informado reconhece os valores atuais', () => {
    const [, p2] = conversa([
        { texto: 'oi', bot: 'A AZX160 está R$ 20.990,00 já com emplacamento.' },
        { texto: 'legal' }
    ]);
    assert.ok(p2.includes('Você JÁ informou o preço'));
});

let falhas = 0;
for (const [nome, fn] of casos) {
    try { fn(); console.log('✅ ' + nome); }
    catch (e) { falhas++; console.log('❌ ' + nome + '\n   ' + e.message); }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
