// =============================================================
//  LEITOR DE IMAGEM — a IA "enxerga" o que o cliente mandou
//
//  Modelo diferente do resto (gpt-4o, com visao) e mais caro por chamada, por
//  isso o teto de tokens. Temperatura baixa: descrever, nao imaginar.
//
//  Recebe a URL da midia, nao os bytes: quem baixa a imagem e o proprio
//  provedor.
// =============================================================

const MODELO_PADRAO = 'gpt-4o';
const MAX_TOKENS = 300;
const TEMPERATURA = 0.3;

/**
 * @param {object} deps
 * @param {any} deps.cliente cliente da OpenAI (injetado)
 * @param {string} [deps.modelo]
 */
function criar({ cliente, modelo = MODELO_PADRAO }) {
    /**
     * @param {{instrucao: string, url: string}} entrada
     * @returns {Promise<string>} a descricao, ja aparada
     * @throws se a chamada falhar
     */
    async function descrever({ instrucao, url }) {
        const completion = await cliente.chat.completions.create({
            model: modelo,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: instrucao },
                        { type: 'image_url', image_url: { url } }
                    ]
                }
            ],
            max_tokens: MAX_TOKENS,
            temperature: TEMPERATURA
        });
        return completion.choices[0].message.content.trim();
    }

    return { descrever };
}

module.exports = { criar, MODELO_PADRAO, MAX_TOKENS, TEMPERATURA };
