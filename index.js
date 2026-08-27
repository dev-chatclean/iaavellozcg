require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const axios = require('axios');
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
const CC_PUSH_URL    = process.env.CC_PUSH_URL    || '';
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || '';
const EQUIPE_NUMERO  = process.env.EQUIPE_NUMERO  || '';
const IA_ALLOWED_CONTACTS = (process.env.IA_ALLOWED_CONTACTS || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT           = process.env.PORT           || 3000;
// Chave para proteger os endpoints administrativos (/leads, /diag), que expõem
// dados de leads e config. Sem ela, esses endpoints ficam BLOQUEADOS (não abertos).
const ADMIN_KEY      = process.env.ADMIN_KEY      || '';
// A IA NÃO responde em grupos por padrão (só conversa individual). Para permitir
// grupos no futuro, defina IGNORAR_GRUPOS=false.
const IGNORAR_GRUPOS = (process.env.IGNORAR_GRUPOS || 'true') !== 'false';
// A IA só responde tickets PENDENTES (na fila). Quando um humano aceita a
// conversa (ticket sai de "pending"), a IA para de responder. Para desativar
// esse filtro, defina IA_SO_PENDENTES=false.
const IA_SO_PENDENTES = (process.env.IA_SO_PENDENTES || 'true') !== 'false';
// Rate-limit por número: no máximo RATE_LIMIT_MSGS mensagens por janela de
// RATE_LIMIT_JANELA_S segundos (proteção contra loop/spam e custo OpenAI).
// 0 desativa. Padrão: 20 msgs / 60s.
const RATE_LIMIT_MSGS   = parseInt(process.env.RATE_LIMIT_MSGS   || '20', 10);
const RATE_LIMIT_JANELA = parseInt(process.env.RATE_LIMIT_JANELA_S || '60', 10) * 1000;
// Blindagem anti-loop (contra outras IAs / auto-respondedores): se um mesmo
// contato trocar mais de LOOP_MAX_TURNOS mensagens em LOOP_JANELA_MIN minutos,
// ou repetir a mesma mensagem, a IA PAUSA as respostas para não entrar em
// ping-pong infinito com outro bot.
const LOOP_MAX_TURNOS = parseInt(process.env.LOOP_MAX_TURNOS || '15', 10);
const LOOP_JANELA_MS  = parseInt(process.env.LOOP_JANELA_MIN || '3', 10) * 60 * 1000;
// Teto de respostas da IA DEPOIS que o lead já foi transferido. Passando disso ela
// se despede e cala: quem conduz o atendimento a partir da transferência é o
// consultor humano, e a IA respondendo em paralelo atropela o trabalho dele.
const MAX_RESPOSTAS_POS_HANDOFF = parseInt(process.env.MAX_RESPOSTAS_POS_HANDOFF || '3', 10);
// Janela (ms) para AGRUPAR mensagens rápidas do mesmo cliente antes de responder.
// No WhatsApp o cliente costuma mandar várias mensagens seguidas; juntamos tudo
// num único turno em vez de responder só a primeira e ignorar o resto.
const AGRUPAR_MS     = parseInt(process.env.AGRUPAR_MENSAGENS_MS || '2000', 10);
// Reinicia o atendimento após N horas sem interação do cliente (padrão: 24h).
const RESET_INATIVIDADE = parseInt(process.env.RESET_INATIVIDADE_HORAS || '24', 10) * 3600 * 1000;
// Transferência REAL do ticket para o departamento da loja escolhida (fila do
// CRM), via forceTicketToDepartment da Push API. Defina false para voltar ao
// comportamento antigo (só a nota interna, encaminhamento manual do atendente).
const TRANSFERIR_DEPARTAMENTO = (process.env.TRANSFERIR_DEPARTAMENTO || 'true') !== 'false';
// A plataforma só reposiciona ticket que está FECHADO ou é primeiro contato. Com
// isto ligado, o push de transferência fecha o ticket junto (forceTicketToClosed),
// que é o gatilho documentado para ele reabrir já no departamento certo. Ligue se
// a transferência simples não mover o ticket de fila.
const TRANSFERIR_FECHANDO = (process.env.TRANSFERIR_FECHANDO || 'false') === 'true';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Os adapters da OpenAI vivem em src/infrastructure/openai. Recebem o cliente
// por injecao e NAO tratam erro: quem chama e que decide entre cair em
// fallback ou propagar, porque isso e decisao de produto, nao de transporte.
const extratorIA = require('./src/infrastructure/openai/ExtratorOpenAI').criar({ cliente: openai });
const redatorIA = require('./src/infrastructure/openai/RedatorOpenAI').criar({ cliente: openai });
const leitorDeImagemIA = require('./src/infrastructure/openai/LeitorDeImagemOpenAI').criar({ cliente: openai });
// A transcricao e a UNICA chamada a OpenAI que nao passa pelo SDK: o endpoint
// do Whisper espera multipart, montado a mao. Por isso a chave entra separada.
const transcritorIA = require('./src/infrastructure/openai/TranscritorWhisper').criar({
    http: axios,
    apiKey: process.env.OPENAI_API_KEY
});
const baixadorDeMidia = require('./src/infrastructure/midia/BaixadorHttp').criar({ http: axios });

// Um manipulador por tipo de midia (Strategy). A descricao da imagem entra
// como funcao: a instrucao de visao e o tratamento de erro continuam em
// analisarImagem, logo abaixo.
const manipuladoresDeMidia = require('./src/application/midia/manipuladores').criar({
    baixador: baixadorDeMidia,
    transcritor: transcritorIA,
    descreverImagem: (mediaUrl) => analisarImagem(mediaUrl)
});

const { EMPRESA_INFO, PERFIS, DEPARTAMENTOS, DEPARTAMENTO_IDS, departamentoId, lojaParaDepartamento, OFICINA } = require('./data');
const { SYSTEM_SDR, promptExtracao, promptResposta } = require('./prompts');
const { determinarProximoCampo, aplicarCampos, detectarPerfil, detectarModeloMencionado } = require('./flow');

// Para onde o atendimento vai quando sai da IA. A regra vive em
// src/domain/atendimento/politicas/PoliticaDeTransbordo.js; o catalogo de
// departamentos entra por parametro, porque quem sabe os IDs cadastrados no
// CRM e a infraestrutura, nao a regra.
// RN-056: teto de mensagens numa janela curta e deteccao de mensagem repetida.
const politicaAntiLoop = require('./src/domain/atendimento/politicas/PoliticaAntiLoop').criar({
    maxTurnos: LOOP_MAX_TURNOS,
    janelaMs: LOOP_JANELA_MS
});

const politicaDeTransbordo = require('./src/domain/atendimento/politicas/PoliticaDeTransbordo').criar({
    resolverLoja: lojaParaDepartamento,
    departamentoDeEntrada: DEPARTAMENTOS.entrada,
    idDoDepartamento: departamentoId,
    departamentoDePosVenda: DEPARTAMENTOS.posvenda
});

const departamentoLead = (leadData) => politicaDeTransbordo.destinoDoLead(leadData);
const departamentoPosVenda = (leadData) => politicaDeTransbordo.destinoDePosVenda(leadData);
const { estaEmExpediente } = require('./horario');
const pipeline = require('./pipeline'); // Oportunidades no CRM (inerte se não configurado)
const store = require('./store'); // estado das conversas (Redis + fallback em memória)

const processandoMensagem = new Map(); // lock de processamento (por instância)

// =============================================================
//  UTILITÁRIOS
// =============================================================
// normalizarPhone / nucleoNumero / contatoPermitido vivem em
// src/shared/telefone.js: mesma logica, agora testavel em unidade e sem
// depender de ambiente. A allow-list e passada por parametro, porque o modulo
// compartilhado nao le process.env.
const telefone = require('./src/shared/telefone');
const normalizarPhone = telefone.normalizarPhone;

// Frases em que a IA AFIRMA que já passou o atendimento adiante. Usado para não
// deixar essa promessa sair quando a transferência de fato não aconteceu.
const PROMETE_TRANSFERENCIA = /transferi|transferindo|repassando|repassei|encaminhando|encaminhei|j[áa] (vou )?(te )?pass|consultor (j[áa]|vai) (assumir|continuar|dar sequ)/i;

// Pedidos INEQUÍVOCOS de transferência. De propósito não inclui "quero falar com
// humano": essa frase aparece negada com frequência ("não quero falar com humano")
// e o julgamento de intenção nesse caso fica com a IA, na extração.
const PEDE_TRANSFERENCIA = /\b(me\s+transfir\w*|pode(m)?\s+transferir|quero\s+ser\s+transferid\w*|me\s+passa\s+(pro|para\s+o?)\s*(vendedor|consultor|atendente)|chama\s+(um\s+)?(vendedor|consultor|atendente))\b/i;

// IMPACIÊNCIA: o cliente não pediu ninguém, mas quer que o atendimento ANDE.
// Rede de segurança do campo querAvancar da extração — o modelo costuma tratar
// essas frases como conversa normal e devolver false, deixando o funil rodar e
// irritando ainda mais quem já disse que tem pressa.
//
// CUIDADO ao acrescentar padrões aqui: este regex NÃO sabe qual pergunta a IA
// acabou de fazer, então só cabem frases inequívocas em QUALQUER contexto. Ex.:
// "pouco tempo" está fora de propósito — é a resposta natural para "quanto tempo
// você perde no trânsito?", e incluí-la abortava o funil no meio de uma conversa
// que estava correndo bem. Frases ambíguas ficam com querAvancar, que enxerga o
// histórico e sabe distinguir pedido de avanço de resposta a uma pergunta.
const PEDE_AGILIDADE = /(diret[oa]s?\s+(ao|pro|para\s+o)\s+(assunto|ponto)|ir\s+ao\s+ponto|sem\s+(enrola|rodeio)|para\s+de\s+perguntar|muita(s)?\s+pergunta|quantas\s+perguntas|(t[ôo]|estou|to)\s+(com\s+pressa|sem\s+tempo)|n[ãa]o\s+tenho\s+tempo|(quanto\s+custa|qual\s+o\s+pre[çc]o|me\s+manda\s+o\s+pre[çc]o).{0,15}(logo|agora|direto)|vamos?\s+(logo|direto)|resolver\s+r[áa]pido)/i;

// Sinais de ENCERRAMENTO: o cliente não tem mais nada a tratar e só vai aguardar
// o consultor. Rede de segurança do campo encerrouConversa. Ancorado no início da
// mensagem e limitado no tamanho para não confundir "não" de uma frase longa
// ("não entendi o preço") com um encerramento de verdade.
const SINAL_ENCERRAMENTO = /^\s*(n[ãa]o|nada|nop|s[óo]\s+(esperar|aguardar)|vou\s+(esperar|aguardar)|ok(ay)?|blz|beleza|t[áa]\s+(bom|certo|ok)|certo|obrigad\w*|obg|vlw|valeu|show|perfeito|isso|[éeE]\s+isso|combinado|fechou|[\p{Emoji_Presentation}\u{1F44D}\u{1F44C}\u{1F64F}]+)\s*[.!]*\s*$/iu;


const contatoPermitido = (numero) => telefone.contatoPermitido(numero, IA_ALLOWED_CONTACTS);

// =============================================================
//  CHATCLEAN — ENVIO VIA PUSH API
//  Um único endpoint autenticado (CC_PUSH_URL) entrega as mensagens.
//  O token JWT já vem embutido na URL como ?token=... (sem header).
// =============================================================
// O transporte vive em src/infrastructure/chatclean/CanalChatClean.js. O axios
// entra por injecao: o adapter nao conhece biblioteca de HTTP, so a porta.
// Continua devolvendo { ok, status, data, erro } — e nao um booleano — porque a
// transferencia de departamento precisa saber o que o CRM respondeu para so
// entao confirmar a transferencia ao cliente.
const canalChatClean = require('./src/infrastructure/chatclean/CanalChatClean').criar({
    http: axios,
    pushUrl: CC_PUSH_URL
});

const ccPush = (number, payloadExtra) => canalChatClean.enviar(number, payloadExtra);

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

async function enviarMensagem(chatId, texto) {
    if (!texto || !String(texto).trim()) return false;
    return (await ccPush(chatId, { body: texto })).ok;
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
// O texto que o vendedor le vive em src/domain/atendimento/MontadorDeResumo.js.
// Catalogo de perfis e IDs de departamento entram por parametro: o dominio nao
// conhece a configuracao do CRM.
const montadorDeResumo = require('./src/domain/atendimento/MontadorDeResumo').criar({
    nomeDoPerfil: (leadData) =>
        leadData.perfilKey && PERFIS[leadData.perfilKey] ? PERFIS[leadData.perfilKey].nome : 'Não informado',
    idDoDepartamento: departamentoId,
    destinoPadrao: (leadData) => departamentoLead(leadData)
});

const montarResumo = (leadData, chatId, opcoes = {}) => montadorDeResumo.montar(leadData, chatId, opcoes);

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
        try { await store.saveLead(chatId, leadData); } catch (_) {}
        return;
    }
    leadData.followUpUltimo = msg;
    try { await store.saveLead(chatId, leadData); } catch (_) {}
    await enviarMensagem(chatId, msg);
    console.log(`📩 Follow-up de reativação enviado para ${chatId}`);
}

async function varrerFollowUps() {
    try {
        const ids = await store.scanLeadIds();
        const agora = Date.now();
        for (const chatId of ids) {
            if (processandoMensagem.has(chatId)) continue;
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
// O varredor de follow-up é disparado por iniciar(), no fim deste arquivo, e não
// no carregamento do módulo — senão a suíte, que só importa o arquivo, passaria
// a agendar timers reais. ATENÇÃO: existe UMA chamada de setInterval para o
// varredor no projeto inteiro. Duas fariam o cliente receber a mensagem de
// reativação em dobro.

// =============================================================
//  IA — EXTRAÇÃO DE INFORMAÇÕES (gpt-4o-mini, temperatura 0)
// =============================================================
async function extrairInformacoesComIA(mensagem, campoAtual, historicoRecente = []) {
    try {
        const mensagemSanitizada = mensagem.replace(/[<>]/g, '').substring(0, 1000);
        const prompt = promptExtracao({ mensagemSanitizada, campoAtual });
        return await extratorIA.extrair({ prompt, historico: historicoRecente });
    } catch (e) {
        console.error('Erro ao extrair informações:', e.message);
        return null;
    }
}

// =============================================================
//  IA — GERAÇÃO DE RESPOSTA (gpt-4o-mini, temperatura 0.7)
// =============================================================
async function gerarRespostaIA(leadData, mensagemCliente, proximoCampo, historicoRecente = [], expediente = null) {
    const mensagemSanitizada = mensagemCliente.replace(/[<>]/g, '').substring(0, 1000);
    const isInicioConversa = leadData.conversationHistory.length === 0;
    const prompt = promptResposta({ isInicioConversa, mensagemSanitizada, proximoCampo, leadData, expediente });
    return await redatorIA.redigir({
        system: SYSTEM_SDR,
        prompt,
        historico: historicoRecente,
        temperatura: 0.7
    });
}

// A IA "enxerga" a imagem enviada pelo cliente (gpt-4o com visão) e descreve
// o conteúdo para usar no atendimento. Retorna null se falhar.
async function analisarImagem(mediaUrl) {
    if (!mediaUrl) return null;
    try {
        const instrucao = `Você é atendente da Avelloz Campina (concessionária de motos). O cliente enviou esta imagem no WhatsApp durante o atendimento. Descreva de forma curta e útil (1 a 3 frases, tom natural, SEM markdown) o que é e o que há de relevante para entender a necessidade dele:
- Se for uma foto de moto (dele ou de um modelo), diga o que dá pra entender (modelo/estado/cor, se dá pra saber).
- Se for um PRINT de conversa, anúncio ou simulação, resuma do que se trata.
- Se for um documento (CNH, comprovante, print de dados), diga o que é sem transcrever dados sensíveis.
Não invente o que não dá pra ver.`;
        return await leitorDeImagemIA.descrever({ instrucao, url: mediaUrl });
    } catch (e) {
        console.error('❌ Erro ao analisar imagem (visão):', e.message);
        return null;
    }
}

// Resposta quando o lead JÁ foi encaminhado ao especialista: tira dúvidas
// pontuais de forma natural, sem refazer a qualificação nem repetir o resumo.
async function gerarRespostaPosEncaminhamento(leadData, mensagemCliente, historicoRecente = []) {
    const fallback = 'Já repassei tudo pro nosso consultor, ele continua seu atendimento aqui rapidinho 😊';
    try {
        const prompt = `Este lead já foi ENCAMINHADO a um consultor humano da Avelloz Campina. Ele acabou de dizer: "${String(mensagemCliente).replace(/[<>]/g, '').substring(0, 600)}".
Responda de forma breve, calorosa e útil (registro de WhatsApp, sem markdown, no máximo 1 emoji).
NÃO puxe conversa. Só faça uma pergunta se ela for REALMENTE necessária para responder o que ele perguntou. É PROIBIDO terminar com "tem mais alguma dúvida?", "posso ajudar em algo mais?" ou qualquer variação: quem conduz o atendimento agora é o consultor humano, e ficar puxando assunto atropela o trabalho dele.
- Se for uma dúvida simples sobre as motos/condições, responda com o que você sabe e PARE.
- Se depender do consultor (valor de parcela, aprovação de crédito, prazo de entrega, negociação), diga que ele já vai continuar o atendimento pra resolver.
- Se for sobre ${OFICINA.assuntos}, passe o telefone da nossa oficina: ${OFICINA.telefone}. Não diagnostique defeito nem cote peça/serviço.
- Se for sobre INDICAÇÃO: ele passa o nome e o telefone do possível comprador pra um vendedor ANTES da compra; se o indicado fechar, ganha AZ1 R$ 50,00, AZ125 R$ 100,00, AZX160 R$ 150,00. Indicação reivindicada depois da compra fechada não é paga — diga isso com gentileza se for o caso.
Nunca informe valor de parcela nem prometa prazo. Não refaça a qualificação e não repita o resumo.`;
        const texto = await redatorIA.redigir({
            system: 'Você é um consultor do time da Avelloz Campina. Escrita natural, curta, registro de WhatsApp.',
            prompt,
            historico: historicoRecente,
            temperatura: 0.6
        });
        return texto || fallback;
    } catch (e) {
        console.error('❌ Erro na resposta pós-encaminhamento:', e.message);
        return fallback;
    }
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

// =============================================================
//  PROCESSAMENTO DE MENSAGEM
// =============================================================
async function processarMensagem({ chatId, contactId, texto, tipo, mediaBase64, mediaUrl, mediaMimetype, quotedText, nomeContato }) {
    if (processandoMensagem.get(chatId)) {
        console.log(`⚠️ Já processando mensagem de ${chatId}. Ignorando.`);
        return;
    }
    processandoMensagem.set(chatId, true);
    const timeoutId = setTimeout(() => {
        if (processandoMensagem.get(chatId)) {
            console.log(`⏱️ Timeout: liberando processamento para ${chatId}`);
            processandoMensagem.delete(chatId);
        }
    }, 60000);

    // Lock cross-instância (Redis): impede que outro container processe o mesmo
    // lead ao mesmo tempo. Sem Redis, é no-op (o lock em memória acima já basta).
    const lockRedis = await store.acquireLock(chatId, 60000);
    if (!lockRedis) {
        console.log(`🔒 ${chatId} já está sendo processado por outra instância — pulando.`);
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
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
                    } catch (_) {}
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
        clearTimeout(timeoutId);
        processandoMensagem.delete(chatId);
        if (leadData) {
            try { await store.saveLead(chatId, leadData); }
            catch (e) { console.error('❌ Erro ao salvar estado da conversa:', e.message); }
        }
        await store.releaseLock(chatId);
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
// A coordenacao vive em src/application/fila/FilaDeTurnos.js. O lock do turno
// (processandoMensagem) continua aqui, porque quem o mantem e quem processa —
// entra na fila como parametro.
const filaDeTurnos = require('./src/application/fila/FilaDeTurnos').criar({
    processarTurno: (turno) => processarMensagem(turno),
    estaProcessando: (chatId) => !!processandoMensagem.get(chatId),
    janelaDeAgrupamentoMs: AGRUPAR_MS,
    aoFalhar: (erro, chatId) => console.error(`\u{274C} Erro ao drenar fila de ${chatId}:`, erro.message)
});

const enfileirar = (parsed) => filaDeTurnos.enfileirar(parsed);

// A traducao do payload vive em src/infrastructure/chatclean/acl/tradutor.js:
// e a unica camada que conhece os tres formatos do ChatClean. Ela devolve um
// MOTIVO nomeado de descarte; a decisao de logar continua aqui, para o log
// permanecer identico ao de antes.
const aclChatClean = require('./src/infrastructure/chatclean/acl/tradutor');
const MotivoDeDescarte = require('./src/domain/mensageria/MotivoDeDescarte');

const ehGrupo = aclChatClean.ehGrupo;
const ticketStatus = aclChatClean.ticketStatus;
const deveResponderTicket = (body = {}, msg = {}) => aclChatClean.deveResponderTicket(body, msg, IA_SO_PENDENTES);

const tradutorDePayload = aclChatClean.criar({
    ignorarGrupos: IGNORAR_GRUPOS,
    soPendentes: IA_SO_PENDENTES
});

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
if (!process.env.OPENAI_API_KEY) {
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
