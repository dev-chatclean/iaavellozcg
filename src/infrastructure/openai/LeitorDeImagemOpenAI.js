// =============================================================
//  LEITOR DE IMAGEM — OpenAI Vision (SPEC 0004)
//
//  Implementa a porta LeitorDeImagem. Extraído de index.js: analisarImagem,
//  sem alteração: mesmo modelo, mesma instrução, mesmos limites e o mesmo
//  `null` quando falha.
// =============================================================

const MODELO = 'gpt-4o';

const INSTRUCAO = `Você é atendente da Avelloz Campina (concessionária de motos). O cliente enviou esta imagem no WhatsApp durante o atendimento. Descreva de forma curta e útil (1 a 3 frases, tom natural, SEM markdown) o que é e o que há de relevante para entender a necessidade dele:
- Se for uma foto de moto (dele ou de um modelo), diga o que dá pra entender (modelo/estado/cor, se dá pra saber).
- Se for um PRINT de conversa, anúncio ou simulação, resuma do que se trata.
- Se for um documento (CNH, comprovante, print de dados), diga o que é sem transcrever dados sensíveis.
Não invente o que não dá pra ver.`;

function criar({ cliente }) {
    return {
        async descrever(url) {
            if (!url) return null;
            try {
                const completion = await cliente.chat.completions.create({
                    model: MODELO,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: INSTRUCAO },
                                { type: 'image_url', image_url: { url } }
                            ]
                        }
                    ],
                    max_tokens: 300,
                    temperature: 0.3
                });
                return completion.choices[0].message.content.trim();
            } catch (e) {
                console.error('❌ Erro ao analisar imagem (visão):', e.message);
                return null;
            }
        }
    };
}

module.exports = { criar };
