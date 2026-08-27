// =============================================================
//  EXTRATOR — le a mensagem do cliente e devolve os campos do funil
//
//  Temperatura 0 e response_format json_object: aqui nao se quer criatividade,
//  se quer o MESMO JSON para a mesma entrada.
//
//  O adapter nao conhece o funil nem monta prompt: recebe o texto pronto e
//  devolve o objeto. Lida apenas com as manias do provedor — entre elas a de
//  cercar o JSON com ``` mesmo quando o formato exigido e JSON.
// =============================================================

const MODELO_PADRAO = 'gpt-4o-mini';

/**
 * @param {object} deps
 * @param {any} deps.cliente cliente da OpenAI (injetado)
 * @param {string} [deps.modelo]
 */
function criar({ cliente, modelo = MODELO_PADRAO }) {
    /**
     * @param {{prompt: string, historico?: Array<{role: string, content: string}>}} entrada
     * @returns {Promise<object>} o objeto extraido
     * @throws se a chamada falhar ou a resposta nao for JSON valido
     */
    async function extrair({ prompt, historico = [] }) {
        const completion = await cliente.chat.completions.create({
            model: modelo,
            messages: [...historico, { role: 'user', content: prompt }],
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        let res = completion.choices[0].message.content.trim();
        // O modelo as vezes cerca o JSON com ``` mesmo com response_format.
        if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
        return JSON.parse(res);
    }

    return { extrair };
}

module.exports = { criar, MODELO_PADRAO };
