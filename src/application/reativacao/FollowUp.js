// =============================================================
//  FOLLOW-UP DE REATIVACAO
//
//  Conversa que parou no meio nao e conversa perdida: 30 minutos de silencio
//  e a IA volta de onde parou, com uma pergunta especifica da etapa em que o
//  cliente estava. Uma mensagem generica ("ainda por ai?") converte muito
//  menos que retomar o assunto exato.
//
//  E DURAVEL de proposito: o vencimento fica no estado do atendimento, nao
//  num timer de processo. Assim um redeploy nao apaga os follow-ups
//  pendentes — um varredor periodico dispara os vencidos.
//
//  NOTA DE LEITURA: os corpos foram movidos verbatim do index.js.
// =============================================================

function criar(deps) {
const {
    store,
    lockDeAtendimento,
    enviarMensagem,
    determinarProximoCampo
} = deps;

const TEMPO_INATIVIDADE = 30 * 60 * 1000; // 30 min sem resposta → reativação
const FOLLOWUP_SWEEP    = 2 * 60 * 1000;  // varre a cada 2 min

function agendarFollowUpReativacao(leadData) {
    if (leadData.finalizado) { leadData.followUpDueAt = null; return; }
    leadData.followUpDueAt = Date.now() + TEMPO_INATIVIDADE;
}

function montarMsgReativacao(leadData) {
    const proximo = determinarProximoCampo(leadData);
    if (!proximo) return null;
    const nome = leadData.nome?.split(' ')[0] || '';
    const oi = nome ? `Oi ${nome}` : 'Oi';
    if (proximo.campo === 'finalidade')      return `${oi}! Ainda por aí? Me conta pra que você quer a moto no dia a dia que eu te ajudo a achar a certa 😊`;
    if (proximo.campo === 'transporteAtual') return `${oi}, ainda por aí? Como você tá se locomovendo hoje — Uber, ônibus, carro?`;
    if (proximo.campo === 'gastoMensal')     return `${oi}, seguindo de onde paramos: mais ou menos quanto você gasta por mês com transporte hoje?`;
    if (proximo.campo === 'modeloInteresse') return `${oi}, ainda por aí? Quer que eu te indique o modelo que mais encaixa no seu dia a dia?`;
    if (proximo.campo === 'loja')            return `${oi}, pra eu já adiantar com o consultor: qual unidade fica melhor pra você — Matriz, Malvinas ou Monteiro?`;
    return `${oi}, ainda por aí? Se quiser, seguimos de onde paramos que eu já organizo tudo pro nosso consultor 😊`;
}

async function dispararFollowUpReativacao(chatId, leadData) {
    const msg = montarMsgReativacao(leadData);
    leadData.followUpDueAt = null;
    if (!msg || leadData.followUpUltimo === msg) {
        // Falha ao gravar aqui e tolerada: o vencimento ja foi zerado em
        // memoria e, se o estado nao persistir, o varredor tentara de novo no
        // proximo ciclo. Pior que repetir a tentativa seria derrubar a
        // varredura inteira por causa de um lead.
        try {
            await store.saveLead(chatId, leadData);
        } catch (_) {
            // tolerado de proposito — ver comentario acima
        }
        return;
    }
    leadData.followUpUltimo = msg;
    // Grava ANTES de enviar: se o processo cair entre as duas coisas, e melhor
    // ter marcado um follow-up que nao saiu do que mandar o mesmo texto duas
    // vezes ao cliente.
    try {
        await store.saveLead(chatId, leadData);
    } catch (_) {
        // tolerado de proposito — ver comentario acima
    }
    await enviarMensagem(chatId, msg);
    console.log(`📩 Follow-up de reativação enviado para ${chatId}`);
}

async function varrerFollowUps() {
    try {
        const ids = await store.scanLeadIds();
        const agora = Date.now();
        for (const chatId of ids) {
            if (lockDeAtendimento.ocupado(chatId)) continue;
            let leadData;
            try { leadData = await store.getLead(chatId); } catch (_) { continue; }
            if (!leadData || leadData.finalizado) continue;
            if (!leadData.followUpDueAt || leadData.followUpDueAt > agora) continue;
            await dispararFollowUpReativacao(chatId, leadData);
        }
    } catch (e) {
        console.error('Erro no varredor de follow-up:', e.message);
    }
}

return {
    TEMPO_INATIVIDADE,
    FOLLOWUP_SWEEP,
    agendar: agendarFollowUpReativacao,
    montarMensagem: montarMsgReativacao,
    disparar: dispararFollowUpReativacao,
    varrer: varrerFollowUps
};
}

module.exports = { criar };
