// =============================================================
//  IA — camada única de chamada ao modelo (OpenAI Responses API).
//  Usada pelo servidor (index.js) e pelos testers (test-chat.js,
//  sim-lead.js), para todos rodarem com o mesmo modelo e parâmetros.
//
//  Modelo: gpt-6-luna com raciocínio (reasoning.effort). Modelo de
//  raciocínio não aceita temperature/top_p: quem controla a qualidade
//  é o esforço de raciocínio. Por que a Responses API e não Chat
//  Completions: é a recomendada pela OpenAI para modelos de raciocínio
//  e é onde o JSON Schema estrito da extração funciona junto com eles.
//
//  Variáveis (.env):
//    OPENAI_MODEL                       padrão gpt-6-luna
//    OPENAI_REASONING_EFFORT            padrão max (none|low|medium|high|xhigh|max)
//    OPENAI_REASONING_EFFORT_EXTRACAO   padrão = OPENAI_REASONING_EFFORT
//    OPENAI_TIMEOUT_MS                  padrão 120000 (por chamada)
// =============================================================

const MODELO = process.env.OPENAI_MODEL || 'gpt-6-luna';
const ESFORCO = process.env.OPENAI_REASONING_EFFORT || 'max';
const ESFORCO_EXTRACAO = process.env.OPENAI_REASONING_EFFORT_EXTRACAO || ESFORCO;
const TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '120000', 10);

// Uma chamada ao modelo. `mensagens` segue o formato da Responses API:
// [{ role: 'user' | 'assistant' | 'developer', content }].
// `schema` ({ name, schema }) liga a saída em JSON Schema estrito.
// store: false — a conversa tem CPF, telefone e nome do cliente (LGPD): não fica
// guardada na OpenAI para consulta posterior.
// Sem retentativa automática: com raciocínio no máximo uma chamada pode levar
// dezenas de segundos, e repetir em silêncio deixaria o cliente sem resposta por
// minutos. Quem chama já tem o fallback para a falha.
async function chamarModelo(openai, { instrucoes, mensagens, esforco = ESFORCO, schema }) {
    const resposta = await openai.responses.create({
        model: MODELO,
        reasoning: { effort: esforco },
        ...(instrucoes ? { instructions: instrucoes } : {}),
        input: mensagens,
        ...(schema ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } } : {}),
        store: false
    }, { timeout: TIMEOUT_MS, maxRetries: 0 });

    if (resposta.status === 'incomplete') {
        throw new Error(`resposta incompleta do modelo (${resposta.incomplete_details?.reason || 'motivo não informado'})`);
    }
    const texto = (resposta.output_text || '').trim();
    if (!texto) throw new Error('o modelo não devolveu texto');
    return { texto, uso: resposta.usage || {} };
}

// Converte o histórico salvo ({ role, content }) para mensagens do modelo.
function mensagensDoHistorico(historico) {
    return historico.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
}

module.exports = { chamarModelo, mensagensDoHistorico, MODELO, ESFORCO, ESFORCO_EXTRACAO, TIMEOUT_MS };
