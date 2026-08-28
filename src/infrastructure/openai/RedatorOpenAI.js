// =============================================================
//  REDATOR — escreve a mensagem que o cliente vai ler
//
//  Ao contrario do extrator, aqui a temperatura importa: o texto precisa soar
//  humano. Quem escolhe o valor e o chamador, porque a temperatura da resposta
//  ao lead (0.7) e a do pos-encaminhamento (0.6) sao decisoes de produto, nao
//  do adapter.
//
//  Nao trata erro: quem chama decide se cai em fallback ou propaga.
// =============================================================

const MODELO_PADRAO = 'gpt-4o-mini';

/**
 * @param {object} deps
 * @param {any} deps.cliente cliente da OpenAI (injetado)
 * @param {string} [deps.modelo]
 */
function criar({ cliente, modelo = MODELO_PADRAO }) {
    /**
     * @param {object} entrada
     * @param {string} entrada.system prompt de sistema (persona e regras)
     * @param {string} entrada.prompt instrucao do turno
     * @param {Array<{role: string, content: string}>} [entrada.historico]
     * @param {number} entrada.temperatura
     * @returns {Promise<string>} o texto, ja aparado
     */
    async function redigir({ system, prompt, historico = [], temperatura }) {
        const completion = await cliente.chat.completions.create({
            model: modelo,
            messages: [{ role: 'system', content: system }, ...historico, { role: 'user', content: prompt }],
            temperature: temperatura
        });
        return completion.choices[0].message.content.trim();
    }

    return { redigir };
}

module.exports = { criar, MODELO_PADRAO };
