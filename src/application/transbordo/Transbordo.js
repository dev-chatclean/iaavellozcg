// =============================================================
//  TRANSBORDO — a entrega do lead ao vendedor
//
//  O momento mais importante do sistema: e aqui que o trabalho da IA vira,
//  ou nao vira, um atendimento humano. Tres passos, nesta ordem, e a ordem
//  importa:
//
//    1. NOTA no ticket do cliente, com o resumo. Vem primeiro para que o
//       contexto ja esteja la quando o ticket chegar no departamento.
//    2. TRANSFERENCIA de fila, de verdade, via Push API.
//    3. AVISO a equipe pelo WhatsApp interno — com alerta quando a
//       transferencia falhou e alguem precisa encaminhar na mao.
//
//  So depois disso a IA responde ao cliente. E se a transferencia NAO foi
//  confirmada, ela responde SEM prometer o repasse: dizer "ja te transferi"
//  quando o ticket ficou parado deixa o cliente esperando alguem que nao
//  vem.
//
//  NOTA DE LEITURA: os corpos abaixo foram movidos verbatim do index.js.
// =============================================================

function criar(deps) {
const {
    canal,
    store,
    estaEmExpediente,
    departamentoLead,
    departamentoId,
    montarResumo,
    enviarMensagem,
    gerarRespostaIA,
    PERFIS,
    DEPARTAMENTOS,
    EQUIPE_NUMERO,
    TRANSFERIR_DEPARTAMENTO,
    TRANSFERIR_FECHANDO
} = deps;

const ccPush = (numero, payload) => canal.enviar(numero, payload);

// Transfere o ticket do cliente para o DEPARTAMENTO (fila) da unidade escolhida.
// A Push API espera DOIS campos: forceTicketToDepartment = true (interruptor) e
// queueId = ID do departamento no CRM (Configurações → Departamentos):
// Matriz 228, Malvinas 230, Monteiro 231.
//
// Retorna { ok, id, departamento, motivo, resposta }. O ok é o que autoriza a IA
// a CONFIRMAR a transferência para o cliente — sem ele, prometer "já te
// transferi" seria mentira e o cliente ficaria esperando na fila errada.
//
// A doc da plataforma diz que o ticket só é reposicionado quando está fechado ou
// é o primeiro contato. Quando TRANSFERIR_FECHANDO=true a gente fecha o ticket no
// mesmo push (forceTicketToClosed), que é o gatilho para ele reabrir já na fila
// do departamento certo.
async function transferirDepartamento(chatId, departamento) {
    if (!TRANSFERIR_DEPARTAMENTO) {
        return { ok: false, departamento, motivo: 'transferência automática desligada (TRANSFERIR_DEPARTAMENTO=false)' };
    }
    // O lead JÁ está no Agente IA: não há para onde transferir enquanto a loja
    // não for escolhida. Isso é fluxo normal, não erro de configuração.
    if (departamento === DEPARTAMENTOS.entrada && !departamentoId(departamento)) {
        console.log(`ℹ️ ${chatId}: sem loja definida — ticket permanece em ${DEPARTAMENTOS.entrada}.`);
        return { ok: false, departamento, permanece: true, motivo: `sem loja escolhida — permanece em ${DEPARTAMENTOS.entrada}` };
    }
    const id = departamentoId(departamento);
    if (!id) {
        console.warn(`⚠️ Departamento "${departamento}" sem ID cadastrado — ticket de ${chatId} não foi transferido.`);
        return { ok: false, departamento, motivo: `departamento "${departamento}" sem ID cadastrado` };
    }
    const nota = `➡️ Ticket transferido automaticamente para o departamento ${departamento} (#${id}).`;
    const payload = {
        body: nota,
        onlyNote: true,
        note: { body: nota },
        // A Push API usa forceTicketToDepartment como INTERRUPTOR (booleano), no
        // mesmo padrão de forceTicketToClosed, e lê o ID do departamento em
        // queueId — "queue" é como a plataforma chama departamento internamente.
        //
        // Mandar o ID direto em forceTicketToDepartment (como era antes) não dá
        // erro: a API responde 200 com corpo VAZIO e descarta o campo em silêncio.
        // A nota interna era gravada normalmente, o log dizia "aceita", a IA
        // confirmava a transferência para o cliente — e o ticket nunca saía da
        // fila de origem. Confirmado em teste direto contra a API.
        forceTicketToDepartment: true,
        queueId: id
    };
    if (TRANSFERIR_FECHANDO) payload.forceTicketToClosed = true;

    const r = await ccPush(chatId, payload);
    // Log da resposta CRUA do CRM: é o que permite descobrir por que um ticket
    // não mudou de fila sem precisar reproduzir a conversa inteira.
    console.log(`🔀 transferência ${chatId} → ${departamento} (#${id}): ${r.ok ? 'aceita' : 'RECUSADA'} | status ${r.status || '-'} | resposta: ${JSON.stringify(r.data || r.erro || null).slice(0, 400)}`);
    return {
        ok: r.ok, id, departamento,
        motivo: r.ok ? null : (r.erro || 'o CRM recusou o push de transferência'),
        resposta: r.data
    };
}

async function notificarEquipe(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || departamentoLead(leadData);
    const perfilNome = leadData.perfilKey && PERFIS[leadData.perfilKey]
        ? PERFIS[leadData.perfilKey].nome : 'Não informado';
    const resumo = montarResumo(leadData, chatId, opcoes);

    // Nota interna no ticket do próprio cliente (fica no CRM p/ o atendente)
    await ccPush(chatId, { body: resumo, onlyNote: true, note: { body: resumo } });
    // Transferência REAL para a fila da unidade escolhida (depois da nota, para
    // que o contexto já esteja no ticket quando ele chegar no departamento).
    const transferencia = await transferirDepartamento(chatId, departamento);
    // Resumo também por WhatsApp interno, se houver número da equipe. Quando a
    // transferência falha, a equipe precisa saber para encaminhar na mão.
    if (EQUIPE_NUMERO) {
        const aviso = (transferencia.ok || transferencia.permanece) ? '' :
            `\n\n⚠️ ATENÇÃO: a transferência automática para ${departamento} NÃO foi concluída (${transferencia.motivo}). Encaminhe este ticket manualmente.`;
        await ccPush(EQUIPE_NUMERO, { body: resumo + aviso });
    }

    // Histórico append-only de leads qualificados
    try {
        await store.appendLeadFinalizado({
            chatId, nome: leadData.nome || null, perfil: perfilNome,
            finalidade: leadData.finalidade || null, transporteAtual: leadData.transporteAtual || null,
            gastoMensal: leadData.gastoMensal || null, modeloInteresse: leadData.modeloInteresse || null,
            formaPagamento: leadData.formaPagamento || null, loja: leadData.loja || null,
            departamento, data: new Date().toISOString()
        });
    } catch (e) { console.error('❌ appendLeadFinalizado:', e.message); }

    console.log(`✅ Equipe notificada — lead ${leadData.nome || ''} (${chatId}) → ${departamento}${transferencia.ok ? '' : ' (SEM transferência automática)'}`);
    return transferencia;
}

// =============================================================
//  ENCAMINHAMENTO PARA HUMANO
// =============================================================
// A ORDEM aqui é a regra de negócio: transfere PRIMEIRO, confirma DEPOIS. A IA só
// diz "já te passei pro consultor" quando o ticket realmente entrou na fila do
// departamento. Se a transferência falhar, ela responde sem prometer a passagem
// e a equipe recebe o alerta para encaminhar na mão.
async function encaminhar(chatId, leadData, departamento, mensagemCliente, historico, expediente = null) {
    const exp = expediente || estaEmExpediente();
    leadData.qualificacaoCompleta = true;

    // Sinaliza na nota quando o lead pulou o funil por ter pedido pressa — o
    // consultor recebe o resumo quase vazio e precisa saber que foi de propósito.
    const tags = [
        leadData.modoAtalho ? 'PEDIU AGILIDADE — SEM DIAGNÓSTICO' : null,
        exp.aberto ? null : 'FORA DE EXPEDIENTE'
    ].filter(Boolean);
    const transferencia = await notificarEquipe(leadData, chatId, {
        departamento,
        tagExtra: tags.length ? tags.join(' | ') : undefined,
        proximoExpediente: exp.aberto ? null : exp.proximoExpediente
    });

    let msg;
    if (transferencia.ok) {
        // Deixa a IA escrever o handoff de forma calorosa (branch de qualificação completa)
        try {
            msg = await gerarRespostaIA(leadData, mensagemCliente, null, historico, exp);
        } catch (_) {
            msg = exp.aberto
                ? 'Perfeito! Já tô repassando tudo pro nosso consultor. Ele assume seu atendimento aqui rapidinho, combinado?'
                : `Perfeito, deixei tudo registrado! Nosso consultor te retorna ${exp.proximoExpediente}. Enquanto isso, ficou alguma dúvida sobre a moto?`;
        }
    } else {
        // Sem transferência confirmada: NÃO prometa que já passou pro consultor.
        console.warn(`⚠️ ${chatId}: confirmação de transferência suprimida — ${transferencia.motivo}`);
        msg = exp.aberto
            ? 'Perfeito, anotei tudo aqui! Nosso consultor já vai dar sequência no seu atendimento por aqui mesmo. Enquanto isso, ficou alguma dúvida sobre a moto?'
            : `Perfeito, deixei tudo registrado! Nosso consultor dá sequência ${exp.proximoExpediente}. Enquanto isso, ficou alguma dúvida sobre a moto?`;
    }
    await enviarMensagem(chatId, msg);
    leadData.conversationHistory.push({ role: 'assistant', content: msg });
    leadData.transferidoOk = transferencia.ok;
    leadData.finalizado = true;
    leadData.followUpDueAt = null;
}

return { transferirDepartamento, notificarEquipe, encaminhar };
}

module.exports = { criar };
