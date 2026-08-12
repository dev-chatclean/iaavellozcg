// =============================================================
//  SERVIDOR HTTP (SPEC 0018)
//
//  Monta o Express com as rotas e as protecoes da borda. E o ultimo pedaco
//  que saiu do index.js — que agora e so bootstrap.
//
//  Recebe tudo por parametro: configuracao, o caso de uso do atendimento, a
//  fila de turnos e as portas. Nao instancia nada e nao le process.env.
// =============================================================

const express = require('express');

const protecoes = require('./protecoes');
const traduzirPayload = require('./traduzirPayload');
const MensagemRecebida = require('../../domain/mensageria/MensagemRecebida');
const mascarar = require('../../shared/mascarar');
const telefone = require('../../shared/telefone');

const FALLBACK_MIDIA_NAO_SUPORTADA =
    'Pode me mandar por texto o que você precisa? Assim consigo te ajudar melhor 🙂';

/**
 * @param {object} opcoes
 * @param {object} opcoes.config       Configuracao validada.
 * @param {object} opcoes.atendimento  Caso de uso do turno.
 * @param {object} opcoes.fila         Fila de turnos.
 * @param {object} opcoes.repositorio  Porta de persistencia (para /leads e /diag).
 * @param {object} opcoes.expediente   Porta de expediente (para /diag).
 * @param {(config: object) => string[]} opcoes.avisosDeConfiguracao
 */
function criar({ config, atendimento, fila, repositorio, expediente, avisosDeConfiguracao }) {
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    const autorizado = protecoes.criarAutenticacao(config.WEBHOOK_SECRET);
    const dentroDoLimite = protecoes.criarControleDeVazao({
        limite: config.RATE_LIMIT_MSGS,
        janelaMs: config.RATE_LIMIT_JANELA_MS
    });
    const idempotencia = protecoes.criarControleDeIdempotencia();
    const checarAdmin = protecoes.criarGuardaAdministrativa(config.ADMIN_KEY);
    const traduzir = traduzirPayload.criar({
        ignorarGrupos: config.IGNORAR_GRUPOS,
        apenasPendentes: config.IA_SO_PENDENTES
    });

    const contatoPermitido = (numero) => telefone.contatoPermitido(numero, config.IA_ALLOWED_CONTACTS);

    async function handleWebhook(req, res) {
        res.status(200).json({ status: 'ok' }); // responde rapido (evita retry do ChatClean)
        try {
            if (!autorizado(req)) {
                console.warn('⚠️ Webhook com token inválido ou ausente — ignorado.');
                return;
            }

            // O payload bruto contem dados pessoais (spec 0002, risco S1): por
            // padrao registramos so a forma; o conteudo exige LOG_PAYLOAD=true.
            if (config.LOG_PAYLOAD) {
                console.log('🔍 PAYLOAD RAW:', JSON.stringify(req.body, null, 2).slice(0, 4000));
            } else {
                console.log(`🔍 Webhook recebido: ${Object.keys(req.body || {}).join(', ') || '(corpo vazio)'}`);
            }

            const mensagem = traduzir(req.body);
            if (!mensagem) return;

            console.log(
                `📩 Webhook de ${mascarar.telefone(mensagem.chatId)} [${mensagem.tipo}] ${mascarar.conteudo(mensagem.texto)}`
            );

            if (!contatoPermitido(mensagem.chatId)) {
                console.log(`🚫 Contato ${mascarar.telefone(mensagem.chatId)} fora da lista de teste — ignorado`);
                return;
            }

            if (!dentroDoLimite(mensagem.chatId)) {
                console.warn(
                    `🚦 Rate-limit: ${mascarar.telefone(mensagem.chatId)} passou de ${config.RATE_LIMIT_MSGS}/${config.RATE_LIMIT_JANELA_MS / 1000}s — ignorando.`
                );
                return;
            }

            if (idempotencia.jaProcessada(mensagem.msgId)) {
                console.log(`↩️ Mensagem duplicada (${mensagem.msgId}) ignorada`);
                return;
            }

            // Midia sem tratamento proprio (sticker, localizacao...) recebe o
            // fallback humanizado e nao entra na fila.
            if (!MensagemRecebida.ehTipoConhecido(mensagem.tipo)) {
                await atendimento.enviarMensagem(mensagem.chatId, FALLBACK_MIDIA_NAO_SUPORTADA);
                return;
            }

            // Enfileira (nunca descarta): agrupa mensagens rapidas e processa em serie.
            fila.enfileirar(mensagem);
        } catch (e) {
            console.error('❌ Erro no handler do webhook:', e);
        }
    }

    // Aceita o token embutido no path (/webhook/<segredo>) ou em /webhook.
    app.post('/webhook', handleWebhook);
    app.post('/webhook/:token', handleWebhook);

    // Alguns paineis validam a URL com GET antes de disparar; sem isto, a URL
    // com token no caminho daria 404 e o provedor nao dispararia.
    const pingDoWebhook = (req, res) => res.status(200).json({ status: 'ok' });
    app.get('/webhook', pingDoWebhook);
    app.get('/webhook/:token', pingDoWebhook);

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
    });

    // Diagnostico de producao. Nao expoe segredos.
    app.get('/diag', async (req, res) => {
        if (!checarAdmin(req, res)) return;
        res.json({
            ok: true,
            ambiente: config.NODE_ENV,
            expediente: expediente.consultar(),
            resetInatividadeHoras: config.RESET_INATIVIDADE_MS / 3600000,
            redis: repositorio.ehDuravel(),
            pushConfigurado: !!config.CC_PUSH_URL,
            equipeNumero: !!config.EQUIPE_NUMERO,
            webhookProtegido: !!config.WEBHOOK_SECRET,
            logDePayload: config.LOG_PAYLOAD,
            avisosDeConfiguracao: avisosDeConfiguracao(config)
        });
    });

    // Historico de atendimentos ativos (conferencia rapida).
    app.get('/leads', async (req, res) => {
        if (!checarAdmin(req, res)) return;
        try {
            const ids = await repositorio.listarIds();
            const ativos = [];
            for (const id of ids) {
                try {
                    const lead = await repositorio.buscar(id);
                    if (lead) ativos.push({ chatId: id, nome: lead.nome, finalizado: !!lead.finalizado });
                } catch (e) {
                    console.error('❌ Erro ao ler atendimento:', e.message);
                }
            }
            res.json({ total: ativos.length, ativos });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return { app, handleWebhook, protecoes: { autorizado, dentroDoLimite, idempotencia, checarAdmin } };
}

module.exports = { criar, FALLBACK_MIDIA_NAO_SUPORTADA };
