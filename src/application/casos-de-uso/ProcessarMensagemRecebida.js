// =============================================================
//  CASO DE USO — PROCESSAR MENSAGEM RECEBIDA (SPEC 0008)
//
//  O turno de conversa inteiro: da mensagem do cliente ate a resposta
//  enviada, o estado salvo e, quando for a hora, o transbordo ao consultor.
//  Cobre UC-001, UC-005, UC-006, UC-007, UC-009, UC-010, UC-012, UC-013,
//  UC-015.
//
//  Ate a SPEC 0008 isso vivia dentro do index.js, misturado com servidor
//  HTTP, autenticacao, fila e endpoints administrativos (D-01). Agora e um
//  modulo que recebe as dependencias por construtor: nao conhece Express,
//  nao le process.env, nao instancia nada.
// =============================================================

const manipuladoresDeMidia = require('../midia/manipuladores');
const MontadorDeResumo = require('../../domain/atendimento/MontadorDeResumo');
const PoliticaDeTransbordo = require('../../domain/atendimento/politicas/PoliticaDeTransbordo');
const { determinarProximoCampo, aplicarCampos, detectarPerfil } = require('../../../flow');
const { DEPARTAMENTOS } = require('../../domain/catalogo/Catalogo');
const mascarar = require('../../shared/mascarar');

// 30 min sem resposta do cliente -> mensagem de reativacao (RN-070).
const TEMPO_INATIVIDADE = 30 * 60 * 1000;
// Intervalo do varredor que dispara os follow-ups vencidos.
const FOLLOWUP_SWEEP = 2 * 60 * 1000;

/**
 * @param {object} deps    Portas: canal, notificador, repositorio, extrator,
 *                         redator, transcritor, leitorDeImagem,
 *                         baixadorDeMidia, expediente.
 * @param {object} config  LOOP_MAX_TURNOS, LOOP_JANELA_MS, RESET_INATIVIDADE_MS.
 */
function criar(deps, config) {
    const LOOP_MAX_TURNOS = config.LOOP_MAX_TURNOS;
    const LOOP_JANELA_MS = config.LOOP_JANELA_MS;
    const RESET_INATIVIDADE = config.RESET_INATIVIDADE_MS;

    // Lock de processamento por instancia. Continua em memoria: o lock
    // cross-instancia e responsabilidade do repositorio (D-15 segue aberto).
    const processandoMensagem = new Map();

    // Departamento de transbordo do lead = a loja que ele escolheu (RN-041).
    // Sem loja identificada, cai no Comercial geral.
    function departamentoLead(leadData) {
        return PoliticaDeTransbordo.departamentoDaLoja(leadData.loja);
    }

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

// O resumo entregue ao vendedor no transbordo (RN-043) vive em
// src/domain/atendimento/MontadorDeResumo.js desde a SPEC 0006.
function montarResumo(leadData, chatId, opcoes = {}) {
    return MontadorDeResumo.montar(leadData, chatId, opcoes);
}

// Notifica a equipe (nota interna no ticket + WhatsApp interno) quando um lead
// e qualificado, e sinaliza a transferencia de departamento no CRM.
async function notificarEquipe(leadData, chatId, opcoes = {}) {
    const departamento = opcoes.departamento || departamentoLead(leadData);
    const resumo = montarResumo(leadData, chatId, opcoes);

    // Nota interna no ticket do próprio cliente (fica no CRM p/ o atendente)
    await deps.notificador.publicarNoTicket(chatId, resumo);
    // Resumo também por WhatsApp interno, se houver número da equipe
    await deps.notificador.enviarParaEquipe(resumo);

    // Histórico append-only de leads qualificados
    try {
        await deps.repositorio.registrarLeadFinalizado(
            MontadorDeResumo.paraRegistro(leadData, chatId, departamento, new Date().toISOString())
        );
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
        try { await deps.repositorio.salvar(chatId, leadData); } catch (_) { /* pior caso: a proxima varredura reavalia o estado */ }
        return;
    }
    leadData.followUpUltimo = msg;
    try { await deps.repositorio.salvar(chatId, leadData); } catch (_) { /* pior caso: a proxima varredura reavalia o estado */ }
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
// O agendamento do varredor fica em iniciar(), junto com o resto do bootstrap.
// Já esteve duplicado aqui — ver test/unidade/agendamento.test.js.

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
                    try { await deps.notificador.enviarParaEquipe(`⚠️ Possível loop com outro bot/IA no contato ${chatId}. A IA pausou as respostas para não entrar em ping-pong. Verificar manualmente.`); } catch (_) { /* avisar a equipe e best-effort: nao pode atrapalhar o corte do loop */ }
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

        // Mídia → Strategy por tipo (SPEC 0005). Cada manipulador vive em
        // src/application/midia/ e DESCREVE o que aconteceu; a decisão de
        // encerrar o turno, registrar no histórico ou responder fica aqui.
        const resultadoDaMidia = await manipuladoresDeMidia.tratar(
            { tipo, texto, mediaBase64, mediaUrl, mediaMimetype },
            deps
        );

        texto = resultadoDaMidia.texto;
        if (resultadoDaMidia.analiseImagem) leadData.analiseImagem = resultadoDaMidia.analiseImagem;
        for (const entrada of resultadoDaMidia.entradasNoHistorico) leadData.conversationHistory.push(entrada);
        usuarioNoHistorico = resultadoDaMidia.clienteJaNoHistorico;

        if (resultadoDaMidia.encerrarTurno) {
            if (resultadoDaMidia.mensagemAoCliente) {
                await enviarMensagem(chatId, resultadoDaMidia.mensagemAoCliente);
                if (resultadoDaMidia.registrarRespostaNoHistorico) {
                    leadData.conversationHistory.push({ role: 'assistant', content: resultadoDaMidia.mensagemAoCliente });
                }
            }
            return;
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

    return {
        processarMensagem,
        varrerFollowUps,
        montarMsgReativacao,
        agendarFollowUpReativacao,
        enviarMensagem,
        enviarMensagensQuebradas,
        montarResumo,
        notificarEquipe,
        departamentoLead,
        encaminhar,
        estaProcessando: (chatId) => processandoMensagem.has(chatId)
    };
}

module.exports = { criar, TEMPO_INATIVIDADE, FOLLOWUP_SWEEP };
