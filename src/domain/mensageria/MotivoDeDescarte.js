// =============================================================
//  MOTIVO DE DESCARTE
//
//  Nem toda mensagem que chega deve virar atendimento. Antes, cada motivo era
//  um `return null` solto no meio do parse, indistinguivel dos outros: quem
//  lia o codigo (ou o log) nao sabia se a mensagem foi ignorada de proposito
//  ou se o payload quebrou.
//
//  Aqui cada motivo tem nome. Quem decide o que fazer com ele — logar, contar,
//  alertar — e o chamador.
// =============================================================

const MotivoDeDescarte = Object.freeze({
    /** Eco da propria mensagem que o bot (ou o atendente) enviou. */
    ECO_DO_BOT: 'eco_do_bot',

    /** Mensagem de grupo, com IGNORAR_GRUPOS ligado. */
    GRUPO: 'grupo',

    /** Um humano assumiu o ticket, ou ele foi encerrado. A IA cala. */
    TICKET_ASSUMIDO: 'ticket_assumido',

    /** Nenhum campo do payload continha telefone utilizavel. */
    SEM_TELEFONE: 'sem_telefone',

    /** Formato numero_cliente/mensagem_cliente: disparo duplicado do ChatBot. */
    DISPARO_DUPLICADO: 'disparo_duplicado',

    /** Nao bateu com nenhum formato conhecido. */
    FORMATO_DESCONHECIDO: 'formato_desconhecido',

    /** O parse lancou. Payload malformado. */
    ERRO_DE_PARSE: 'erro_de_parse'
});

module.exports = MotivoDeDescarte;
