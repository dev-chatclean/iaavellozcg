// =============================================================
//  COMPOSITION ROOT
//
//  O unico lugar onde as pecas se conhecem. Ate aqui, cada modulo declarou
//  o que precisa e recebeu por parametro; e neste arquivo que se decide QUEM
//  e cada dependencia — qual repositorio, qual canal, qual cliente de IA.
//
//  Trocar Redis por memoria, OpenAI por outro provedor ou o ChatClean por
//  outro CRM e mudanca AQUI, e so aqui. Nenhum modulo de dominio ou
//  aplicacao precisa saber.
//
//  A ORDEM importa: cada const so pode usar o que ja foi montado acima. Ate
//  esta fatia, essa ordem dependia de onde cada linha tinha caido no
//  index.js — e quebrou uma vez, com erro de TDZ, durante a extracao do
//  transbordo. Aqui ela e explicita e fica sob os olhos de quem lê.
//
//  NOTA DE LEITURA: as montagens abaixo foram movidas verbatim do index.js.
// =============================================================

const OpenAI = require('openai');
const axios = require('axios');

/**
 * @param {object} config saida de src/main/config
 * @param {object} [sobrescritas] adapters alternativos, por nome
 *
 *   O ponto de existir: os testers locais montam o MESMO atendimento — mesmo
 *   caso de uso, mesmas politicas, mesma fila — trocando so o canal de saida
 *   por um que escreve no terminal. Sem isso, a unica forma de exercitar a
 *   conversa fora do WhatsApp era reimplementar o turno, que foi o que os
 *   testers faziam ate aqui — e que ja tinha divergido da producao.
 */
function criar(config, sobrescritas = {}) {
const {
    OPENAI_API_KEY,
    FERIADOS,
    DEPT_IDS,
    CC_PUSH_URL,
    EQUIPE_NUMERO,
    IA_ALLOWED_CONTACTS,
    IGNORAR_GRUPOS,
    IA_SO_PENDENTES,
    LOOP_MAX_TURNOS,
    LOOP_JANELA_MS,
    MAX_RESPOSTAS_POS_HANDOFF,
    AGRUPAR_MS,
    RESET_INATIVIDADE,
    TRANSFERIR_DEPARTAMENTO,
    TRANSFERIR_FECHANDO
} = config;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Os adapters da OpenAI vivem em src/infrastructure/openai. Recebem o cliente
// por injecao e NAO tratam erro: quem chama e que decide entre cair em
// fallback ou propagar, porque isso e decisao de produto, nao de transporte.
const extratorIA = require('../infrastructure/openai/ExtratorOpenAI').criar({ cliente: openai });
const redatorIA = require('../infrastructure/openai/RedatorOpenAI').criar({ cliente: openai });
const leitorDeImagemIA = require('../infrastructure/openai/LeitorDeImagemOpenAI').criar({ cliente: openai });

// =============================================================
//  IA — a cola entre prompt e adapter
// =============================================================
const conversaComIA = require('../application/ia/ConversaComIA').criar({
    extrator: extratorIA,
    redator: redatorIA,
    leitorDeImagem: leitorDeImagemIA,
    prompts: require('../infrastructure/openai/prompts')
});

const extrairInformacoesComIA = (msg, campo, hist) => conversaComIA.extrair(msg, campo, hist);
const gerarRespostaIA = (lead, msg, campo, hist, exp) => conversaComIA.redigir(lead, msg, campo, hist, exp);
const analisarImagem = (mediaUrl) => conversaComIA.descreverImagem(mediaUrl);
const gerarRespostaPosEncaminhamento = (lead, msg, hist) => conversaComIA.redigirPosEncaminhamento(lead, msg, hist);

// A transcricao e a UNICA chamada a OpenAI que nao passa pelo SDK: o endpoint
// do Whisper espera multipart, montado a mao. Por isso a chave entra separada.
const transcritorIA = require('../infrastructure/openai/TranscritorWhisper').criar({
    http: axios,
    apiKey: OPENAI_API_KEY
});
const baixadorDeMidia = require('../infrastructure/midia/BaixadorHttp').criar({ http: axios });

// Um manipulador por tipo de midia (Strategy). A descricao da imagem entra
// como funcao: a instrucao de visao e o tratamento de erro continuam em
// analisarImagem, logo abaixo.
const manipuladoresDeMidia = require('../application/midia/manipuladores').criar({
    baixador: baixadorDeMidia,
    transcritor: transcritorIA,
    descreverImagem: (mediaUrl) => analisarImagem(mediaUrl)
});

// O catalogo e dominio puro; os IDs de departamento entram por parametro.
const Catalogo = require('../domain/catalogo/Catalogo');
const { EMPRESA_INFO, PERFIS, DEPARTAMENTOS, lojaParaDepartamento, OFICINA } = Catalogo;
const { DEPARTAMENTO_IDS, departamentoId } = Catalogo.criarDepartamentos({ ids: DEPT_IDS });
const { determinarProximoCampo, aplicarCampos, detectarPerfil, detectarModeloMencionado } = require('../domain/atendimento/Funil');

// Para onde o atendimento vai quando sai da IA. A regra vive em
// src/domain/atendimento/politicas/PoliticaDeTransbordo.js; o catalogo de
// departamentos entra por parametro, porque quem sabe os IDs cadastrados no
// CRM e a infraestrutura, nao a regra.
// RN-056: teto de mensagens numa janela curta e deteccao de mensagem repetida.
const politicaAntiLoop = require('../domain/atendimento/politicas/PoliticaAntiLoop').criar({
    maxTurnos: LOOP_MAX_TURNOS,
    janelaMs: LOOP_JANELA_MS
});

const politicaDeTransbordo = require('../domain/atendimento/politicas/PoliticaDeTransbordo').criar({
    resolverLoja: lojaParaDepartamento,
    departamentoDeEntrada: DEPARTAMENTOS.entrada,
    idDoDepartamento: departamentoId,
    departamentoDePosVenda: DEPARTAMENTOS.posvenda
});

const departamentoLead = (leadData) => politicaDeTransbordo.destinoDoLead(leadData);
const departamentoPosVenda = (leadData) => politicaDeTransbordo.destinoDePosVenda(leadData);
// O expediente e dominio puro: os feriados extras entram por parametro, em vez
// de serem lidos do ambiente no carregamento do modulo (D-30).
const { estaEmExpediente } = require('../domain/expediente/Expediente').criar({
    feriadosExtras: FERIADOS
});
const pipeline = require('../../pipeline'); // Oportunidades no CRM (inerte se não configurado)
const store = require('../../store'); // estado das conversas (Redis + fallback em memória)

// Lock de atendimento em dois niveis (local + cluster). A coordenacao vive em
// src/application/atendimento/LockDeAtendimento.js.
const lockDeAtendimento = require('../application/atendimento/LockDeAtendimento').criar({
    repositorio: store,
    ttlMs: 60000,
    aoExpirar: (chatId) => console.log(`\u{23F1}\u{FE0F} Timeout: liberando processamento para ${chatId}`)
});

// =============================================================
//  UTILITÁRIOS
// =============================================================
// normalizarPhone / nucleoNumero / contatoPermitido vivem em
// src/shared/telefone.js: mesma logica, agora testavel em unidade e sem
// depender de ambiente. A allow-list e passada por parametro, porque o modulo
// compartilhado nao le process.env.
const telefone = require('../shared/telefone');
const normalizarPhone = telefone.normalizarPhone;

// Leitura de intencao por texto (rede de seguranca da extracao). As quatro
// expressoes e os casos reais que as justificam vivem em
// src/domain/atendimento/SinaisDoCliente.js.
const SinaisDoCliente = require('../domain/atendimento/SinaisDoCliente');
const { PROMETE_TRANSFERENCIA, PEDE_TRANSFERENCIA, PEDE_AGILIDADE, SINAL_ENCERRAMENTO } = SinaisDoCliente;


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
const canalChatClean = sobrescritas.canal || require('../infrastructure/chatclean/CanalChatClean').criar({
    http: axios,
    pushUrl: CC_PUSH_URL
});

const ccPush = (number, payloadExtra) => canalChatClean.enviar(number, payloadExtra);


// Como a resposta chega no WhatsApp — quebra em partes e atraso de digitacao —
// vive em src/application/envio/EnvioAoCliente.js.
const envioAoCliente = require('../application/envio/EnvioAoCliente').criar({
    canal: canalChatClean
});

const enviarMensagem = (chatId, texto) => envioAoCliente.enviar(chatId, texto);
const enviarMensagensQuebradas = (chatId, texto) => envioAoCliente.enviarEmPartes(chatId, texto);

// Notifica a equipe (nota interna no ticket + WhatsApp interno) quando um lead
// é qualificado, e sinaliza a transferência de departamento no CRM.
// O texto que o vendedor le vive em src/domain/atendimento/MontadorDeResumo.js.
// Catalogo de perfis e IDs de departamento entram por parametro: o dominio nao
// conhece a configuracao do CRM.
const montadorDeResumo = require('../domain/atendimento/MontadorDeResumo').criar({
    nomeDoPerfil: (leadData) =>
        leadData.perfilKey && PERFIS[leadData.perfilKey] ? PERFIS[leadData.perfilKey].nome : 'Não informado',
    idDoDepartamento: departamentoId,
    destinoPadrao: (leadData) => departamentoLead(leadData)
});

const montarResumo = (leadData, chatId, opcoes = {}) => montadorDeResumo.montar(leadData, chatId, opcoes);

// O transbordo — nota, transferencia de fila e aviso a equipe — vive em
// src/application/transbordo/Transbordo.js.
const transbordo = require('../application/transbordo/Transbordo').criar({
    canal: canalChatClean,
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
});

const transferirDepartamento = (chatId, dep) => transbordo.transferirDepartamento(chatId, dep);
const notificarEquipe = (leadData, chatId, opcoes) => transbordo.notificarEquipe(leadData, chatId, opcoes);
const encaminhar = (chatId, leadData, dep, msg, hist, exp) => transbordo.encaminhar(chatId, leadData, dep, msg, hist, exp);


// A state machine (determinarProximoCampo / aplicarCampos / detectarPerfil)
// vive em ./flow para ser reusada pelo tester local sem duplicar lógica.

// =============================================================
//  FOLLOW-UP DE REATIVAÇÃO (durável — sobrevive a redeploy)
//  Guarda leadData.followUpDueAt e um varredor dispara os vencidos.
// =============================================================
// O follow-up de reativacao vive em src/application/reativacao/FollowUp.js.
const followUp = require('../application/reativacao/FollowUp').criar({
    store,
    lockDeAtendimento,
    enviarMensagem,
    determinarProximoCampo
});

const FOLLOWUP_SWEEP = followUp.FOLLOWUP_SWEEP;
const agendarFollowUpReativacao = (leadData) => followUp.agendar(leadData);
const montarMsgReativacao = (leadData) => followUp.montarMensagem(leadData);
const varrerFollowUps = () => followUp.varrer();
// O varredor de follow-up é disparado por iniciar(), no fim deste arquivo, e não
// no carregamento do módulo — senão a suíte, que só importa o arquivo, passaria
// a agendar timers reais. ATENÇÃO: existe UMA chamada de setInterval para o
// varredor no projeto inteiro. Duas fariam o cliente receber a mensagem de
// reativação em dobro.






// =============================================================
//  PROCESSAMENTO DE MENSAGEM
// =============================================================
// O turno vive em src/application/casos-de-uso/ProcessarMensagemRecebida.js.
// Tudo o que ele usa entra por parametro — nada e alcancado por escopo de
// modulo, que era o que tornava impossivel testa-lo sem carregar o index.js
// inteiro.
const casoDeUso = require('../application/casos-de-uso/ProcessarMensagemRecebida').criar({
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
});

const processarMensagem = (turno) => casoDeUso.processarMensagem(turno);

// =============================================================
//  FILA SERIAL POR CLIENTE + AGRUPAMENTO DE MENSAGENS RÁPIDAS
//  No WhatsApp o cliente manda várias mensagens seguidas. Em vez de
//  processar a primeira e DESCARTAR as demais (o lock antigo fazia isso),
//  enfileiramos tudo por número e processamos em série. Mensagens de TEXTO
//  em sequência são agrupadas num só turno (debounce AGRUPAR_MS); mídia é
//  processada assim que chega (mas ainda em série, nunca descartada).
// =============================================================
// A coordenacao vive em src/application/fila/FilaDeTurnos.js. A fila nao
// mantem o lock: ela apenas pergunta se o cliente ja esta sendo atendido.
const filaDeTurnos = require('../application/fila/FilaDeTurnos').criar({
    processarTurno: (turno) => processarMensagem(turno),
    estaProcessando: (chatId) => lockDeAtendimento.ocupado(chatId),
    janelaDeAgrupamentoMs: AGRUPAR_MS,
    aoFalhar: (erro, chatId) => console.error(`\u{274C} Erro ao drenar fila de ${chatId}:`, erro.message)
});

// A traducao do payload vive em src/infrastructure/chatclean/acl/tradutor.js:
// e a unica camada que conhece os tres formatos do ChatClean. Ela devolve um
// MOTIVO nomeado de descarte; a decisao de logar continua aqui, para o log
// permanecer identico ao de antes.
const aclChatClean = require('../infrastructure/chatclean/acl/tradutor');
const MotivoDeDescarte = require('../domain/mensageria/MotivoDeDescarte');

const ehGrupo = aclChatClean.ehGrupo;
const ticketStatus = aclChatClean.ticketStatus;
const deveResponderTicket = (body = {}, msg = {}) => aclChatClean.deveResponderTicket(body, msg, IA_SO_PENDENTES);

const tradutorDePayload = aclChatClean.criar({
    ignorarGrupos: IGNORAR_GRUPOS,
    soPendentes: IA_SO_PENDENTES
});

return {
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
};
}

module.exports = { criar };
