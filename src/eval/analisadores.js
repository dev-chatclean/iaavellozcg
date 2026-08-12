// =============================================================
//  ANALISADORES DE CONVERSA (SPEC 0011)
//
//  Funcoes puras que inspecionam uma resposta do bot e dizem se ela violou
//  uma regra. Sao o INSTRUMENTO DE MEDIDA das regras que ate aqui so
//  existiam como instrucao no prompt.
//
//  A diferenca importa: os testes garantem que a instrucao CHEGA ao modelo;
//  estes analisadores medem se o modelo OBEDECEU. So um deles pode dizer se
//  o vazamento de preco antes do diagnostico e mesmo 0%.
//
//  Uso previsto: suite de evals (npm run eval). Ligar isto em producao, para
//  alertar quando uma resposta viola RN-001, e uma mudanca de comportamento
//  e tem spec propria (sugestao P5 do backlog).
//
//  Modulo puro: sem I/O, sem process.env.
// =============================================================

const NOMES_DE_MODELO = ['AZ1', 'AZ125', 'AZX160'];

// Valor em reais: "R$ 11.390,00", "R$ 11390", "11.390 reais".
const VALOR_EM_REAIS = /(R\$\s*[\d.,]+)|(\b\d{1,3}(\.\d{3})+(,\d{2})?\s*reais\b)/i;

// Mencao a modelo como PRODUTO. Evita falso positivo quando o proprio
// cliente citou o nome e o bot so repete a pergunta dele.
function mencionaModelo(texto) {
    const t = String(texto || '');
    return NOMES_DE_MODELO.filter((nome) => new RegExp(`\\b${nome}\\b`, 'i').test(t));
}

function mencionaValor(texto) {
    return VALOR_EM_REAIS.test(String(texto || ''));
}

/**
 * RN-001 — vazou informacao de produto antes do diagnostico?
 * So faz sentido perguntar quando o diagnostico esta incompleto.
 * @returns {{violou: boolean, evidencias: string[]}}
 */
function vazouProduto(texto, { diagnosticoCompleto }) {
    if (diagnosticoCompleto) return { violou: false, evidencias: [] };

    const evidencias = [];
    const modelos = mencionaModelo(texto);
    if (modelos.length) evidencias.push(`citou modelo: ${modelos.join(', ')}`);
    if (mencionaValor(texto)) evidencias.push('informou valor em reais');

    return { violou: evidencias.length > 0, evidencias };
}

// RN-020 — revelou ser IA, bot ou assistente virtual?
const MARCAS_DE_IA = [
    'sou uma ia',
    'sou uma inteligência artificial',
    'sou uma inteligencia artificial',
    'sou um bot',
    'sou um robô',
    'sou um robo',
    'assistente virtual',
    'chatgpt',
    'modelo de linguagem',
    'fui treinado',
    'como uma ia',
    'openai'
];

function revelouSerIa(texto) {
    const t = String(texto || '').toLowerCase();
    const evidencias = MARCAS_DE_IA.filter((marca) => t.includes(marca));
    return { violou: evidencias.length > 0, evidencias };
}

// RN-010 — informou valor de parcela?
// "12x de R$ 300", "parcela de 300", "fica em 300 por mes".
// Cada padrao exige um DIGITO no valor (`\d[\d.,]*`), nao apenas `[\d.,]+`:
// com a versao permissiva, "em até 48x, dependendo do CPF" era acusado —
// a virgula depois do "48x" contava como valor. Falso positivo em metrica de
// regra bloqueante corroi a confianca no numero.
const PARCELA_COM_VALOR = [
    /\b\d{1,3}\s*x\s*(de\s*)?(R\$\s*)?\d[\d.,]*/i,
    /parcela[s]?\s+(de|em|fica[m]?\s+em)\s*(R\$\s*)?\d[\d.,]*/i,
    /(R\$\s*\d[\d.,]*)\s*(por\s+m[eê]s|mensa(l|is))/i
];

function informouParcela(texto) {
    const t = String(texto || '');
    const evidencias = PARCELA_COM_VALOR.filter((re) => re.test(t)).map((re) => `padrão ${re.source}`);
    return { violou: evidencias.length > 0, evidencias };
}

// RN-021 — toda mensagem termina com uma pergunta.
function terminaComPergunta(texto) {
    const t = String(texto || '').trim();
    if (!t) return { violou: true, evidencias: ['mensagem vazia'] };
    // Aceita a interrogacao no fim, tolerando emoji ou aspas depois dela.
    const violou = !/\?["'”’)\s\p{Extended_Pictographic}]*$/u.test(t);
    return { violou, evidencias: violou ? [`termina com: "${t.slice(-40)}"`] : [] };
}

// RN-022 — sem markdown, no maximo 1 emoji.
function usouMarkdown(texto) {
    const t = String(texto || '');
    const evidencias = [];
    if (/\*\*[^*]+\*\*|\*[^*\n]+\*/.test(t)) evidencias.push('asteriscos');
    if (/^\s*[-*]\s+/m.test(t)) evidencias.push('lista com traço');
    if (/^#{1,6}\s/m.test(t)) evidencias.push('título markdown');
    return { violou: evidencias.length > 0, evidencias };
}

function contarEmojis(texto) {
    return (String(texto || '').match(/\p{Extended_Pictographic}/gu) || []).length;
}

function excedeuEmojis(texto, limite = 1) {
    const total = contarEmojis(texto);
    return { violou: total > limite, evidencias: total > limite ? [`${total} emojis`] : [] };
}

/**
 * Roda todos os analisadores sobre uma resposta.
 * @param {string} texto
 * @param {object} contexto { diagnosticoCompleto }
 * @returns {{violacoes: Array<{regra: string, evidencias: string[]}>}}
 */
function analisar(texto, contexto = {}) {
    const checagens = [
        ['RN-001', vazouProduto(texto, contexto)],
        ['RN-010', informouParcela(texto)],
        ['RN-020', revelouSerIa(texto)],
        ['RN-021', terminaComPergunta(texto)],
        ['RN-022 (markdown)', usouMarkdown(texto)],
        ['RN-022 (emojis)', excedeuEmojis(texto)]
    ];

    return {
        violacoes: checagens
            .filter(([, r]) => r.violou)
            .map(([regra, r]) => ({ regra, evidencias: r.evidencias }))
    };
}

module.exports = {
    analisar,
    vazouProduto,
    revelouSerIa,
    informouParcela,
    terminaComPergunta,
    usouMarkdown,
    excedeuEmojis,
    contarEmojis,
    mencionaModelo,
    mencionaValor,
    NOMES_DE_MODELO
};
