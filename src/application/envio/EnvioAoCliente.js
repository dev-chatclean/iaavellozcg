// =============================================================
//  ENVIO AO CLIENTE
//
//  Como a resposta chega no WhatsApp. Duas decisoes de produto moram aqui:
//
//  1. QUEBRA EM PARTES. Uma resposta longa num balao so nao parece conversa.
//     O texto e quebrado por linha e enviado em mensagens curtas.
//
//  2. ATRASO DE DIGITACAO. Entre uma parte e outra ha uma pausa proporcional
//     ao tamanho do texto, para nao chegarem tres mensagens no mesmo segundo.
//
//  As duas tem divida documentada — ver os comentarios CONGELA abaixo.
//
//  O canal e o relogio entram por parametro: assim o teste nao espera de
//  verdade, e o modulo nao conhece o ChatClean.
// =============================================================

/**
 * CONGELA (D-08) — a decisao de NAO quebrar usa palavras comuns do dominio.
 *
 * A intencao era: resumo e encaminhamento vao inteiros, num balao so. Mas
 * "consultor" e "especialista" aparecem em respostas COMUNS o tempo todo
 * ("nosso consultor fecha a condicao com voce"), e qualquer uma delas passa a
 * ser enviada sem quebra.
 *
 * Na pratica, uma parte das respostas normais chega num balao unico e longo —
 * exatamente o que a quebra existe para evitar. Corrigir muda o formato de
 * mensagens que ja saem assim hoje; fica como divida.
 */
const NAO_QUEBRAR = /encaminhando|consultor|especialista|resumo|repassando/i;

/** Atraso base e por caractere, imitando digitacao humana. */
const ATRASO_BASE_MS = 900;
const ATRASO_POR_CARACTERE_MS = 18;

const esperaReal = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} deps
 * @param {{enviar: (numero: string, payload: object) => Promise<{ok: boolean}>}} deps.canal
 * @param {(ms: number) => Promise<void>} [deps.esperar]
 */
function criar({ canal, esperar = esperaReal }) {
    /**
     * Envia uma mensagem. Texto vazio nao vira mensagem — sem isso, uma falha
     * silenciosa na redacao produziria um balao em branco para o cliente.
     *
     * @returns {Promise<boolean>} se o canal aceitou
     */
    async function enviar(chatId, texto) {
        if (!texto || !String(texto).trim()) return false;
        return (await canal.enviar(chatId, { body: texto })).ok;
    }

    /**
     * Envia a resposta quebrada em mensagens curtas, com pausa entre elas.
     *
     * CONGELA (D-25): a pausa acontece DENTRO do lock do turno. Uma resposta de
     * cinco linhas segura o atendimento por varios segundos, e mensagens que
     * chegarem nesse intervalo esperam na fila. O certo seria soltar o lock
     * antes de digitar — mas isso muda a ordem de gravacao do estado.
     */
    async function enviarEmPartes(chatId, textoCompleto) {
        if (NAO_QUEBRAR.test(textoCompleto)) {
            await enviar(chatId, textoCompleto);
            return;
        }

        const partes = String(textoCompleto)
            .split('\n')
            .filter((p) => p.trim());

        for (const parte of partes) {
            await esperar(ATRASO_BASE_MS + parte.length * ATRASO_POR_CARACTERE_MS);
            await enviar(chatId, parte);
        }
    }

    return { enviar, enviarEmPartes };
}

module.exports = { criar, NAO_QUEBRAR, ATRASO_BASE_MS, ATRASO_POR_CARACTERE_MS };
