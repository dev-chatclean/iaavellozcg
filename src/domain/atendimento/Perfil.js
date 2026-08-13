// =============================================================
//  PERFIL — a dor do lead (RN-005)
//
//  Classifica o lead num dos 8 perfis para escolher o GANCHO da abordagem.
//  A ordem importa: quem roda de aplicativo é reconhecido antes dos casos
//  genéricos, porque "rodo de uber com moto alugada" é primeiro um caso de
//  aluguel — o argumento é o valor que ele paga sem nunca ficar com a moto.
//
//  Extraído de flow.js na SPEC 0006, sem alteração de comportamento.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

// Ordem = precedência. Não reordene sem revisar RN-005.
const PALAVRAS_POR_PERFIL = Object.freeze([
    ['app_aluga', ['alug', 'aluguel', 'alugada', 'locada']],
    ['app_comecando', ['começando', 'comecando', 'vou começar', 'quero rodar', 'começar a rodar']],
    [
        'app_trocar',
        ['trocar a moto', 'trocar minha moto', 'moto velha', 'moto parada', 'manutenção cara', 'manutencao cara']
    ],
    ['esposa', ['esposa', 'minha mulher', 'namorada', 'pra ela', 'pra minha filha', 'pra minha esposa']],
    ['depende_uber', ['uber', '99', 'noventa e nove', 'aplicativo de transporte', 'indriver', 'táxi', 'taxi']],
    ['depende_onibus', ['ônibus', 'onibus', 'passagem', 'transporte público', 'transporte publico', 'busão', 'busao']],
    ['tem_carro', ['carro', 'meu carro', 'gasolina do carro', 'combustível do carro', 'estacionamento']],
    ['primeira_moto', ['primeira moto', 'nunca tive moto', 'nunca tive uma moto', 'minha primeira']]
]);

/**
 * @param {string} texto Fala do cliente e/ou campos já extraídos.
 * @returns {string|null} Chave do perfil, ou null quando não há sinal.
 */
function classificar(texto) {
    if (!texto) return null;
    const t = String(texto).toLowerCase();
    for (const entrada of PALAVRAS_POR_PERFIL) {
        const chave = /** @type {string} */ (entrada[0]);
        const palavras = /** @type {string[]} */ (entrada[1]);
        if (palavras.some((palavra) => t.includes(palavra))) return chave;
    }
    return null;
}

/**
 * Monta o texto que alimenta a classificação a partir do que se sabe do turno.
 * O texto bruto entra por último: os campos extraídos são sinal mais forte.
 * @param {import('./tipos').EstadoDoAtendimento} [campos]
 * @param {string} [textoBruto]
 */
function textoParaClassificar(campos = {}, textoBruto = '') {
    const { finalidade, transporteAtual, situacaoMoto } = campos;
    return [finalidade, transporteAtual, situacaoMoto, textoBruto].filter(Boolean).join(' ');
}

// Campos cuja correção invalida o perfil já classificado: se o cliente
// corrigiu como se locomove, o gancho da dor muda.
const CAMPOS_QUE_INVALIDAM = Object.freeze(['transporteAtual', 'situacaoMoto', 'finalidade']);

function precisaReclassificar(correcoes = []) {
    return CAMPOS_QUE_INVALIDAM.some((campo) => correcoes.includes(campo));
}

module.exports = { classificar, textoParaClassificar, precisaReclassificar, PALAVRAS_POR_PERFIL, CAMPOS_QUE_INVALIDAM };
