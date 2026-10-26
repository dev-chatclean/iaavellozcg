// =============================================================
//  REGRESSÃO — nome dos modelos (sem OpenAI, determinístico).
//  Reproduz o print em que a IA mandou "AV1 (50cc)" pro cliente: o
//  modelo troca o Z por V puxado por "Avelloz". A correção roda na
//  geração e no envio, então o nome errado não chega ao cliente.
//
//  Rodar:  node test-nomes.js   (ou: npm run test:nomes)
// =============================================================

const assert = require('assert');
const { corrigirNomeModelo, detectarModeloMencionado } = require('./flow');

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

ok('AZ170: AV170, AZ 170 e AZX170 viram AZ170, e o AZ1 não casa dentro dela', () => {
    assert.strictEqual(corrigirNomeModelo('a AV170, a AZ 170 e a AZX170 Bravo'), 'a AZ170, a AZ170 e a AZ170 Bravo');
    assert.strictEqual(corrigirNomeModelo('A AZ170 Bravo é lançamento'), 'A AZ170 Bravo é lançamento');
});

ok('detecção da AZ170 pelo código ou pelo nome Bravo (maiúsculo)', () => {
    assert.strictEqual(detectarModeloMencionado('a AZ170 tem 18,3 cv'), 'AZ170');
    assert.strictEqual(detectarModeloMencionado('A Bravo faz até 40 km/L'), 'AZ170');
    assert.strictEqual(detectarModeloMencionado('fiquei bravo com a demora'), null);
});

const total = 11;
console.log(`\n${passou}/${total} passaram`);
