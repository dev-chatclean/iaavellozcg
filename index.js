require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// =============================================================
//  CONFIGURAÇÃO — ChatClean (Webhook de entrada + Push API de saída)
//  Variáveis no .env (ver .env.example):
//
//  CC_PUSH_URL     = URL autenticada gerada em Configurações → API/Webhook → Adicionar
//                    (o token JWT já vem embutido como ?token=...; sem header)
//  WEBHOOK_SECRET  = Token opcional para validar o webhook de entrada
//                    (o ChatClean hoje NÃO envia token no header → deixe vazio)
//  EQUIPE_NUMERO   = WhatsApp interno que recebe o resumo dos leads qualificados
//  IA_ALLOWED_CONTACTS = Números liberados na fase de teste (vazio = responde a todos)
//  PORT            = Porta do servidor (padrão: 3000)
// =============================================================
// A leitura do ambiente vive em src/main/config.js — o unico lugar do sistema
// que toca process.env.
const config = require('./src/main/config').carregar();
const {
    OPENAI_API_KEY,
    CC_PUSH_URL,
    WEBHOOK_SECRET,
    EQUIPE_NUMERO,
    PORT,
    ADMIN_KEY,
    RATE_LIMIT_MSGS,
    RATE_LIMIT_JANELA,
    RESET_INATIVIDADE,
    TRANSFERIR_DEPARTAMENTO,
    TRANSFERIR_FECHANDO
} = config;

// =============================================================
//  MONTAGEM
//  Quem e cada dependencia se decide em src/main/container.js.
// =============================================================
const container = require('./src/main/container').criar(config);
const {
    DEPARTAMENTOS,
    DEPARTAMENTO_IDS,
    EMPRESA_INFO,
    FOLLOWUP_SWEEP,
    agendarFollowUpReativacao,
    contatoPermitido,
    departamentoId,
    departamentoLead,
    enviarMensagem,
    enviarMensagensQuebradas,
    estaEmExpediente,
    filaDeTurnos,
    lojaParaDepartamento,
    montarMsgReativacao,
    montarResumo,
    normalizarPhone,
    pipeline,
    processarMensagem,
    store,
    transferirDepartamento,
    varrerFollowUps,
    tradutorDePayload,
    MotivoDeDescarte,
    ehGrupo,
    ticketStatus,
    deveResponderTicket
} = container;

const enfileirar = (parsed) => filaDeTurnos.enfileirar(parsed);


// =============================================================
//  WEBHOOK — PARSE DO PAYLOAD DO CHATCLEAN
// =============================================================
function parsePayload(body) {
    const r = tradutorDePayload.traduzir(body);
    if (r.mensagem) return r.mensagem;

    const { motivo, detalhe } = r.descarte;
    if (motivo === MotivoDeDescarte.GRUPO) {
        console.log('\u{1F465} Mensagem de grupo ignorada');
    } else if (motivo === MotivoDeDescarte.TICKET_ASSUMIDO) {
        console.log(`\u{23ED}\u{FE0F} Ticket "${detalhe}" (aceito/atendido por humano) — IA não responde`);
    } else if (motivo === MotivoDeDescarte.DISPARO_DUPLICADO) {
        console.log('\u{21A9}\u{FE0F} Ignorando disparo duplicado (formato numero_cliente)');
    } else if (motivo === MotivoDeDescarte.FORMATO_DESCONHECIDO) {
        console.log('\u{26A0}\u{FE0F} Payload não reconhecido:', JSON.stringify(detalhe, null, 2).slice(0, 800));
    } else if (motivo === MotivoDeDescarte.ERRO_DE_PARSE) {
        console.error('\u{274C} Erro ao fazer parse do payload:', detalhe.message);
    }
    return null;
}

const mensagensProcessadas = new Set(); // dedup de webhooks
const TIPOS_SUPORTADOS = ['text', 'image', 'document', 'audio', 'ptt', 'video'];

// Valida o token do webhook contra WEBHOOK_SECRET. Aceita no header
// (x-webhook-token / Authorization: Bearer), na query (?token=) ou no path
// (/webhook/<token>). Se WEBHOOK_SECRET estiver vazio, o webhook fica aberto
// (compat) — CONFIGURE-O antes do go-live e aponte a URL do ChatClean para
// https://.../webhook/<secret> (ou .../webhook?token=<secret>).
function webhookAutorizado(req) {
    if (!WEBHOOK_SECRET) return true;
    const raw = req.headers['x-webhook-token'] || req.headers['authorization'] || req.query.token || req.params.token || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    if (token.length !== WEBHOOK_SECRET.length) return false;
    const a = Buffer.from(token.padEnd(128).slice(0, 128));
    const b = Buffer.from(WEBHOOK_SECRET.padEnd(128).slice(0, 128));
    return crypto.timingSafeEqual(a, b);
}

// Rate-limit por número (janela deslizante em memória, por instância).
const rateHits = new Map(); // chatId -> [timestamps]
function dentroDoLimite(chatId) {
    if (!RATE_LIMIT_MSGS) return true; // desativado
    const agora = Date.now();
    const hits = (rateHits.get(chatId) || []).filter(t => agora - t < RATE_LIMIT_JANELA);
    hits.push(agora);
    rateHits.set(chatId, hits);
    if (rateHits.size > 5000) { // poda defensiva
        for (const [k, v] of rateHits) {
            if (!v.length || agora - v[v.length - 1] > RATE_LIMIT_JANELA) rateHits.delete(k);
        }
    }
    return hits.length <= RATE_LIMIT_MSGS;
}

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
            try { const l = await store.getLead(id); if (l) ativos.push({ chatId: id, nome: l.nome, empresa: l.empresa, finalizado: !!l.finalizado }); } catch (_) {}
        }
        res.json({ total: ativos.length, ativos });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// =============================================================
//  INICIALIZAÇÃO
//
//  Tudo que tem efeito colateral no processo — abrir a porta, agendar o
//  varredor de follow-up, registrar handlers de sinal, encerrar por falta de
//  chave — vive dentro de iniciar(), chamada só quando o arquivo é executado
//  direto (`node index.js`). Assim a suíte consegue importar o módulo para
//  testar o turno SEM subir servidor nem disparar timer.
//
//  Em produção o comportamento é idêntico: a ordem das operações é a mesma, e
//  a linha de base confirma isso rodando o servidor de verdade.
// =============================================================
function iniciar() {
// Falha RÁPIDO e claro se faltar a chave da OpenAI: antes era checado dentro do
// callback do listen, ou seja, a porta abria, o healthcheck passava e só então o
// processo morria — virando crash-loop difícil de ler no log do container.
if (!OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY não configurada — a IA não sobe. Defina a variável de ambiente e faça o deploy de novo.');
    process.exit(1);
}

setInterval(varrerFollowUps, FOLLOWUP_SWEEP).unref?.();

let servidorPronto = false;
const server = app.listen(PORT, () => {
    servidorPronto = true;
    console.log('');
    console.log('🚀 ================================');
    console.log(`🏍️  IA ${EMPRESA_INFO.nome} — VIA CHATCLEAN (Webhook + Push)`);
    console.log(`📡 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Webhook: https://SEU_DOMINIO/webhook`);
    console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
    console.log('🚀 ================================');
    console.log('');
    if (!CC_PUSH_URL)   console.warn('⚠️  CC_PUSH_URL não configurado — a IA não conseguirá responder.');
    if (!EQUIPE_NUMERO) console.warn('ℹ️  EQUIPE_NUMERO não configurado — resumo de lead só irá como nota interna.');
    if (!ADMIN_KEY)     console.warn('🔒 ADMIN_KEY não configurada — /leads e /diag ficarão BLOQUEADOS (503). Defina para liberar o acesso administrativo.');
    if (!WEBHOOK_SECRET) console.warn('🔓 WEBHOOK_SECRET vazio — /webhook está ABERTO. Antes do go-live, defina-o e aponte a URL do ChatClean para /webhook/<secret>.');
    console.log(store.isRedis()
        ? '🗄️  Estado das conversas: Redis (persistente)'
        : '🗄️  Estado das conversas: memória (defina REDIS_URL para persistir entre restarts)');
});

// Encerramento limpo: fecha o servidor HTTP (para de aceitar conexões novas e
// deixa as em andamento terminarem) antes de sair. Se algo travar, sai mesmo
// assim em 8s para não deixar o container pendurado.
//
// Se o container morre e este log NÃO aparece, o sinal não chegou ao Node — é o
// caso de quando a plataforma inicia o app por "npm start": o npm vira PID 1,
// recebe o SIGTERM e não repassa, e o log fica só com o
// "npm error signal SIGTERM". Nesse cenário, configure o start command como
// "node index.js" (é o que o Dockerfile já faz).
let encerrando = false;
// Falha ao subir (porta ocupada, permissão) é FATAL: precisa sair com código
// de erro para a plataforma tratar como falha, não como parada limpa.
server.on('error', (e) => {
    console.error('❌ Não foi possível subir o servidor:', e.message);
    process.exit(1);
});

async function shutdown(signal) {
    if (encerrando) return;
    encerrando = true;
    console.log(`\n⚠️  Recebido sinal ${signal}. Encerrando servidor...`);
    setTimeout(() => process.exit(0), 8000).unref();
    server.close(() => {
        console.log('✅ Servidor encerrado.');
        process.exit(0);
    });
}
// Rede de segurança: um erro solto (promessa rejeitada sem catch, falha de
// socket do Redis/axios) NÃO pode derrubar o atendimento inteiro. O Node encerra
// o processo por padrão nesses casos, o que no container vira restart e 502 pra
// quem estiver conversando. Aqui a gente loga e segue servindo.
process.on('unhandledRejection', (motivo) => {
    console.error('❌ Promessa rejeitada sem tratamento:', motivo?.stack || motivo);
});
process.on('uncaughtException', (erro) => {
    console.error('❌ Exceção não capturada:', erro?.stack || erro);
    // Antes de o servidor estar no ar, qualquer exceção é falha de
    // inicialização: sair com 0 faria um erro fatal parecer parada normal.
    if (!servidorPronto) process.exit(1);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));

return server;
}

if (require.main === module) iniciar();

// Exportado para a suíte de testes. Em produção nada consome este objeto — o
// servidor sobe pelo iniciar() acima.
module.exports = {
    app,
    iniciar,
    parsePayload,
    ehGrupo,
    deveResponderTicket,
    ticketStatus,
    webhookAutorizado,
    dentroDoLimite,
    montarResumo,
    departamentoLead,
    transferirDepartamento,
    processarMensagem,
    montarMsgReativacao,
    agendarFollowUpReativacao,
    varrerFollowUps,
    enviarMensagensQuebradas,
    handleWebhook
};
