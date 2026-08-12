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
const LOOP_MAX_TURNOS = config.LOOP_MAX_TURNOS;
const LOOP_JANELA_MS  = config.LOOP_JANELA_MS;
const AGRUPAR_MS      = config.AGRUPAR_MENSAGENS_MS;
const RESET_INATIVIDADE = config.RESET_INATIVIDADE_MS;

const mascarar = require('./src/shared/mascarar');

// =============================================================
//  DEPENDÊNCIAS (SPEC 0004)
//  Todo acesso ao mundo externo passa pelas portas de
//  src/application/portas. Os adapters concretos são montados no
//  composition root e injetados aqui.
//
//  `usarDependencias` é uma COSTURA TEMPORÁRIA para os testes injetarem
//  fakes enquanto `processarMensagem` ainda vive neste arquivo. Ela morre na
//  Fase 4 (spec 0008), quando o turno virar caso de uso com injeção por
//  construtor. É melhor que a alternativa anterior — manipular o
//  require.cache do Node — mas não é o destino.
// =============================================================
const container = require('./src/main/container');
let deps = container.criar(config);
function usarDependencias(novas) {
    deps = novas;
}

// Conteúdo de negócio e fluxo. Prompts, OpenAI, ChatClean e Redis não são mais
// importados aqui: chegam pelas portas (SPEC 0004).
const { EMPRESA_INFO, PERFIS, DEPARTAMENTOS, lojaParaDepartamento } = require('./data');
const { determinarProximoCampo, aplicarCampos, detectarPerfil } = require('./flow');
const pipeline = require('./pipeline'); // Oportunidades no CRM (inerte se não configurado)

// Departamento de transbordo do lead = a loja que ele escolheu (obrigatória
// no fluxo). Sem loja identificada, cai no Comercial geral.
function departamentoLead(leadData) {
    return lojaParaDepartamento(leadData.loja) || DEPARTAMENTOS.geral;
}

const processandoMensagem = new Map(); // lock de processamento (por instância)

// Allow-list de homologação (RN-058). A lógica vive em src/shared/telefone.js
// desde a SPEC 0001; o módulo compartilhado não lê process.env, então a lista
// é passada por parâmetro.
const telefone = require('./src/shared/telefone');
const contatoPermitido = (numero) => telefone.contatoPermitido(numero, IA_ALLOWED_CONTACTS);

// =============================================================
//  ENVIO AO CLIENTE — via porta CanalDeMensagem (SPEC 0004)
//  O adapter ChatClean vive em src/infrastructure/chatclean/.
// =============================================================
async function enviarMensagem(chatId, texto) {
    return deps.canal.enviarTexto(chatId, texto);
}

// Quebra a resposta em mensagens curtas (registro de WhatsApp), a menos que
// seja um resumo/encaminhamento (mandado inteiro).
async function enviarMensagensQuebradas(chatId, textoCompleto) {
    if (/encaminhando|consultor|especialista|resumo|repassando/i.test(textoCompleto)) {
        await enviarMensagem(chatId, textoCompleto);
        return;
    }
    const partes = String(textoCompleto).split('\n').filter(p => p.trim());
    for (const parte of partes) {
        await new Promise(r => setTimeout(r, 900 + parte.length * 18));
        await enviarMensagem(chatId, parte);
    }
}

// Notifica a equipe (nota interna no ticket + WhatsApp interno) quando um lead
// é qualificado, e sinaliza a transferência de departamento no CRM.
// Monta o resumo estruturado do lead (reusado na nota da equipe e na descrição do evento).
function montarResumo(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || departamentoLead(leadData);
    const perfilNome = leadData.perfilKey && PERFIS[leadData.perfilKey]
        ? PERFIS[leadData.perfilKey].nome : 'Não informado';
    const temDadosSim = leadData.nomeCompleto || leadData.cpf || leadData.dataNascimento || leadData.telefone || leadData.cnh || leadData.corModelo;
    return `🏍️ LEAD QUALIFICADO — Avelloz Campina${opcoes.tagExtra ? ' [' + opcoes.tagExtra + ']' : ''}\n\n` +
        `Contato: ${leadData.nome || 'Lead'} (${chatId})\n` +
        `Perfil: ${perfilNome}\n` +
        `Finalidade: ${leadData.finalidade || 'Não informado'}\n` +
        `Transporte hoje: ${leadData.transporteAtual || 'Não informado'}\n` +
        `Gasto atual: ${leadData.gastoMensal || 'Não informado'}\n` +
        `Situação de moto: ${leadData.situacaoMoto || 'Não informado'}\n` +
        `Modelo de interesse: ${leadData.modeloInteresse || 'Não informado'}\n` +
        `Forma de pagamento: ${leadData.formaPagamento || 'Não informado'}\n` +
        `Loja escolhida: ${leadData.loja || 'Não informada'}\n` +
        (temDadosSim
            ? `\nDados p/ simulação:\n` +
              `  Nome completo: ${leadData.nomeCompleto || 'Não informado'}\n` +
              `  CPF: ${leadData.cpf || 'Não informado'}\n` +
              `  Nascimento: ${leadData.dataNascimento || 'Não informado'}\n` +
              `  Telefone: ${leadData.telefone || 'Não informado'}\n` +
              `  CNH: ${leadData.cnh || 'Não informado'}\n` +
              `  Cor/modelo: ${leadData.corModelo || 'Não informado'}\n`
            : '') +
        (opcoes.proximoExpediente ? `Retorno sugerido: ${opcoes.proximoExpediente}\n` : '') +
        `\n➡️ Transferir para o departamento ${departamento}`;
}

async function notificarEquipe(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || departamentoLead(leadData);
    const perfilNome = leadData.perfilKey && PERFIS[leadData.perfilKey]
        ? PERFIS[leadData.perfilKey].nome : 'Não informado';
    const resumo = montarResumo(leadData, chatId, opcoes);

    // Nota interna no ticket do próprio cliente (fica no CRM p/ o atendente)
    await deps.notificador.publicarNoTicket(chatId, resumo);
    // Resumo também por WhatsApp interno, se houver número da equipe
    await deps.notificador.enviarParaEquipe(resumo);

    // Histórico append-only de leads qualificados
    try {
        await deps.repositorio.registrarLeadFinalizado({
            chatId, nome: leadData.nome || null, perfil: perfilNome,
            finalidade: leadData.finalidade || null, transporteAtual: leadData.transporteAtual || null,
            gastoMensal: leadData.gastoMensal || null, modeloInteresse: leadData.modeloInteresse || null,
            formaPagamento: leadData.formaPagamento || null, loja: leadData.loja || null,
            departamento, data: new Date().toISOString()
        });
    } catch (e) { console.error('❌ appendLeadFinalizado:', e.message); }

    console.log(`✅ Equipe notificada — lead ${leadData.nome || ''} (${mascarar.telefone(chatId)}) → ${departamento}`);
    return true;
}

// A state machine (determinarProximoCampo / aplicarCampos / detectarPerfil)
// vive em ./flow para ser reusada pelo tester local sem duplicar lógica.

// =============================================================
//  FOLLOW-UP DE REATIVAÇÃO (durável — sobrevive a redeploy)
//  Guarda leadData.followUpDueAt e um varredor dispara os vencidos.
// =============================================================
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
        try { await deps.repositorio.salvar(chatId, leadData); } catch (_) {}
        return;
    }
    leadData.followUpUltimo = msg;
    try { await deps.repositorio.salvar(chatId, leadData); } catch (_) {}
    await enviarMensagem(chatId, msg);
    console.log(`📩 Follow-up de reativação enviado para ${mascarar.telefone(chatId)}`);
}

async function varrerFollowUps() {
    try {
        const ids = await deps.repositorio.listarIds();
        const agora = Date.now();
        for (const chatId of ids) {
            if (processandoMensagem.has(chatId)) continue;
            let leadData;
            try { leadData = await deps.repositorio.buscar(chatId); } catch (_) { continue; }
            if (!leadData || leadData.finalizado) continue;
            if (!leadData.followUpDueAt || leadData.followUpDueAt > agora) continue;
            await dispararFollowUpReativacao(chatId, leadData);
        }
    } catch (e) {
        console.error('Erro no varredor de follow-up:', e.message);
    }
}
setInterval(varrerFollowUps, FOLLOWUP_SWEEP).unref?.();

// =============================================================
//  IA — via portas ExtratorDeInformacoes, RedatorDeResposta e
//  LeitorDeImagem (SPEC 0004). Os adapters OpenAI vivem em
//  src/infrastructure/openai/; aqui ficaram so as chamadas.
// =============================================================
async function extrairInformacoesComIA(mensagem, campoAtual, historicoRecente = []) {
    return deps.extrator.extrair(mensagem, campoAtual, historicoRecente);
}

// Propaga a excecao de proposito: quem chama envia a mensagem de instabilidade.
async function gerarRespostaIA(leadData, mensagemCliente, proximoCampo, historicoRecente = [], expediente = null) {
    return deps.redator.redigir({
        leadData,
        mensagemCliente,
        proximoCampo,
        historico: historicoRecente,
        expediente
    });
}

// A IA "enxerga" a imagem enviada pelo cliente e descreve o conteudo para usar
// no atendimento. Retorna null se falhar.
async function analisarImagem(mediaUrl) {
    return deps.leitorDeImagem.descrever(mediaUrl);
}

// Resposta quando o lead JA foi encaminhado ao especialista: tira duvidas
// pontuais de forma natural, sem refazer a qualificacao nem repetir o resumo.
async function gerarRespostaPosEncaminhamento(leadData, mensagemCliente, historicoRecente = []) {
    return deps.redator.redigirAposTransbordo({ mensagemCliente, historico: historicoRecente });
}

// =============================================================
//  ENCAMINHAMENTO PARA HUMANO
// =============================================================
async function encaminhar(chatId, leadData, departamento, mensagemCliente, historico, expediente = null) {
    const exp = expediente || deps.expediente.consultar();
    // Deixa a IA escrever o handoff de forma calorosa (usa o branch de qualificação completa)
    leadData.qualificacaoCompleta = true;
    let msg;
    try {
        msg = await gerarRespostaIA(leadData, mensagemCliente, null, historico, exp);
    } catch (_) {
        msg = exp.aberto
            ? 'Perfeito! Já tô repassando tudo pro nosso consultor. Ele assume seu atendimento aqui rapidinho, combinado? 😊'
            : `Perfeito, deixei tudo registrado! Nosso consultor te retorna ${exp.proximoExpediente}. Enquanto isso, ficou alguma dúvida sobre a moto? 😊`;
    }
    await enviarMensagem(chatId, msg);
    leadData.conversationHistory.push({ role: 'assistant', content: msg });
    await notificarEquipe(leadData, chatId, { departamento, tagExtra: exp.aberto ? undefined : 'FORA DE EXPEDIENTE', proximoExpediente: exp.aberto ? null : exp.proximoExpediente });
    leadData.finalizado = true;
    leadData.followUpDueAt = null;
}

// =============================================================
//  PROCESSAMENTO DE MENSAGEM
// =============================================================
async function processarMensagem({ chatId, contactId, texto, tipo, mediaBase64, mediaUrl, mediaMimetype, quotedText, nomeContato }) {
    if (processandoMensagem.get(chatId)) {
        console.log(`⚠️ Já processando mensagem de ${mascarar.telefone(chatId)}. Ignorando.`);
        return;
    }
    processandoMensagem.set(chatId, true);
    const timeoutId = setTimeout(() => {
        if (processandoMensagem.get(chatId)) {
            console.log(`⏱️ Timeout: liberando processamento para ${mascarar.telefone(chatId)}`);
            processandoMensagem.delete(chatId);
        }
    }, 60000);

    // Lock cross-instância (Redis): impede que outro container processe o mesmo
    // lead ao mesmo tempo. Sem Redis, é no-op (o lock em memória acima já basta).
    const lockRedis = await deps.repositorio.adquirirLock(chatId, 60000);
    if (!lockRedis) {
        console.log(`🔒 ${mascarar.telefone(chatId)} já está sendo processado por outra instância — pulando.`);
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
        return;
    }

    let leadData = null;
    try {
        leadData = await deps.repositorio.buscar(chatId);
        // Reset automático por inatividade: se passou do limite (padrão 24h) sem
        // interação, descarta o atendimento antigo e começa um novo do zero.
        if (leadData && leadData.ultimaInteracao && (Date.now() - leadData.ultimaInteracao) > RESET_INATIVIDADE) {
            console.log(`🕛 ${mascarar.telefone(chatId)}: inativo há mais de ${(RESET_INATIVIDADE / 3600000).toFixed(0)}h — reiniciando atendimento.`);
            await deps.repositorio.remover(chatId);
            leadData = null;
        }
        if (!leadData) leadData = { conversationHistory: [] };
        if (nomeContato && !leadData.nome) leadData.nome = nomeContato;
        if (contactId && !leadData.contactId) leadData.contactId = contactId; // p/ criar oportunidade no CRM ao agendar
        leadData.ultimaInteracao = Date.now(); // marca esta interação
        leadData.followUpDueAt = null; // nova mensagem cancela reativação pendente

        // Mídia (imagem/vídeo/documento) já registra o turno do cliente no
        // histórico com uma descrição rica; quando isso acontece, marcamos aqui
        // para NÃO empurrar de novo o texto-placeholder no fim (evita duplicar).
        let usuarioNoHistorico = false;

        // Reset
        if (String(texto).toLowerCase() === '/reset') {
            await deps.repositorio.remover(chatId);
            leadData = null;
            await enviarMensagem(chatId, '🔄 Conversa resetada! Vamos começar de novo 😊');
            return;
        }

        // --- Blindagem anti-loop (contra outras IAs / auto-respondedores) ---
        // Se o contato dispara muitas mensagens numa janela curta, ou repete a
        // mesma mensagem, PAUSA as respostas — evita ping-pong infinito com outro
        // bot (ex.: IA da operadora). Cobre também o caminho pós-encaminhamento.
        {
            const agoraMs = Date.now();
            leadData.turnosTs = (leadData.turnosTs || []).filter(t => agoraMs - t < LOOP_JANELA_MS);
            leadData.turnosTs.push(agoraMs);
            if (leadData.turnosTs.length <= 2) leadData.loopAvisado = false; // conversa normalizou
            const textoNorm = String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
            leadData.ultimasMsgs = leadData.ultimasMsgs || [];
            const repetida = textoNorm.length > 1 && leadData.ultimasMsgs.filter(t => t === textoNorm).length >= 2;
            leadData.ultimasMsgs.push(textoNorm);
            if (leadData.ultimasMsgs.length > 6) leadData.ultimasMsgs.shift();

            if (leadData.turnosTs.length > LOOP_MAX_TURNOS || repetida) {
                if (!leadData.loopAvisado) {
                    console.warn(`🔁 Possível loop/bot em ${mascarar.telefone(chatId)} (${leadData.turnosTs.length} msgs/${LOOP_JANELA_MS / 60000}min${repetida ? ', msg repetida' : ''}) — pausando respostas.`);
                    try { await deps.notificador.enviarParaEquipe(`⚠️ Possível loop com outro bot/IA no contato ${chatId}. A IA pausou as respostas para não entrar em ping-pong. Verificar manualmente.`); } catch (_) {}
                    leadData.loopAvisado = true;
                }
                return; // não responde — corta o loop
            }
        }

        // Lead já encaminhado → só tira dúvidas pontuais, sem refazer o funil
        if (leadData.finalizado) {
            const histPos = leadData.conversationHistory.slice(-30).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant', content: h.content
            }));
            const respPos = await gerarRespostaPosEncaminhamento(leadData, texto, histPos);
            await enviarMensagensQuebradas(chatId, respPos);
            leadData.conversationHistory.push({ role: 'user', content: texto });
            leadData.conversationHistory.push({ role: 'assistant', content: respPos });
            return;
        }

        // Imagem → a IA ENXERGA (visão gpt-4o) e usa o conteúdo na resposta.
        if (tipo === 'image') {
            const desc = await analisarImagem(mediaUrl);
            if (desc) {
                leadData.analiseImagem = desc; // consumido na geração da resposta
                console.log(`🖼️ Visão: ${desc}`);
                leadData.conversationHistory.push({ role: 'user', content: `[O cliente enviou uma imagem] — ${desc}` });
            } else {
                leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou uma imagem]' });
            }
            texto = 'Enviei uma imagem.';
            usuarioNoHistorico = true;
        }

        // Documento (PDF/planilha/arquivo) → registra p/ o especialista (não é imagem).
        // Acusa o recebimento e ENCERRA o turno (sem gerar outra mensagem em seguida);
        // a próxima mensagem do cliente retoma a qualificação normalmente.
        if (tipo === 'document') {
            const ack = 'Recebi o arquivo! Vou deixar registrado pro nosso consultor analisar junto com você. Quer me adiantar do que se trata? 😊';
            await enviarMensagem(chatId, ack);
            leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou um documento]' });
            leadData.conversationHistory.push({ role: 'assistant', content: ack });
            return;
        }

        // Vídeo → transcreve o áudio do vídeo (Whisper aceita mp4) p/ entender o que é falado.
        if (tipo === 'video') {
            let videoBuffer = null;
            try {
                if (mediaBase64) videoBuffer = Buffer.from(mediaBase64, 'base64');
                else if (mediaUrl) videoBuffer = await deps.baixadorDeMidia.baixar(mediaUrl, 60000);
            } catch (e) { console.error('❌ Erro ao baixar vídeo:', e.message); }

            let fala = '';
            if (videoBuffer) {
                try {
                    fala = await deps.transcritor.transcrever({
                        buffer: videoBuffer,
                        nome: 'video.mp4',
                        mimetype: mediaMimetype || 'video/mp4'
                    });
                } catch (e) { console.error('❌ Erro ao transcrever vídeo:', e.message); }
            }
            if (fala) {
                console.log(`🎬 Vídeo transcrito: "${fala}"`);
                leadData.conversationHistory.push({ role: 'user', content: `[O cliente enviou um vídeo] Fala no vídeo: ${fala}` });
                texto = fala;
            } else {
                leadData.conversationHistory.push({ role: 'user', content: '[O cliente enviou um vídeo]' });
                texto = 'Enviei um vídeo.';
            }
            usuarioNoHistorico = true;
        }

        // Áudio → transcrição (Whisper). Se falhar, pede texto.
        if (tipo === 'audio' || tipo === 'ptt') {
            let audioBuffer = null;
            try {
                if (mediaBase64) {
                    audioBuffer = Buffer.from(mediaBase64, 'base64');
                } else if (mediaUrl) {
                    audioBuffer = await deps.baixadorDeMidia.baixar(mediaUrl, 30000);
                }
            } catch (e) { console.error('❌ Erro ao baixar áudio:', e.message); }

            if (audioBuffer) {
                try {
                    texto = await deps.transcritor.transcrever({
                        buffer: audioBuffer,
                        nome: 'audio.ogg',
                        mimetype: mediaMimetype || 'audio/ogg'
                    });
                    console.log(`📝 Transcrição: "${texto}"`);
                } catch (e) {
                    console.error('❌ Erro ao transcrever áudio:', e.message);
                    await enviarMensagem(chatId, 'Recebi seu áudio! Por aqui prefiro que a gente converse por texto pra eu anotar tudo certinho. Pode me escrever? 😊');
                    return;
                }
            } else {
                await enviarMensagem(chatId, 'Recebi seu áudio, mas não consegui abrir por aqui. Pode me escrever, por favor? 😊');
                return;
            }
        }

        if (quotedText) {
            texto = `[RESPOSTA À MENSAGEM: "${quotedText}"]\n${texto}`;
        }

        // Expediente do time: define modo normal (transfere ao vivo) x plantão (agenda retorno)
        const exp = deps.expediente.consultar();

        // --- Extração ---
        const proximoCampoAntes = determinarProximoCampo(leadData);
        const historicoRecente = leadData.conversationHistory.slice(-6).map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant', content: h.content
        }));
        const extraido = await extrairInformacoesComIA(texto, proximoCampoAntes?.campo, historicoRecente.slice(-4));

        // Sinais transitórios (valem só para esta resposta)
        leadData.objecaoAtiva = null;
        leadData.perguntouAgora = null;

        if (extraido) {
            aplicarCampos(leadData, extraido);
            if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
            if (extraido.perguntou) leadData.perguntouAgora = true;
            if (extraido.tipoContato) leadData.tipoContato = extraido.tipoContato;

            // Detecta o PERFIL do cliente (para o gancho de dor) a partir do que
            // foi dito. Reavalia sempre que ainda não há perfil ou quando o cliente
            // corrigiu transporte/situação de moto/finalidade.
            const corr = Array.isArray(extraido.correcao) ? extraido.correcao : [];
            if (corr.includes('transporteAtual') || corr.includes('situacaoMoto') || corr.includes('finalidade')) {
                leadData.perfilKey = null;
            }
            if (!leadData.perfilKey) {
                leadData.perfilKey = detectarPerfil(
                    [extraido.finalidade, extraido.transporteAtual, extraido.situacaoMoto, texto].filter(Boolean).join(' ')
                );
            }

            // Cliente ATUAL pedindo pós-venda/assistência → encaminha para Pós-venda
            if (extraido.tipoContato === 'cliente' && !leadData.finalizado) {
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await enviarMensagem(chatId, 'Entendi! Vou te encaminhar pro nosso time de pós-venda, que já cuida disso com você. Pode me dizer qual unidade você comprou (Matriz, Malvinas ou Monteiro)?');
                await notificarEquipe(leadData, chatId, { departamento: DEPARTAMENTOS.posvenda, tagExtra: 'CLIENTE ATUAL' });
                leadData.finalizado = true;
                return;
            }

            // Pediu explicitamente falar com humano → encaminha ao consultor (loja/geral)
            if (extraido.querFalarComHumano && !leadData.finalizado) {
                const hist = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await encaminhar(chatId, leadData, departamentoLead(leadData), texto, hist, exp);
                return;
            }
        }

        // --- Próximo passo + resposta ---
        const proximoCampoDepois = determinarProximoCampo(leadData);

        const respHist = leadData.conversationHistory.slice(-10).map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant', content: h.content
        }));
        let resposta;
        try {
            resposta = await gerarRespostaIA(leadData, texto, proximoCampoDepois, respHist, exp);
        } catch (e) {
            // Instabilidade na OpenAI: NÃO deixar o cliente sem resposta. Manda um
            // fallback caloroso e encerra o turno (o que já foi extraído fica salvo;
            // a próxima mensagem retoma a qualificação de onde parou).
            console.error(`❌ Erro ao gerar resposta IA para ${mascarar.telefone(chatId)}:`, e.message);
            await enviarMensagem(chatId, 'Opa, tive uma instabilidade rapidinha por aqui 😅 Pode me mandar de novo o que você disse?');
            if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
            return;
        }

        leadData.objecaoAtiva = null;    // consumidos
        leadData.perguntouAgora = null;
        leadData.analiseImagem = null;

        await enviarMensagensQuebradas(chatId, resposta);
        if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
        leadData.conversationHistory.push({ role: 'assistant', content: resposta });
        if (leadData.conversationHistory.length > 100) {
            leadData.conversationHistory = leadData.conversationHistory.slice(-100);
        }

        // Qualificação completa → notifica a equipe (transbordo p/ a loja) e encerra.
        if (leadData.qualificacaoCompleta && !leadData.finalizado) {
            await notificarEquipe(leadData, chatId, {
                departamento: departamentoLead(leadData),
                tagExtra: exp.aberto ? undefined : 'FORA DE EXPEDIENTE — AGENDAR RETORNO',
                proximoExpediente: exp.aberto ? null : exp.proximoExpediente
            });
            leadData.finalizado = true;
        } else if (!leadData.finalizado) {
            agendarFollowUpReativacao(leadData);
        }

    } catch (e) {
        console.error(`❌ Erro ao processar mensagem de ${mascarar.telefone(chatId)}:`, e);
    } finally {
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
        if (leadData) {
            try { await deps.repositorio.salvar(chatId, leadData); }
            catch (e) { console.error('❌ Erro ao salvar estado da conversa:', e.message); }
        }
        await deps.repositorio.liberarLock(chatId);
    }
}

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
    if (processandoMensagem.get(chatId)) return; // já rodando: será drenado ao terminar
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

// Diagnóstico de produção: confere expediente, Redis e config de Push/pipeline.
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
        avisosDeConfiguracao: avisosConfig(config),
        pipeline: pipeline.diag()
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