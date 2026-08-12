// =============================================================
//  FILA DE TURNOS POR CLIENTE (SPEC 0018)
//
//  No WhatsApp o cliente manda varias mensagens seguidas. Em vez de processar
//  a primeira e DESCARTAR o resto, enfileiramos por numero e processamos em
//  serie. Mensagens de TEXTO consecutivas viram um unico turno (debounce);
//  midia e processada assim que chega, mas ainda em serie (RN-057).
//
//  Extraida do index.js sem alteracao de comportamento. Recebe por parametro
//  o que fazer com cada turno e como saber se ha turno em andamento — nao
//  conhece Express, OpenAI nem o caso de uso.
//
//  ATENCAO: a fila vive em MEMORIA. Com duas instancias, cada uma tem a sua,
//  e o agrupamento se perde entre elas (D-15). Mover para o Redis e a spec 0012.
// =============================================================

/**
 * @param {object} opcoes
 * @param {(turno: object) => Promise<void>} opcoes.processarTurno
 * @param {(chatId: string) => boolean} opcoes.estaProcessando
 * @param {number} opcoes.janelaDeAgrupamentoMs  0 desativa o agrupamento.
 * @param {(erro: Error, chatId: string) => void} [opcoes.aoFalhar]
 */
function criar({ processarTurno, estaProcessando, janelaDeAgrupamentoMs, aoFalhar = () => {} }) {
    const filaPorChat = new Map(); // chatId -> [mensagem, ...]
    const temporizadores = new Map(); // chatId -> timer do debounce

    // Junta as mensagens de TEXTO consecutivas no inicio da fila num unico
    // turno. Midia e sempre uma unidade isolada (nao da pra concatenar
    // imagem + audio + texto).
    function proximaUnidade(fila) {
        if (fila[0].tipo !== 'text') return fila.shift();

        const textos = [];
        const ids = [];
        let nome = '';
        let citacao = null;
        let contactId = null;

        while (fila.length && fila[0].tipo === 'text') {
            const m = fila.shift();
            if (m.texto) textos.push(m.texto);
            if (m.msgId) ids.push(m.msgId);
            if (!nome && m.nomeContato) nome = m.nomeContato;
            if (!citacao && m.quotedText) citacao = m.quotedText;
            if (!contactId && m.contactId) contactId = m.contactId;
        }

        return {
            chatId: null, // preenchido por quem drena
            contactId,
            tipo: 'text',
            texto: textos.join('\n'),
            msgId: ids.join(',') || null,
            nomeContato: nome,
            quotedText: citacao,
            mediaBase64: null,
            mediaUrl: null,
            mediaMimetype: null
        };
    }

    async function drenar(chatId) {
        if (estaProcessando(chatId)) return; // ja rodando: sera drenado ao terminar
        const fila = filaPorChat.get(chatId);
        if (!fila || !fila.length) return;

        // A unidade pode ser uma MensagemRecebida CONGELADA (midia, vinda direto
        // do ACL) ou um agrupamento de textos, que nasce sem chatId. Nao mutamos
        // o objeto congelado: quando falta o chatId, criamos uma copia.
        const unidade = proximaUnidade(fila);
        const comChat = unidade.chatId ? unidade : { ...unidade, chatId };

        try {
            await processarTurno(comChat);
        } catch (e) {
            // Uma falha inesperada nao pode parar a fila nem virar rejeicao
            // sem dono: quem monta a fila decide como registrar.
            aoFalhar(e, chatId);
        } finally {
            const restante = filaPorChat.get(chatId);
            if (restante && restante.length) drenar(chatId);
            else filaPorChat.delete(chatId);
        }
    }

    return {
        enfileirar(mensagem) {
            const { chatId } = mensagem;
            const fila = filaPorChat.get(chatId) || [];
            fila.push(mensagem);
            filaPorChat.set(chatId, fila);

            if (mensagem.tipo === 'text') {
                // Espera um instante juntando mensagens rapidas antes de drenar.
                if (temporizadores.has(chatId)) clearTimeout(temporizadores.get(chatId));
                temporizadores.set(
                    chatId,
                    setTimeout(() => {
                        temporizadores.delete(chatId);
                        drenar(chatId);
                    }, janelaDeAgrupamentoMs)
                );
            } else {
                // Midia nao espera: cancela o debounce pendente e drena ja.
                if (temporizadores.has(chatId)) {
                    clearTimeout(temporizadores.get(chatId));
                    temporizadores.delete(chatId);
                }
                drenar(chatId);
            }
        },

        drenar,
        proximaUnidade,
        pendentes: (chatId) => (filaPorChat.get(chatId) || []).length
    };
}

module.exports = { criar };
