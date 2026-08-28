// =============================================================
//  SERVIDOR HTTP — a borda do sistema
//
//  Tres grupos de rota, com contratos bem diferentes:
//
//    /webhook   — entrada do ChatClean. Responde 200 SEMPRE e na hora,
//                 antes de processar: o CRM reenvia o que nao recebe 200,
//                 e um reenvio vira conversa duplicada.
//    /health    — sonda do orquestrador. Sem autenticacao, de proposito.
//    /diag e /leads — administrativos. Expoem configuracao e dados de lead,
//                 entao exigem ADMIN_KEY. Sem a chave definida ficam
//                 BLOQUEADOS (503), nao abertos.
//
//  NOTA DE LEITURA: os corpos foram movidos verbatim do index.js.
// =============================================================

function registrar(deps) {
const {
    app,
    express,
    config,
    parsePayload,
    contatoPermitido,
    enviarMensagem,
    enfileirar,
    webhookAutorizado,
    dentroDoLimite,
    mensagensProcessadas,
    TIPOS_SUPORTADOS,
    store,
    estaEmExpediente,
    DEPARTAMENTOS,
    normalizarPhone,
    DEPARTAMENTO_IDS,
    departamentoId,
    lojaParaDepartamento,
    transferirDepartamento,
    pipeline
} = deps;

const {
    ADMIN_KEY,
    RATE_LIMIT_MSGS,
    RATE_LIMIT_JANELA,
    CC_PUSH_URL,
    EQUIPE_NUMERO,
    RESET_INATIVIDADE,
    TRANSFERIR_DEPARTAMENTO,
    TRANSFERIR_FECHANDO
} = config;

async function handleWebhook(req, res) {
    res.status(200).json({ status: 'ok' }); // responde rápido (evita retry do ChatClean)
    try {
        if (!webhookAutorizado(req)) {
            console.warn('⚠️ Webhook com token inválido ou ausente — ignorado.');
            return;
        }

        console.log('🔍 PAYLOAD RAW:', JSON.stringify(req.body, null, 2).slice(0, 4000));

        const parsed = parsePayload(req.body);
        if (!parsed) return;

        console.log(`📩 Webhook de ${parsed.chatId} [${parsed.tipo}]: "${parsed.texto || '[mídia]'}"`);

        if (!contatoPermitido(parsed.chatId)) {
            console.log(`🚫 Contato ${parsed.chatId} fora da lista de teste — ignorado`);
            return;
        }

        // Rate-limit por número (anti-spam / loop / proteção de custo OpenAI).
        if (!dentroDoLimite(parsed.chatId)) {
            console.warn(`🚦 Rate-limit: ${parsed.chatId} passou de ${RATE_LIMIT_MSGS}/${RATE_LIMIT_JANELA / 1000}s — ignorando.`);
            return;
        }

        if (parsed.msgId) {
            if (mensagensProcessadas.has(parsed.msgId)) {
                console.log(`↩️ Mensagem duplicada (${parsed.msgId}) ignorada`);
                return;
            }
            mensagensProcessadas.add(parsed.msgId);
            if (mensagensProcessadas.size > 500) {
                [...mensagensProcessadas].slice(0, 200).forEach(id => mensagensProcessadas.delete(id));
            }
        }

        // Mídia não suportada (sticker, localização...) → fallback humanizado
        if (!TIPOS_SUPORTADOS.includes(parsed.tipo)) {
            await enviarMensagem(parsed.chatId, 'Pode me mandar por texto o que você precisa? Assim consigo te ajudar melhor 🙂');
            return;
        }

        // Enfileira (nunca descarta): agrupa mensagens rápidas e processa em série.
        enfileirar(parsed);
    } catch (e) {
        console.error('❌ Erro no handler do webhook:', e);
    }
}

// Aceita o token embutido no path (/webhook/<secret>) ou em /webhook (header/query).
app.post('/webhook', express.json({ limit: '10mb' }), handleWebhook);
app.post('/webhook/:token', express.json({ limit: '10mb' }), handleWebhook);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
// GET de validação do webhook (alguns painéis testam a URL com GET antes de
// disparar). Responde 200 tanto em /webhook quanto em /webhook/<token>, senão
// a URL com o token no caminho daria 404 e o provedor não dispararia.
const webhookPing = (req, res) => res.status(200).json({ status: 'ok' });
app.get('/webhook', webhookPing);
app.get('/webhook/:token', webhookPing);

// Guard dos endpoints administrativos. Aceita a chave em ?key=, no header
// x-admin-key ou Authorization: Bearer. Sem ADMIN_KEY configurada, BLOQUEIA
// (nunca deixa /leads e /diag abertos ao público por omissão).
function checarAdmin(req, res) {
    if (!ADMIN_KEY) {
        res.status(503).json({ erro: 'ADMIN_KEY não configurada no servidor' });
        return false;
    }
    const raw = req.query.key || req.headers['x-admin-key'] || req.headers['authorization'] || '';
    const key = String(raw).replace(/^Bearer\s+/i, '');
    if (key !== ADMIN_KEY) {
        res.status(401).json({ erro: 'não autorizado' });
        return false;
    }
    return true;
}

// Diagnóstico de produção: confere expediente, Redis e config de Push/pipeline.
// Não expõe segredos.
app.get('/diag', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    res.json({
        ok: true,
        expediente: estaEmExpediente(),
        resetInatividadeHoras: RESET_INATIVIDADE / 3600000,
        redis: store.isRedis(),
        pushConfigurado: !!CC_PUSH_URL,
        equipeNumero: !!EQUIPE_NUMERO,
        transferenciaDepartamento: { ativa: TRANSFERIR_DEPARTAMENTO, fechandoTicket: TRANSFERIR_FECHANDO, ids: DEPARTAMENTO_IDS },
        pipeline: pipeline.diag()
    });
});

// Testa a transferência de um ticket SEM precisar refazer a conversa inteira.
// Ex.: /diag/transferir?key=ADMIN&numero=5583999999999&loja=malvinas
// Retorna a resposta CRUA do CRM — é assim que se descobre por que um ticket não
// muda de fila. Não manda nada para o cliente (a nota é interna).
app.get('/diag/transferir', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    const numero = String(req.query.numero || '').trim();
    const loja   = String(req.query.loja || '').trim();
    if (!numero) return res.status(400).json({ erro: 'informe ?numero=55DDNNNNNNNNN' });

    const departamento = lojaParaDepartamento(loja) || DEPARTAMENTOS[loja] || loja || DEPARTAMENTOS.entrada;
    const r = await transferirDepartamento(normalizarPhone(numero), departamento);
    res.json({
        numeroEnviado: normalizarPhone(numero),
        departamento, idUsado: r.id || departamentoId(departamento),
        fechandoTicket: TRANSFERIR_FECHANDO,
        transferiu: r.ok,
        motivo: r.motivo,
        respostaDoCRM: r.resposta
    });
});

// Histórico de leads qualificados (útil pra conferência rápida)
app.get('/leads', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    try {
        const ids = await store.scanLeadIds();
        const ativos = [];
        for (const id of ids) {
            try {
                const l = await store.getLead(id);
                if (l) ativos.push({ chatId: id, nome: l.nome, empresa: l.empresa, finalizado: !!l.finalizado });
            } catch (_) {
                // Um lead ilegivel nao pode derrubar a listagem inteira: o
                // endpoint e de diagnostico, e uma lista parcial vale mais do
                // que um 500.
            }
        }
        res.json({ total: ativos.length, ativos });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

return { handleWebhook };
}

module.exports = { registrar };
