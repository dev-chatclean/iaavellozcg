// =============================================================
//  CONVERSA COM A IA
//
//  A cola entre o prompt e o adapter. Cada funcao aqui faz tres coisas, e so
//  essas tres: sanitiza a entrada do cliente, monta o prompt e chama o
//  adapter — decidindo, quando falha, se cai em fallback ou devolve nada.
//
//  Essa decisao e a razao de o modulo existir. Os adapters nao tratam erro de
//  proposito: cair em texto de desculpa e escolha de produto, nao de
//  transporte, e cada uma das quatro chamadas escolhe diferente:
//
//    extrair  -> null      (o turno segue sem os campos novos)
//    redigir  -> LANCA     (quem chama decide; sem resposta nao ha turno)
//    visao    -> null      (a IA responde sem ter visto a imagem)
//    posHand. -> fallback  (o cliente ja foi transferido; qualquer texto serve)
// =============================================================

/** Limite de texto do cliente que entra no prompt, por chamada. */
const LIMITE_DA_MENSAGEM = 1000;

/**
 * Remove os sinais que delimitam blocos em muitos prompts e corta o tamanho.
 * Nao e sanitizacao completa contra prompt injection — e a barreira barata que
 * existe hoje. O resto da defesa esta no SYSTEM_SDR.
 */
function sanitizar(texto, limite = LIMITE_DA_MENSAGEM) {
    return String(texto ?? '')
        .replace(/[<>]/g, '')
        .substring(0, limite);
}

/**
 * @param {object} deps
 * @param {{extrair: Function}} deps.extrator
 * @param {{redigir: Function}} deps.redator
 * @param {{descrever: Function}} deps.leitorDeImagem
 * @param {object} deps.prompts SYSTEM_SDR e os montadores de prompt
 */
function criar({ extrator, redator, leitorDeImagem, prompts }) {
    const { SYSTEM_SDR, promptExtracao, promptResposta, promptVisao, promptPosEncaminhamento } = prompts;

    const FALLBACK_POS_HANDOFF =
        'Já repassei tudo pro nosso consultor, ele continua seu atendimento aqui rapidinho \u{1F60A}';

    /** Le os campos do funil na fala do cliente. null quando nao deu. */
    async function extrair(mensagem, campoAtual, historicoRecente = []) {
        try {
            const prompt = promptExtracao({ mensagemSanitizada: sanitizar(mensagem), campoAtual });
            return await extrator.extrair({ prompt, historico: historicoRecente });
        } catch (e) {
            console.error('Erro ao extrair informações:', e.message);
            return null;
        }
    }

    /**
     * Escreve a resposta ao cliente. NAO trata erro: sem resposta nao ha turno,
     * e quem chama e que sabe se cabe um texto de desculpa ali.
     */
    async function redigir(leadData, mensagemCliente, proximoCampo, historicoRecente = [], expediente = null) {
        const prompt = promptResposta({
            isInicioConversa: leadData.conversationHistory.length === 0,
            mensagemSanitizada: sanitizar(mensagemCliente),
            proximoCampo,
            leadData,
            expediente
        });
        return await redator.redigir({
            system: SYSTEM_SDR,
            prompt,
            historico: historicoRecente,
            temperatura: 0.7
        });
    }

    /** Descreve a imagem. null quando nao deu — a IA responde sem ter visto. */
    async function descreverImagem(mediaUrl) {
        if (!mediaUrl) return null;
        try {
            return await leitorDeImagem.descrever({ instrucao: promptVisao(), url: mediaUrl });
        } catch (e) {
            console.error('\u{274C} Erro ao analisar imagem (visão):', e.message);
            return null;
        }
    }

    /**
     * Resposta depois de o lead ja ter sido entregue ao consultor. Sempre
     * devolve texto: o cliente esta esperando alguem, e silencio aqui parece
     * abandono.
     */
    async function redigirPosEncaminhamento(leadData, mensagemCliente, historicoRecente = []) {
        try {
            const texto = await redator.redigir({
                system: 'Você é um consultor do time da Avelloz Campina. Escrita natural, curta, registro de WhatsApp.',
                prompt: promptPosEncaminhamento({ mensagemCliente }),
                historico: historicoRecente,
                temperatura: 0.6
            });
            return texto || FALLBACK_POS_HANDOFF;
        } catch (e) {
            console.error('\u{274C} Erro na resposta pós-encaminhamento:', e.message);
            return FALLBACK_POS_HANDOFF;
        }
    }

    return { extrair, redigir, descreverImagem, redigirPosEncaminhamento, FALLBACK_POS_HANDOFF };
}

module.exports = { criar, sanitizar, LIMITE_DA_MENSAGEM };
