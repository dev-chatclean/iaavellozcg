// =============================================================
//  MOTIVO DE DESCARTE — por que uma mensagem recebida não vira atendimento.
//
//  Antes da SPEC 0003 todos os descartes devolviam o mesmo `null`: grupo, eco
//  do próprio bot, ticket já assumido por um vendedor e payload irreconhecível
//  eram indistinguíveis para o chamador. Não dava para medir, alertar nem
//  diagnosticar "por que este lead não foi atendido".
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

const MOTIVOS = Object.freeze({
    // A mensagem é o eco do que o próprio bot (ou o atendente) enviou.
    ECO: 'eco',
    // Conversa em grupo — a IA só atende conversa individual (RN-050).
    GRUPO: 'grupo',
    // Um humano aceitou o ticket: a IA se cala (RN-052).
    TICKET_ASSUMIDO: 'ticket-assumido',
    // Ticket encerrado no CRM (RN-052).
    TICKET_ENCERRADO: 'ticket-encerrado',
    // Disparo duplicado do ChatBot, no formato { numero_cliente, mensagem_cliente }.
    FORMATO_DUPLICADO: 'formato-duplicado',
    // Reconhecemos o formato, mas não há telefone utilizável.
    SEM_TELEFONE: 'sem-telefone',
    // Nenhum dos formatos conhecidos.
    FORMATO_DESCONHECIDO: 'formato-desconhecido'
});

// Texto para log — mantém as mensagens que já existiam no legado, para não
// quebrar quem lê o log hoje, acrescentando o motivo nomeado.
const DESCRICOES = Object.freeze({
    [MOTIVOS.ECO]: 'eco do próprio bot',
    [MOTIVOS.GRUPO]: 'Mensagem de grupo ignorada',
    [MOTIVOS.TICKET_ASSUMIDO]: 'ticket aceito/atendido por humano — IA não responde',
    [MOTIVOS.TICKET_ENCERRADO]: 'ticket encerrado — IA não responde',
    [MOTIVOS.FORMATO_DUPLICADO]: 'Ignorando disparo duplicado (formato numero_cliente)',
    [MOTIVOS.SEM_TELEFONE]: 'payload sem telefone identificável',
    [MOTIVOS.FORMATO_DESCONHECIDO]: 'Payload não reconhecido'
});

function descartar(motivo, detalhe = null) {
    return Object.freeze({ aceita: false, motivo, detalhe, descricao: DESCRICOES[motivo] || motivo });
}

module.exports = { MOTIVOS, DESCRICOES, descartar };
