// =============================================================
//  REGRESSÃO — nome dos modelos (sem OpenAI, determinístico).
//  Reproduz o print em que a IA mandou "AV1 (50cc)" pro cliente: o
//  modelo troca o Z por V puxado por "Avelloz". A correção roda na
//  geração e no envio, então o nome errado não chega ao cliente.
//
//  Rodar:  node test-nomes.js   (ou: npm run test:nomes)
// =============================================================

const assert = require('assert');
const { corrigirNomeModelo, corrigirPrecoEmplacamento, detectarModeloMencionado } = require('./flow');

let passou = 0;
function ok(titulo, fn) {
    try {
        fn();
        console.log(`✅ ${titulo}`);
        passou++;
    } catch (e) {
        console.error(`❌ ${titulo}\n   ${e.message}`);
        process.exitCode = 1;
    }
}

ok('print: "AV1 (50cc)" vira AZ1', () => {
    const print = 'Opa, Waldiclecia! Aqui na Avelloz, temos três modelos incríveis: AV1 (50cc): Super econômica, ideal pra cidade.';
    assert.strictEqual(
        corrigirNomeModelo(print),
        'Opa, Waldiclecia! Aqui na Avelloz, temos três modelos incríveis: AZ1 (50cc): Super econômica, ideal pra cidade.'
    );
});

ok('AV125 e AVX160 também são corrigidos', () => {
    assert.strictEqual(corrigirNomeModelo('temos a AV125 ALFA e a AVX160'), 'temos a AZ125 ALFA e a AZX160');
});

ok('AZ160 (sem o X) vira AZX160', () => {
    assert.strictEqual(corrigirNomeModelo('a AZ160 é trail'), 'a AZX160 é trail');
});

ok('espaço e hífen viram a grafia oficial', () => {
    assert.strictEqual(corrigirNomeModelo('AZ 1, AZ-125 e AZX 160'), 'AZ1, AZ125 e AZX160');
});

ok('nome certo não é alterado', () => {
    const certo = 'A AZ1 faz 50km com 1L, a AZ125 tem injeção e a AZX160 é trail.';
    assert.strictEqual(corrigirNomeModelo(certo), certo);
});

ok('a marca Avelloz não é tocada', () => {
    const t = 'Aqui na Avelloz Campina a gente cuida de tudo.';
    assert.strictEqual(corrigirNomeModelo(t), t);
});

ok('não estraga palavra que contém o padrão', () => {
    const t = 'Chego às 10h, avenida 1 de maio, valor à vista.';
    assert.strictEqual(corrigirNomeModelo(t), t);
});

ok('AZ1 não engole o 125 (ordem dos padrões)', () => {
    assert.strictEqual(corrigirNomeModelo('quero a AV125'), 'quero a AZ125');
});

ok('detecção de modelo entende o nome errado', () => {
    assert.strictEqual(detectarModeloMencionado('vi que a AV1 é econômica'), 'AZ1');
    assert.strictEqual(detectarModeloMencionado('gostei da AVX160'), 'AZX160');
    assert.strictEqual(detectarModeloMencionado('nenhum modelo aqui'), null);
});

// -------------------------------------------------------------
//  PREÇO DA AZX160 — o emplacamento é cobrado à parte. A IA mandou
//  "R$ 19.990,00 já com o emplacamento incluso", R$ 1.000,00 a menos
//  do que a moto emplacada custa.
// -------------------------------------------------------------
const CERTO = 'A AZX160 está R$ 19.990,00 sem o emplacamento e R$ 20.990,00 com o emplacamento incluso';

ok('print: "19.990,00 já com o emplacamento incluso" é corrigido', () => {
    const print = 'A AZX160 está com preço promocional de R$ 19.990,00 já com o emplacamento incluso. Agora, me passa os dados pra eu adiantar sua simulação com o consultor!';
    assert.strictEqual(
        corrigirPrecoEmplacamento(print),
        `${CERTO}. Agora, me passa os dados pra eu adiantar sua simulação com o consultor!`
    );
});

ok('erro invertido (20.990 sem emplacamento) também é corrigido', () => {
    assert.strictEqual(corrigirPrecoEmplacamento('Ela sai por R$ 20.990,00 sem o emplacamento.'), `${CERTO}.`);
});

ok('frase certa com os dois valores não é tocada', () => {
    const t = 'A AZX160 está R$ 19.990,00 sem o emplacamento e R$ 20.990,00 com o emplacamento incluso. Qual cor você prefere?';
    assert.strictEqual(corrigirPrecoEmplacamento(t), t);
});

ok('preço da AZ1/AZ125 com emplacamento incluso continua igual', () => {
    const t = 'A AZ1 está com preço promocional de R$ 11.390,00 já com o emplacamento incluso. Gostou?';
    assert.strictEqual(corrigirPrecoEmplacamento(t), t);
});

ok('só o valor, sem falar de emplacamento, não é alterado', () => {
    const t = 'A AZX160 está R$ 19.990,00. Quer conhecer na loja?';
    assert.strictEqual(corrigirPrecoEmplacamento(t), t);
});

ok('corrige só a frase errada e preserva o resto da mensagem', () => {
    const t = 'Boa escolha! A AZX160 sai por R$ 19.990,00 com emplacamento incluso. Qual unidade fica melhor pra você?';
    assert.strictEqual(corrigirPrecoEmplacamento(t), `Boa escolha! ${CERTO}. Qual unidade fica melhor pra você?`);
});

console.log(`\n${passou}/15 passaram`);
