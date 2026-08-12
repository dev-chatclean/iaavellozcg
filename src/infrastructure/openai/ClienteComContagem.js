// =============================================================
//  CLIENTE OPENAI COM CONTAGEM DE TOKENS (SPEC 0010)
//
//  Envolve o cliente da OpenAI acumulando o consumo de cada chamada, sem que
//  os adapters saibam disso — eles continuam recebendo um objeto com a mesma
//  forma (Decorator).
//
//  Serve ao `npm run sim`, que precisa reportar o custo da conversa. Antes
//  esse calculo vivia dentro do proprio tester, que por isso reimplementava o
//  turno em vez de usar o de producao.
// =============================================================

// Preco do gpt-4o-mini por milhao de tokens (USD), usado so para estimativa.
const PRECO_ENTRADA_POR_MILHAO = 0.15;
const PRECO_SAIDA_POR_MILHAO = 0.6;

function envolver(cliente) {
    const contagem = { entrada: 0, saida: 0, chamadas: 0 };

    function registrar(resposta) {
        contagem.chamadas += 1;
        if (resposta?.usage) {
            contagem.entrada += resposta.usage.prompt_tokens || 0;
            contagem.saida += resposta.usage.completion_tokens || 0;
        }
        return resposta;
    }

    const envolvido = {
        chat: {
            completions: {
                create: async (params) => registrar(await cliente.chat.completions.create(params))
            }
        },
        audio: {
            transcriptions: {
                create: async (params) => registrar(await cliente.audio.transcriptions.create(params))
            }
        }
    };

    contagem.custoEstimadoUsd = () =>
        (contagem.entrada * PRECO_ENTRADA_POR_MILHAO) / 1e6 + (contagem.saida * PRECO_SAIDA_POR_MILHAO) / 1e6;

    return { cliente: envolvido, contagem };
}

module.exports = { envolver, PRECO_ENTRADA_POR_MILHAO, PRECO_SAIDA_POR_MILHAO };
