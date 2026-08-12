require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

// =============================================================
//  CONFIGURAÇÃO — validada em src/main/config.js (SPEC 0002)
//  As 21 variáveis são lidas e validadas UMA VEZ, no carregamento do módulo,
//  antes de qualquer efeito colateral. Configuração inválida derruba o processo
//  com uma mensagem que lista todos os problemas. Ver .env.example.
// =============================================================
const { carregar: carregarConfig, avisos: avisosConfig } = require('./src/main/config');
const config = carregarConfig();

const CC_PUSH_URL     = config.CC_PUSH_URL;
const WEBHOOK_SECRET  = config.WEBHOOK_SECRET;
const EQUIPE_NUMERO   = config.EQUIPE_NUMERO;
const IA_ALLOWED_CONTACTS = config.IA_ALLOWED_CONTACTS;
const PORT            = config.PORT;
const ADMIN_KEY       = config.ADMIN_KEY;
const IGNORAR_GRUPOS  = config.IGNORAR_GRUPOS;
const IA_SO_PENDENTES = config.IA_SO_PENDENTES;
const RATE_LIMIT_MSGS   = config.RATE_LIMIT_MSGS;
const RATE_LIMIT_JANELA = config.RATE_LIMIT_JANELA_MS;
const AGRUPAR_MS      = config.AGRUPAR_MENSAGENS_MS;
const RESET_INATIVIDADE = config.RESET_INATIVIDADE_MS;

const mascarar = require('./src/shared/mascarar');

// =============================================================
//  DEPENDÊNCIAS (SPEC 0004)
//  Todo acesso ao mundo externo passa pelas portas de
//  src/application/portas. Os adapters concretos são montados no
//  composition root e injetados aqui.
//
//  `usarDependencias` remonta o caso de uso com outras dependências. Serve
//  aos testes e é o que sobrou da costura da SPEC 0004: agora que o turno
//  recebe tudo por construtor, esta função só repassa. Ela sai quando o
//  index.js virar bootstrap puro (spec 0018) e os testes montarem o container
//  diretamente.
// =============================================================
const container = require('./src/main/container');
let deps = container.criar(config);
function usarDependencias(novas) {
    deps = novas;
    atendimento = ProcessarMensagemRecebida.criar(deps, config);
}

// Nome da empresa no banner de boot. Regras, prompts, OpenAI, ChatClean e
// Redis não são importados aqui: vêm pelas portas e pelo caso de uso.
const { EMPRESA_INFO } = require('./data');

// Allow-list de homologação (RN-058). A lógica vive em src/shared/telefone.js
// desde a SPEC 0001; o módulo compartilhado não lê process.env, então a lista
// é passada por parâmetro.
const telefone = require('./src/shared/telefone');
const contatoPermitido = (numero) => telefone.contatoPermitido(numero, IA_ALLOWED_CONTACTS);

// =============================================================
//  O TURNO — delegado ao caso de uso (SPEC 0008)
//  Toda a conversa vive em src/application/casos-de-uso/. Aqui ficam apenas
//  os invólucros que o restante do arquivo (fila, webhook, testes) usa.
// =============================================================
const ProcessarMensagemRecebida = require('./src/application/casos-de-uso/ProcessarMensagemRecebida');
const FOLLOWUP_SWEEP = ProcessarMensagemRecebida.FOLLOWUP_SWEEP;
let atendimento = ProcessarMensagemRecebida.criar(deps, config);

const processarMensagem = (mensagem) => atendimento.processarMensagem(mensagem);
const varrerFollowUps = () => atendimento.varrerFollowUps();
const montarMsgReativacao = (leadData) => atendimento.montarMsgReativacao(leadData);
const agendarFollowUpReativacao = (leadData) => atendimento.agendarFollowUpReativacao(leadData);
const enviarMensagem = (chatId, texto) => atendimento.enviarMensagem(chatId, texto);
const enviarMensagensQuebradas = (chatId, texto) => atendimento.enviarMensagensQuebradas(chatId, texto);
const montarResumo = (leadData, chatId, opcoes) => atendimento.montarResumo(leadData, chatId, opcoes);
const departamentoLead = (leadData) => atendimento.departamentoLead(leadData);
const estaProcessando = (chatId) => atendimento.estaProcessando(chatId);


// =============================================================
//  FILA SERIAL POR CLIENTE + AGRUPAMENTO DE MENSAGENS RÁPIDAS
//  No WhatsApp o cliente manda várias mensagens seguidas. Em vez de
//  processar a primeira e DESCARTAR as demais (o lock antigo fazia isso),
//  enfileiramos tudo por número e processamos em série. Mensagens de TEXTO
//  em sequência são agrupadas num só turno (debounce AGRUPAR_MS); mídia é
//  processada assim que chega (mas ainda em série, nunca descartada).
// =============================================================
const filaPorChat   = new Map(); // chatId -> [parsed, ...] aguardando processamento
const debounceTimers = new Map(); // chatId -> timer de agrupamento de texto

function enfileirar(parsed) {
    const { chatId } = parsed;
    const fila = filaPorChat.get(chatId) || [];
    fila.push(parsed);
    filaPorChat.set(chatId, fila);

    if (parsed.tipo === 'text') {
        // Espera um instante juntando mensagens rápidas antes de drenar.
        if (debounceTimers.has(chatId)) clearTimeout(debounceTimers.get(chatId));
        debounceTimers.set(chatId, setTimeout(() => {
            debounceTimers.delete(chatId);
            drenarFila(chatId);
        }, AGRUPAR_MS));
    } else {
        // Mídia não espera: cancela o debounce pendente e drena já.
        if (debounceTimers.has(chatId)) { clearTimeout(debounceTimers.get(chatId)); debounceTimers.delete(chatId); }
        drenarFila(chatId);
    }
}

// Junta as mensagens de TEXTO consecutivas no início da fila num único "turno".
// Mídia é sempre uma unidade isolada (não dá pra concatenar imagem+áudio+texto).
function proximaUnidade(fila) {
    if (fila[0].tipo !== 'text') return fila.shift();
    const textos = [], ids = [];
    let nome = '', quoted = null, contactId = null;
    while (fila.length && fila[0].tipo === 'text') {
        const m = fila.shift();
        if (m.texto) textos.push(m.texto);
        if (m.msgId) ids.push(m.msgId);
        if (!nome && m.nomeContato) nome = m.nomeContato;
        if (!quoted && m.quotedText) quoted = m.quotedText;
        if (!contactId && m.contactId) contactId = m.contactId;
    }
    return {
        chatId: null, // preenchido pelo chamador
        contactId,
        tipo: 'text',
        texto: textos.join('\n'),
        msgId: ids.join(',') || null,
        nomeContato: nome,
        quotedText: quoted,
        mediaBase64: null, mediaUrl: null, mediaMimetype: null
    };
}

async function drenarFila(chatId) {
    if (estaProcessando(chatId)) return; // já rodando: será drenado ao terminar
    const fila = filaPorChat.get(chatId);
    if (!fila || !fila.length) return;

    // A unidade pode ser uma MensagemRecebida CONGELADA (mídia, vinda direto do
    // ACL) ou um agrupamento de textos montado aqui, que nasce sem chatId.
    // Não mutamos o objeto congelado: quando falta o chatId, criamos uma cópia.
    const unidade = proximaUnidade(fila);
    const comChat = unidade.chatId ? unidade : { ...unidade, chatId };
    try {
        await processarMensagem(comChat);
    } catch (e) {
        console.error(`❌ Erro ao drenar fila de ${mascarar.telefone(chatId)}:`, e.message);
    }

    // Limpa a fila vazia; se algo chegou durante o processamento, drena de novo.
    const restante = filaPorChat.get(chatId);
    if (restante && restante.length) drenarFila(chatId);
    else filaPorChat.delete(chatId);
}

// =============================================================
//  WEBHOOK — TRADUÇÃO DO PAYLOAD (Anti-Corruption Layer, SPEC 0003)
//  Todo o conhecimento sobre o formato do ChatClean vive em
//  src/infrastructure/chatclean/acl/. Aqui ficou só a casca que aplica as
//  políticas vindas da configuração e adapta o resultado ao formato que o
//  restante do legado espera (objeto ou null).
//
//  O tradutor devolve um MOTIVO nomeado para cada descarte; até a SPEC 0003
//  todos colapsavam num único null, indistinguível para quem chamava.
// =============================================================
const acl = require('./src/infrastructure/chatclean/acl/tradutor');

const politicasDeEntrada = () => ({ ignorarGrupos: IGNORAR_GRUPOS, apenasPendentes: IA_SO_PENDENTES });

// Reexportados para os testes de caracterização escritos na Fase 0.
const ehGrupo = (body, msg) => acl.ehGrupo(body, msg);
const ticketStatus = (body, msg) => acl.statusDoTicket(body, msg);
const deveResponderTicket = (body, msg) => acl.motivoDeSilencioDoTicket(body, msg, politicasDeEntrada()) === null;

const { MOTIVOS } = require('./src/domain/mensageria/MotivoDeDescarte');

function parsePayload(body) {
    const r = acl.traduzir(body, politicasDeEntrada());

    if (r.aceita) {
        if (r.divergenciasDeEsquema) {
            // O formato do ChatClean mudou em algum detalhe. NÃO barramos — só
            // registramos, para descobrir antes de virar incidente.
            console.warn(`⚠️ Payload fora do esquema conhecido (processado mesmo assim): ${r.divergenciasDeEsquema.join('; ')}`);
        }
        return r;
    }

    // Mensagens de log preservadas do legado, agora com o motivo nomeado.
    switch (r.motivo) {
        case MOTIVOS.ECO:
            break; // silencioso, como sempre foi
        case MOTIVOS.GRUPO:
            console.log('👥 Mensagem de grupo ignorada');
            break;
        case MOTIVOS.TICKET_ASSUMIDO:
        case MOTIVOS.TICKET_ENCERRADO:
            console.log(`⏭️ Ticket "${r.detalhe || 'sem status'}" — ${r.descricao} [${r.motivo}]`);
            break;
        case MOTIVOS.FORMATO_DUPLICADO:
            console.log('↩️ Ignorando disparo duplicado (formato numero_cliente)');
            break;
        case MOTIVOS.SEM_TELEFONE:
            console.log(`⚠️ Payload sem telefone identificável [${r.motivo}]`);
            break;
        default:
            console.log(`⚠️ Payload não reconhecido [${r.motivo}]${r.detalhe ? ' — ' + r.detalhe : ''}`);
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
// SPEC 0002 (S5): a comparação era feita com padEnd(128), o que truncava
// segredos longos (dois segredos diferentes com os mesmos 128 primeiros
// caracteres colidiam) e comparava o comprimento em texto claro antes do
// timingSafeEqual. Agora comparamos os digests SHA-256: tamanho fixo de 32
// bytes, sem truncar nada e sem depender do comprimento do segredo.
function webhookAutorizado(req) {
    if (!WEBHOOK_SECRET) return true; // fora de produção; em produção o boot exige o segredo
    const raw = req.headers['x-webhook-token'] || req.headers['authorization'] || req.query.token || req.params.token || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    const a = crypto.createHash('sha256').update(token, 'utf8').digest();
    const b = crypto.createHash('sha256').update(WEBHOOK_SECRET, 'utf8').digest();
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

        // SPEC 0002 (S1): o payload bruto contém dados pessoais — nome, telefone,
        // conteúdo da mensagem e, no bloco de simulação, CPF, nascimento e CNH.
        // Por padrão registramos só a forma do payload; o conteúdo completo exige
        // LOG_PAYLOAD=true, uma decisão explícita de depuração.
        if (config.LOG_PAYLOAD) {
            console.log('🔍 PAYLOAD RAW:', JSON.stringify(req.body, null, 2).slice(0, 4000));
        } else {
            console.log(`🔍 Webhook recebido: ${Object.keys(req.body || {}).join(', ') || '(corpo vazio)'}`);
        }

        const parsed = parsePayload(req.body);
        if (!parsed) return;

        console.log(`📩 Webhook de ${mascarar.telefone(parsed.chatId)} [${parsed.tipo}] ${mascarar.conteudo(parsed.texto)}`);

        if (!contatoPermitido(parsed.chatId)) {
            console.log(`🚫 Contato ${mascarar.telefone(parsed.chatId)} fora da lista de teste — ignorado`);
            return;
        }

        // Rate-limit por número (anti-spam / loop / proteção de custo OpenAI).
        if (!dentroDoLimite(parsed.chatId)) {
            console.warn(`🚦 Rate-limit: ${mascarar.telefone(parsed.chatId)} passou de ${RATE_LIMIT_MSGS}/${RATE_LIMIT_JANELA / 1000}s — ignorando.`);
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

// Diagnóstico de produção: confere expediente, Redis e configuração de Push.
// Não expõe segredos.
app.get('/diag', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    res.json({
        ok: true,
        ambiente: config.NODE_ENV,
        expediente: deps.expediente.consultar(),
        resetInatividadeHoras: RESET_INATIVIDADE / 3600000,
        redis: deps.repositorio.ehDuravel(),
        pushConfigurado: !!CC_PUSH_URL,
        equipeNumero: !!EQUIPE_NUMERO,
        webhookProtegido: !!WEBHOOK_SECRET,
        logDePayload: config.LOG_PAYLOAD,
        avisosDeConfiguracao: avisosConfig(config)
    });
});

// Histórico de leads qualificados (útil pra conferência rápida)
app.get('/leads', async (req, res) => {
    if (!checarAdmin(req, res)) return;
    try {
        const ids = await deps.repositorio.listarIds();
        const ativos = [];
        for (const id of ids) {
            try { const l = await deps.repositorio.buscar(id); if (l) ativos.push({ chatId: id, nome: l.nome, empresa: l.empresa, finalizado: !!l.finalizado }); } catch (_) {}
        }
        res.json({ total: ativos.length, ativos });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// =============================================================
//  INICIALIZAÇÃO
//  SPEC 0001 (PR4): o bootstrap (listen + varredor de follow-up + sinais)
//  passou a ficar dentro de iniciar(), chamada apenas quando o arquivo é
//  executado direto (`node index.js`). Assim a suíte consegue importar o
//  módulo para testar parsePayload e as proteções SEM subir servidor nem
//  disparar timers. Comportamento em produção é idêntico.
// =============================================================
function iniciar() {
setInterval(varrerFollowUps, FOLLOWUP_SWEEP).unref?.();

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log(`🏍️  IA ${EMPRESA_INFO.nome} — VIA CHATCLEAN (Webhook + Push)`);
    console.log(`📡 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Webhook: https://SEU_DOMINIO/webhook`);
    console.log(`❤️  Health:  https://SEU_DOMINIO/health`);
    console.log('🚀 ================================');
    console.log('');
    // A configuração já foi VALIDADA no carregamento do módulo (SPEC 0002):
    // o que chega aqui é válido. Restam os avisos — o que é legal, mas merece
    // atenção de quem opera.
    for (const aviso of avisosConfig(config)) console.warn(`⚠️  ${aviso}`);
    console.log(deps.repositorio.ehDuravel()
        ? '🗄️  Estado das conversas: Redis (persistente)'
        : '🗄️  Estado das conversas: memória (defina REDIS_URL para persistir entre restarts)');
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGUSR2', () => shutdown('SIGUSR2'));
}

async function shutdown(signal) {
    console.log(`\n⚠️  Recebido sinal ${signal}. Encerrando servidor...`);
    process.exit(0);
}

if (require.main === module) iniciar();

// Exportado para a suíte de testes (SPEC 0001). Em produção nada consome
// este objeto — o servidor sobe pelo iniciar() acima.
module.exports = {
    app,
    iniciar,
    usarDependencias,
    parsePayload,
    ehGrupo,
    deveResponderTicket,
    ticketStatus,
    webhookAutorizado,
    dentroDoLimite,
    montarResumo,
    departamentoLead,
    processarMensagem,
    montarMsgReativacao,
    agendarFollowUpReativacao,
    varrerFollowUps,
    enviarMensagensQuebradas,
    handleWebhook
};