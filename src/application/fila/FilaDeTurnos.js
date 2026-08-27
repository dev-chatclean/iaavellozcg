// =============================================================
//  FILA DE TURNOS — serial por cliente, com agrupamento
//
//  No WhatsApp o cliente manda varias mensagens seguidas ("oi" / "queria uma
//  moto" / "pra trabalhar"). Responder cada uma separadamente produz tres
//  respostas atropeladas; responder so a primeira e descartar o resto — que
//  era o comportamento do lock antigo — perde informacao.
//
//  A solucao tem duas partes:
//    1. FILA POR CLIENTE, processada em serie. Nada e descartado.
//    2. AGRUPAMENTO por debounce: mensagens de TEXTO consecutivas viram um
//       turno so. Midia nao espera — cancela o debounce e drena na hora,
//       porque nao da para concatenar imagem com audio.
//
//  Modulo puro de coordenacao: nao conhece OpenAI, canal nem repositorio. O
//  lock do turno entra por parametro, porque quem o mantem e quem processa.
// =============================================================

const JANELA_PADRAO_MS = 2000;

/**
 * Junta as mensagens de TEXTO consecutivas no inicio da fila num unico turno.
 * Midia e sempre uma unidade isolada.
 *
 * Os campos que "sobrevivem" ao agrupamento sao o PRIMEIRO valor nao vazio de
 * cada um: se o cliente mandou o nome numa mensagem e a duvida na seguinte, o
 * turno agrupado carrega os dois.
 *
 * @param {object[]} fila mutada: as mensagens consumidas saem dela
 * @returns {object} o turno
 */
function proximaUnidade(fila) {
    if (fila[0].tipo !== 'text') return fila.shift();

    const textos = [];
    const ids = [];
    let nome = '';
    let quoted = null;
    let contactId = null;

    while (fila.length && fila[0].tipo === 'text') {
        const m = fila.shift();
        if (m.texto) textos.push(m.texto);
        if (m.msgId) ids.push(m.msgId);
        if (!nome && m.nomeContato) nome = m.nomeContato;
        if (!quoted && m.quotedText) quoted = m.quotedText;
        if (!contactId && m.contactId) contactId = m.contactId;
    }

    return {
        chatId: null, // preenchido por quem drena
        contactId,
        tipo: 'text',
        texto: textos.join('\n'),
        msgId: ids.join(',') || null,
        nomeContato: nome,
        quotedText: quoted,
        mediaBase64: null,
        mediaUrl: null,
        mediaMimetype: null
    };
}

/**
 * @param {object} deps
 * @param {(turno: object) => Promise<void>} deps.processarTurno
 * @param {(chatId: string) => boolean} deps.estaProcessando
 *   Lock do turno. Vive fora daqui porque quem o mantem e quem processa.
 * @param {number} [deps.janelaDeAgrupamentoMs]
 * @param {(erro: Error, chatId: string) => void} [deps.aoFalhar]
 */
function criar({ processarTurno, estaProcessando, janelaDeAgrupamentoMs = JANELA_PADRAO_MS, aoFalhar = () => {} }) {
    /** @type {Map<string, object[]>} chatId -> mensagens aguardando */
    const filaPorChat = new Map();
    /** @type {Map<string, any>} chatId -> timer de agrupamento */
    const temporizadores = new Map();

    function cancelarAgrupamento(chatId) {
        if (!temporizadores.has(chatId)) return;
        clearTimeout(temporizadores.get(chatId));
        temporizadores.delete(chatId);
    }

    /**
     * Processa um turno do cliente. Se algo chegar durante o processamento,
     * drena de novo — assim nenhuma mensagem fica esperando indefinidamente.
     */
    async function drenar(chatId) {
        if (estaProcessando(chatId)) return; // ja rodando: sera drenado ao terminar

        const fila = filaPorChat.get(chatId);
        if (!fila || !fila.length) return;

        const turno = proximaUnidade(fila);
        turno.chatId = chatId;

        try {
            await processarTurno(turno);
        } catch (e) {
            aoFalhar(e, chatId);
        }

        const restante = filaPorChat.get(chatId);
        if (restante && restante.length) drenar(chatId);
        else filaPorChat.delete(chatId);
    }

    /**
     * Enfileira a mensagem. Texto espera a janela de agrupamento; midia drena
     * na hora.
     */
    function enfileirar(mensagem) {
        const { chatId } = mensagem;
        const fila = filaPorChat.get(chatId) || [];
        fila.push(mensagem);
        filaPorChat.set(chatId, fila);

        if (mensagem.tipo === 'text') {
            cancelarAgrupamento(chatId);
            temporizadores.set(
                chatId,
                setTimeout(() => {
                    temporizadores.delete(chatId);
                    drenar(chatId);
                }, janelaDeAgrupamentoMs)
            );
            return;
        }

        cancelarAgrupamento(chatId);
        drenar(chatId);
    }

    /** Quantas mensagens aguardam por este cliente. Para diagnostico e teste. */
    function pendentes(chatId) {
        return (filaPorChat.get(chatId) || []).length;
    }

    return { enfileirar, drenar, pendentes };
}

module.exports = { criar, proximaUnidade, JANELA_PADRAO_MS };
