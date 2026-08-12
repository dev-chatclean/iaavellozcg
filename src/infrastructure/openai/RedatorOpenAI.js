// =============================================================
//  REDATOR — OpenAI (SPEC 0004)
//
//  Implementa a porta RedatorDeResposta. Extraído de index.js
//  (gerarRespostaIA e gerarRespostaPosEncaminhamento), sem alteração de
//  comportamento: mesmos modelos, temperaturas, prompts e fallbacks.
//
//  Observação: `redigir` propaga a exceção de propósito — quem chama decide
//  mandar a mensagem de instabilidade. Já `redigirAposTransbordo` devolve o
//  texto padrão, como o legado fazia.
// =============================================================

const { SYSTEM_SDR, promptResposta } = require('../../../prompts');

const MODELO = 'gpt-4o-mini';

const RESPOSTA_PADRAO_POS_TRANSBORDO =
    'Já repassei tudo pro nosso consultor, ele continua seu atendimento aqui rapidinho 😊 Se quiser adiantar algo, pode me contar que eu anoto pro time. Ficou alguma dúvida sobre a moto?';

function criar({ cliente }) {
    return {
        async redigir({ leadData, mensagemCliente, proximoCampo, historico = [], expediente = null }) {
            const mensagemSanitizada = mensagemCliente.replace(/[<>]/g, '').substring(0, 1000);
            const isInicioConversa = leadData.conversationHistory.length === 0;
            const prompt = promptResposta({ isInicioConversa, mensagemSanitizada, proximoCampo, leadData, expediente });
            const completion = await cliente.chat.completions.create({
                model: MODELO,
                messages: [
                    { role: 'system', content: SYSTEM_SDR },
                    ...historico,
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            });
            return completion.choices[0].message.content.trim();
        },

        async redigirAposTransbordo({ mensagemCliente, historico = [] }) {
            try {
                const prompt = `Este lead já foi ENCAMINHADO a um consultor humano da Avelloz Campina. Ele acabou de dizer: "${String(mensagemCliente).replace(/[<>]/g, '').substring(0, 600)}".
Responda de forma breve, calorosa e útil (registro de WhatsApp, sem markdown, no máximo 1 emoji), SEMPRE terminando com uma pergunta:
- Se for uma dúvida simples sobre as motos/condições, responda com o que você sabe.
- Se depender do consultor (valor de parcela, aprovação de crédito, prazo de entrega, negociação), diga que ele já vai continuar o atendimento pra resolver.
Nunca informe valor de parcela nem prometa prazo. Não refaça a qualificação e não repita o resumo.`;
                const completion = await cliente.chat.completions.create({
                    model: MODELO,
                    messages: [
                        {
                            role: 'system',
                            content:
                                'Você é um consultor do time da Avelloz Campina. Escrita natural, curta, registro de WhatsApp.'
                        },
                        ...historico,
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.6
                });
                return completion.choices[0].message.content.trim() || RESPOSTA_PADRAO_POS_TRANSBORDO;
            } catch (e) {
                console.error('❌ Erro na resposta pós-encaminhamento:', e.message);
                return RESPOSTA_PADRAO_POS_TRANSBORDO;
            }
        }
    };
}

module.exports = { criar, RESPOSTA_PADRAO_POS_TRANSBORDO };
