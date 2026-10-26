// =============================================================
//  REGRESSÃO — loja inventada pela extração (sem OpenAI, determinístico).
//  Reproduz o print de 10/2026: a cliente disse "Quero saber o valor!
//  Entenda eu tenho ele a vista aq por isso já busco a moto pra comprar",
//  a extração devolveu loja "Monteiro" e a IA transferiu para a Loja
//  Monteiro uma cliente de Campina Grande. A loja só pode ser aceita
//  quando o cliente cita a unidade na própria fala.
//
//  Rodar:  node test-loja.js   (ou: npm run test:loja)
// =============================================================

const assert = require('assert');
const { aplicarCampos } = require('./flow');
const { lojaMencionada } = require('./data');

const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

// Simula uma extração que devolveu `loja` para a fala `texto`.
function lojaDepois(texto, lojaExtraida, leadInicial = {}) {
    const lead = { ...leadInicial };
    console.warn = () => {}; // o descarte é logado; aqui não interessa
    aplicarCampos(lead, { loja: lojaExtraida }, texto);
    return lead.loja;
}

caso('print: "Quero saber o valor!..." não vira loja Monteiro', () => {
    assert.strictEqual(lojaDepois('Quero saber o valor! Entenda eu tenho ele a vista aq por isso já busco a moto pra comprar', 'Monteiro'), undefined);
});

caso('"Mas eu moro em Campina" não escolhe loja nenhuma', () => {
    assert.strictEqual(lojaDepois('Mas eu moro em Campina', 'Monteiro'), undefined);
    assert.strictEqual(lojaDepois('Mas eu moro em Campina', 'Matriz'), undefined);
});

caso('"Essa não é a Malvinas aq no bairro não?" escolhe a Malvinas', () => {
    assert.strictEqual(lojaDepois('Essa não é a Malvinas aq no bairro não?', 'Malvinas'), 'Malvinas');
});

caso('loja inventada não apaga a loja que o cliente já tinha escolhido', () => {
    assert.strictEqual(lojaDepois('pode ser no financiamento', 'Monteiro', { loja: 'Malvinas' }), 'Malvinas');
});

caso('escolha explícita é aceita (nome, bairro ou rua)', () => {
    assert.strictEqual(lojaDepois('pode ser na loja Malvinas', 'Malvinas'), 'Malvinas');
    assert.strictEqual(lojaDepois('prefiro Monteiro, é mais perto', 'Monteiro'), 'Monteiro');
    assert.strictEqual(lojaDepois('a do centro', 'Matriz'), 'Matriz');
    assert.strictEqual(lojaDepois('a da João Suassuna', 'Matriz'), 'Matriz');
    assert.strictEqual(lojaDepois('a de Rocha Cavalcante', 'Malvinas'), 'Malvinas');
});

caso('"não quero Monteiro, prefiro a Malvinas": vale a loja que a extração escolheu, se citada', () => {
    assert.strictEqual(lojaDepois('não quero Monteiro, prefiro a Malvinas', 'Malvinas'), 'Malvinas');
    assert.strictEqual(lojaDepois('prefiro Monteiro, não a Malvinas', 'Monteiro'), 'Monteiro');
});

caso('troca de loja citada pelo cliente substitui a anterior', () => {
    assert.strictEqual(lojaDepois('na verdade quero a Matriz', 'Matriz', { loja: 'Monteiro' }), 'Matriz');
});

caso('sem a fala do cliente, nenhuma loja é aceita', () => {
    assert.strictEqual(lojaDepois(undefined, 'Monteiro'), undefined);
    assert.strictEqual(lojaMencionada('', 'Matriz'), false);
});

let falhas = 0;
const warnOriginal = console.warn;
for (const [nome, fn] of casos) {
    try { fn(); console.log('✅ ' + nome); }
    catch (e) { falhas++; console.log('❌ ' + nome + '\n   ' + e.message); }
}
console.warn = warnOriginal;
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
