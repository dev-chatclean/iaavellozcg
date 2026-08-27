// =============================================================
//  POLITICA ANTI-LOOP — RN-056
//
//  Do outro lado do WhatsApp nem sempre ha uma pessoa. Quando ha outro bot
//  (a IA da operadora, um auto-respondedor), as duas maquinas entram em
//  ping-pong: cada resposta gera outra, indefinidamente, queimando credito da
//  OpenAI e enchendo o CRM de ruido.
//
//  Dois sinais disparam a pausa:
//    VOLUME    — mensagens demais numa janela curta.
//    REPETICAO — a MESMA mensagem chegando de novo. Um humano reformula; um
//                bot repete identico.
//
//  A pausa e SILENCIOSA para o contato: nao adianta avisar um robo. Quem
//  precisa saber e a equipe, e uma vez so — dai o `avisar`.
//
//  Modulo puro. O relogio entra por parametro; o estado e mutado no lugar,
//  porque e ele que sera persistido no fim do turno.
// =============================================================

const HISTORICO_DE_TEXTOS = 6;
const TAMANHO_MAXIMO_DO_TEXTO = 200;
const REPETICOES_PARA_SUSPEITAR = 2;

/** Normaliza para comparacao: caixa, espacos e tamanho nao distinguem bots. */
function normalizar(texto) {
    return String(texto || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TAMANHO_MAXIMO_DO_TEXTO);
}

/**
 * @param {object} opcoes
 * @param {number} opcoes.maxTurnos   teto de mensagens dentro da janela
 * @param {number} opcoes.janelaMs
 */
function criar({ maxTurnos, janelaMs }) {
    /**
     * Registra o turno e diz se as respostas devem parar.
     *
     * MUTA o estado: turnosTs, ultimasMsgs e loopAvisado fazem parte do
     * atendimento persistido — sem isso a contagem reiniciaria a cada turno.
     *
     * @param {object} estado
     * @param {string} texto
     * @param {number} agoraMs
     * @returns {{pausar: boolean, avisar: boolean, motivo: 'volume'|'repeticao'|null, turnosNaJanela: number}}
     */
    function avaliar(estado, texto, agoraMs) {
        estado.turnosTs = (estado.turnosTs || []).filter((t) => agoraMs - t < janelaMs);
        estado.turnosTs.push(agoraMs);

        // Conversa normalizou: o proximo loop volta a merecer aviso.
        if (estado.turnosTs.length <= 2) estado.loopAvisado = false;

        const normalizado = normalizar(texto);
        estado.ultimasMsgs = estado.ultimasMsgs || [];
        // Contado ANTES de registrar a mensagem atual.
        const repetida =
            normalizado.length > 1 &&
            estado.ultimasMsgs.filter((t) => t === normalizado).length >= REPETICOES_PARA_SUSPEITAR;

        estado.ultimasMsgs.push(normalizado);
        if (estado.ultimasMsgs.length > HISTORICO_DE_TEXTOS) estado.ultimasMsgs.shift();

        const excedeuVolume = estado.turnosTs.length > maxTurnos;
        const pausar = excedeuVolume || repetida;

        if (!pausar) {
            return { pausar: false, avisar: false, motivo: null, turnosNaJanela: estado.turnosTs.length };
        }

        const avisar = !estado.loopAvisado;
        if (avisar) estado.loopAvisado = true;

        return {
            pausar: true,
            avisar,
            // Volume tem precedencia na mensagem, como no codigo original.
            motivo: excedeuVolume ? 'volume' : 'repeticao',
            turnosNaJanela: estado.turnosTs.length
        };
    }

    return { avaliar };
}

module.exports = { criar, normalizar, HISTORICO_DE_TEXTOS, TAMANHO_MAXIMO_DO_TEXTO, REPETICOES_PARA_SUSPEITAR };
