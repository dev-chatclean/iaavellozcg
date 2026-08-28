// =============================================================
//  CASO DE USO — PROCESSAR MENSAGEM RECEBIDA
//
//  A sequencia de um turno de atendimento, do momento em que a mensagem
//  chega ate a resposta sair: tomar o lock, carregar o estado, interpretar a
//  midia, extrair os campos do funil, decidir se transborda, redigir e
//  enviar.
//
//  Nao decide NENHUMA regra de negocio por conta propria: todas vem dos
//  colaboradores injetados. Este arquivo e a ORDEM das coisas, nao o
//  conteudo delas.
//
//  Os 29 colaboradores abaixo sao muitos, e isso e informacao: mede o quanto
//  um turno de atendimento realmente coordena. Reduzi-los e trabalho das
//  proximas fatias — mas so depois desta relocacao estar provada.
//
//  NOTA DE LEITURA: o corpo abaixo foi movido VERBATIM do index.js, sem
//  reindentar, para o diff desta fatia ser uma relocacao pura e revisavel
//  linha a linha. A limpeza interna vem em commits separados.
// =============================================================

/**
 * @param {object} deps colaboradores do turno (ver lista no destructuring)
 */
function criar(deps) {
const {
    EQUIPE_NUMERO,
    LOOP_JANELA_MS,
    MAX_RESPOSTAS_POS_HANDOFF,
    OFICINA,
    PEDE_AGILIDADE,
    PEDE_TRANSFERENCIA,
    PROMETE_TRANSFERENCIA,
    RESET_INATIVIDADE,
    SINAL_ENCERRAMENTO,
    agendarFollowUpReativacao,
    aplicarCampos,
    ccPush,
    departamentoLead,
    departamentoPosVenda,
    detectarModeloMencionado,
    detectarPerfil,
    determinarProximoCampo,
    encaminhar,
    enviarMensagem,
    enviarMensagensQuebradas,
    estaEmExpediente,
    extrairInformacoesComIA,
    gerarRespostaIA,
    gerarRespostaPosEncaminhamento,
    lockDeAtendimento,
    manipuladoresDeMidia,
    notificarEquipe,
    politicaAntiLoop,
    store
} = deps;

async function processarMensagem({ chatId, contactId, texto, tipo, mediaBase64, mediaUrl, mediaMimetype, quotedText, nomeContato }) {
    const trava = await lockDeAtendimento.adquirir(chatId);
    if (!trava.ok) {
        if (trava.motivo === 'em_processamento') {
            console.log(`\u{26A0}\u{FE0F} Já processando mensagem de ${chatId}. Ignorando.`);
        } else {
            console.log(`\u{1F512} ${chatId} já está sendo processado por outra instância — pulando.`);
        }
        return;
    }

    let leadData = null;
    try {
        leadData = await store.getLead(chatId);
        // Reset automático por inatividade: se passou do limite (padrão 24h) sem
        // interação, descarta o atendimento antigo e começa um novo do zero.
        if (leadData && leadData.ultimaInteracao && (Date.now() - leadData.ultimaInteracao) > RESET_INATIVIDADE) {
            console.log(`🕛 ${chatId}: inativo há mais de ${(RESET_INATIVIDADE / 3600000).toFixed(0)}h — reiniciando atendimento.`);
            await store.deleteLead(chatId);
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
            await store.deleteLead(chatId);
            leadData = null;
            await enviarMensagem(chatId, '🔄 Conversa resetada! Vamos começar de novo 😊');
            return;
        }

        // Blindagem anti-loop (RN-056): a regra vive em
        // src/domain/atendimento/politicas/PoliticaAntiLoop.js. Aqui fica so o
        // efeito — logar e avisar a equipe — porque isso e I/O.
        const loop = politicaAntiLoop.avaliar(leadData, texto, Date.now());
        if (loop.pausar) {
            if (loop.avisar) {
                console.warn(`\u{1F501} Possível loop/bot em ${chatId} (${loop.turnosNaJanela} msgs/${LOOP_JANELA_MS / 60000}min${loop.motivo === 'repeticao' ? ', msg repetida' : ''}) — pausando respostas.`);
                if (EQUIPE_NUMERO) {
                    try {
                        await ccPush(EQUIPE_NUMERO, { body: `\u{26A0}\u{FE0F} Possível loop com outro bot/IA no contato ${chatId}. A IA pausou as respostas para não entrar em ping-pong. Verificar manualmente.` });
                    } catch (_) {
                        // O aviso a equipe e melhor-esforco: se o push falhar,
                        // a pausa do loop ja aconteceu e e o que importa. Nao
                        // vale derrubar o turno por causa do aviso.
                    }
                }
            }
            return; // nao responde — corta o loop
        }

        // Lead já encaminhado → só tira dúvidas pontuais, sem refazer o funil.
        // E agora existe um FIM: quando o cliente sinaliza que só vai aguardar, a IA
        // se despede e CALA para sempre. Antes ela era obrigada a terminar toda
        // resposta com uma pergunta e nunca parava — o cliente respondia "não" e ela
        // perguntava de novo, indefinidamente, ainda por cima falando por cima do
        // consultor humano que já tinha assumido o ticket.
        if (leadData.finalizado) {
            // Já se despediu: silêncio absoluto. Só registra a mensagem no histórico
            // para o consultor ter o contexto completo no ticket.
            if (leadData.conversaEncerrada) {
                leadData.conversationHistory.push({ role: 'user', content: texto });
                console.log(`🤫 ${chatId}: conversa encerrada pós-transferência — IA em silêncio.`);
                return;
            }

            leadData.respostasPosHandoff = (leadData.respostasPosHandoff || 0) + 1;
            const sinalFim = SINAL_ENCERRAMENTO.test(texto);
            const estourouTeto = leadData.respostasPosHandoff > MAX_RESPOSTAS_POS_HANDOFF;

            if (sinalFim || estourouTeto) {
                leadData.conversaEncerrada = true;
                const despedida = 'Combinado! Nosso consultor assume o seu atendimento daqui 😊';
                await enviarMensagem(chatId, despedida);
                leadData.conversationHistory.push({ role: 'user', content: texto });
                leadData.conversationHistory.push({ role: 'assistant', content: despedida });
                console.log(`👋 ${chatId}: encerrado pós-transferência (${sinalFim ? 'cliente sinalizou fim' : `teto de ${MAX_RESPOSTAS_POS_HANDOFF} respostas`}).`);
                return;
            }

            const histPos = leadData.conversationHistory.slice(-30).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant', content: h.content
            }));
            const respPos = await gerarRespostaPosEncaminhamento(leadData, texto, histPos);
            await enviarMensagensQuebradas(chatId, respPos);
            leadData.conversationHistory.push({ role: 'user', content: texto });
            leadData.conversationHistory.push({ role: 'assistant', content: respPos });
            return;
        }

        // Cada tipo de midia tem seu manipulador em src/application/midia. Dois
        // desfechos possiveis: o turno CONTINUA (a midia virou texto) ou
        // ENCERRA aqui, com uma resposta pronta. Antes isso eram quatro blocos
        // `if` empilhados, cada um com seu proprio `return` no meio.
        const manipuladorDeMidia = manipuladoresDeMidia.para(tipo);
        if (manipuladorDeMidia) {
            const r = await manipuladorDeMidia({ mediaUrl, mediaBase64, mediaMimetype });

            if (r.encerra) {
                if (r.resposta) await enviarMensagem(chatId, r.resposta);
                for (const h of r.historico) leadData.conversationHistory.push(h);
                return;
            }

            for (const h of r.historico) leadData.conversationHistory.push(h);
            if (r.analiseImagem) leadData.analiseImagem = r.analiseImagem;
            if (r.usuarioNoHistorico) usuarioNoHistorico = true;
            texto = r.texto;
        }

        if (quotedText) {
            texto = `[RESPOSTA À MENSAGEM: "${quotedText}"]\n${texto}`;
        }

        // Expediente do time: define modo normal (transfere ao vivo) x plantão (agenda retorno)
        const exp = estaEmExpediente();

        // --- Extração ---
        const proximoCampoAntes = determinarProximoCampo(leadData);
        const historicoRecente = leadData.conversationHistory.slice(-6).map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant', content: h.content
        }));
        const extraido = await extrairInformacoesComIA(texto, proximoCampoAntes?.campo, historicoRecente.slice(-4));

        // Sinais transitórios (valem só para esta resposta)
        leadData.objecaoAtiva = null;
        leadData.perguntouAgora = null;
        leadData.assuntoAgora = null;

        if (extraido) {
            aplicarCampos(leadData, extraido);
            if (extraido.objecao) leadData.objecaoAtiva = extraido.objecao;
            if (extraido.perguntou) leadData.perguntouAgora = true;
            if (extraido.tipoContato) leadData.tipoContato = extraido.tipoContato;
            if (extraido.assunto) leadData.assuntoAgora = extraido.assunto; // peças/revisão ou indicação

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

            // Cliente ATUAL pedindo pós-venda/assistência → encaminha para Pós-venda.
            // Se o assunto for peças/revisão, já entrega o contato da oficina junto
            // (é quem realmente resolve) para o cliente não ficar esperando.
            if (extraido.tipoContato === 'cliente' && !leadData.finalizado) {
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                const msgCliente = extraido.assunto === 'pecas_revisao'
                    ? `Entendi! Pra ${OFICINA.assuntos} quem te atende direitinho é a nossa oficina, no ${OFICINA.telefone} 😊 Já vou avisar nosso time de pós-venda aqui também. Você comprou em qual unidade (Matriz, Malvinas ou Monteiro)?`
                    : 'Entendi! Vou te encaminhar pro nosso time de pós-venda, que já cuida disso com você. Pode me dizer qual unidade você comprou (Matriz, Malvinas ou Monteiro)?';
                await enviarMensagem(chatId, msgCliente);
                await notificarEquipe(leadData, chatId, { departamento: departamentoPosVenda(leadData), tagExtra: 'CLIENTE ATUAL' });
                leadData.finalizado = true;
                return;
            }

            // Pediu explicitamente falar com humano → encaminha ao consultor (loja/geral).
            // O regex é rede de segurança: numa frase como "não quero falar com
            // humano, me transfira" a negação confunde o modelo e ele devolve false,
            // deixando o cliente falando sozinho. Só padrões inequívocos entram aqui.
            if ((extraido.querFalarComHumano || PEDE_TRANSFERENCIA.test(texto)) && !leadData.finalizado) {
                const hist = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                await encaminhar(chatId, leadData, departamentoLead(leadData), texto, hist, exp);
                return;
            }

            // Sinalizou PRESSA sem pedir transferência ("pouco tempo", "direto ao
            // assunto"). Abandona o funil: o único dado que ainda falta para
            // transferir é a LOJA — sem ela o destino vira "Agente IA", que não tem
            // ID e deixa o ticket parado onde já está.
            if ((extraido.querAvancar || PEDE_AGILIDADE.test(texto)) && !leadData.finalizado) {
                if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
                usuarioNoHistorico = true;
                leadData.modoAtalho = true;

                if (leadData.loja) {
                    const hist = leadData.conversationHistory.slice(-8).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
                    await encaminhar(chatId, leadData, departamentoLead(leadData), texto, hist, exp);
                    return;
                }
                // Pergunta FIXA e única, sem passar pelo modelo: quem pediu
                // objetividade não pode receber mais um parágrafo de qualificação.
                // Na 2ª vez cai no fluxo normal, que com modoAtalho já pede só a loja.
                if (!leadData.atalhoPerguntado) {
                    leadData.atalhoPerguntado = true;
                    const msg = 'Claro! Só preciso de uma informação pra te passar pro consultor: você prefere ser atendido na Matriz, na Malvinas (Campina Grande) ou em Monteiro?';
                    await enviarMensagem(chatId, msg);
                    leadData.conversationHistory.push({ role: 'assistant', content: msg });
                    console.log(`⏩ ${chatId}: pressa detectada — funil pulado, pedindo só a loja.`);
                    return;
                }
            }
        }

        // --- Próximo passo + resposta ---
        const proximoCampoDepois = determinarProximoCampo(leadData);

        // Quantas vezes seguidas estamos pedindo o MESMO dado. Quando o cliente
        // desconversa ("sei lá", "acho bom"), o campo continua vazio e a IA
        // repetiria a mesma pergunta indefinidamente — o prompt usa este número
        // para reformular na 2ª vez e desistir do assunto na 3ª.
        if (proximoCampoDepois && leadData.ultimoCampoPerguntado === proximoCampoDepois.campo) {
            leadData.vezesMesmoCampo = (leadData.vezesMesmoCampo || 1) + 1;
        } else {
            leadData.vezesMesmoCampo = 1;
        }
        leadData.ultimoCampoPerguntado = proximoCampoDepois ? proximoCampoDepois.campo : null;

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
            console.error(`❌ Erro ao gerar resposta IA para ${chatId}:`, e.message);
            await enviarMensagem(chatId, 'Opa, tive uma instabilidade rapidinha por aqui 😅 Pode me mandar de novo o que você disse?');
            if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
            return;
        }

        leadData.objecaoAtiva = null;    // consumidos
        leadData.perguntouAgora = null;
        leadData.assuntoAgora = null;
        leadData.analiseImagem = null;

        // Guarda a moto que a IA acabou de apresentar. É isso que permite o fluxo
        // seguir quando o cliente aceita a recomendação sem dizer "quero a AZ1".
        const modeloNaResposta = detectarModeloMencionado(resposta);
        if (modeloNaResposta) leadData.modeloApresentado = modeloNaResposta;

        // Qualificação completa → TRANSFERE primeiro, responde depois. A ordem é
        // deliberada: a IA só pode confirmar a passagem para o cliente depois que
        // o ticket realmente entrou na fila do departamento da loja escolhida.
        let transferencia = null;
        if (leadData.qualificacaoCompleta && !leadData.finalizado) {
            // O lead que veio pelo ATALHO chega sem diagnóstico (ele pediu pressa e a
            // IA pulou o funil). O consultor precisa saber disso na nota, senão recebe
            // um resumo cheio de "Não informado" sem entender por quê.
            const tags = [
                leadData.modoAtalho ? 'PEDIU AGILIDADE — SEM DIAGNÓSTICO' : null,
                exp.aberto ? null : 'FORA DE EXPEDIENTE — AGENDAR RETORNO'
            ].filter(Boolean);
            transferencia = await notificarEquipe(leadData, chatId, {
                departamento: departamentoLead(leadData),
                tagExtra: tags.length ? tags.join(' | ') : undefined,
                proximoExpediente: exp.aberto ? null : exp.proximoExpediente
            });
            leadData.transferidoOk = transferencia.ok;
            leadData.finalizado = true;
        }

        // A transferência não foi concluída, mas a IA escreveu que já repassou:
        // troca por uma mensagem que não promete o que não aconteceu.
        if (transferencia && !transferencia.ok && PROMETE_TRANSFERENCIA.test(resposta)) {
            console.warn(`⚠️ ${chatId}: resposta prometia transferência que não ocorreu (${transferencia.motivo}) — texto substituído.`);
            resposta = exp.aberto
                ? 'Perfeito, anotei tudo aqui! Nosso consultor já vai dar sequência no seu atendimento por aqui mesmo. Ficou alguma dúvida sobre a moto?'
                : `Perfeito, deixei tudo registrado! Nosso consultor dá sequência ${exp.proximoExpediente}. Ficou alguma dúvida sobre a moto?`;
        }

        await enviarMensagensQuebradas(chatId, resposta);
        if (!usuarioNoHistorico) leadData.conversationHistory.push({ role: 'user', content: texto });
        leadData.conversationHistory.push({ role: 'assistant', content: resposta });
        if (leadData.conversationHistory.length > 100) {
            leadData.conversationHistory = leadData.conversationHistory.slice(-100);
        }

        if (!leadData.finalizado) agendarFollowUpReativacao(leadData);

    } catch (e) {
        console.error(`❌ Erro ao processar mensagem de ${chatId}:`, e);
    } finally {
        // O lock LOCAL sai primeiro, para a fila poder drenar o proximo turno.
        trava.liberarLocal();
        if (leadData) {
            try { await store.saveLead(chatId, leadData); }
            catch (e) { console.error('\u{274C} Erro ao salvar estado da conversa:', e.message); }
        }
        // O REMOTO sai por ultimo, depois de gravado: senao outra instancia
        // leria um estado velho.
        await trava.liberarRemoto();
    }
}

return { processarMensagem };
}

module.exports = { criar };
