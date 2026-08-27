// =============================================================
//  CONFIGURACAO
//
//  O UNICO lugar do sistema que le process.env. Todo o resto recebe os
//  valores por parametro — e o lint garante isso em domain, application e
//  shared.
//
//  Nao valida nada de proposito NESTA fatia: os padroes e as conversoes sao
//  identicos aos que estavam no index.js, para a refatoracao nao mudar
//  comportamento. Validar a configuracao no boot (e recusar subir com valor
//  invalido) e mudanca de comportamento e tem spec propria.
//
//  NOTA DE LEITURA: as linhas abaixo foram movidas verbatim do index.js,
//  com os comentarios que explicam cada opcao.
// =============================================================

function carregar(env = process.env) {

    // Chave da OpenAI. Sem ela o processo nao sobe (a checagem esta em
    // iniciar(), no index.js) — mas a LEITURA e aqui, como a de todas as
    // outras.
    const OPENAI_API_KEY = env.OPENAI_API_KEY || '';

    const CC_PUSH_URL    = env.CC_PUSH_URL    || '';
    const WEBHOOK_SECRET  = env.WEBHOOK_SECRET || '';
    const EQUIPE_NUMERO  = env.EQUIPE_NUMERO  || '';
    const IA_ALLOWED_CONTACTS = (env.IA_ALLOWED_CONTACTS || '').split(',').map(s => s.trim()).filter(Boolean);
    const PORT           = env.PORT           || 3000;
    // Chave para proteger os endpoints administrativos (/leads, /diag), que expõem
    // dados de leads e config. Sem ela, esses endpoints ficam BLOQUEADOS (não abertos).
    const ADMIN_KEY      = env.ADMIN_KEY      || '';
    // A IA NÃO responde em grupos por padrão (só conversa individual). Para permitir
    // grupos no futuro, defina IGNORAR_GRUPOS=false.
    const IGNORAR_GRUPOS = (env.IGNORAR_GRUPOS || 'true') !== 'false';
    // A IA só responde tickets PENDENTES (na fila). Quando um humano aceita a
    // conversa (ticket sai de "pending"), a IA para de responder. Para desativar
    // esse filtro, defina IA_SO_PENDENTES=false.
    const IA_SO_PENDENTES = (env.IA_SO_PENDENTES || 'true') !== 'false';
    // Rate-limit por número: no máximo RATE_LIMIT_MSGS mensagens por janela de
    // RATE_LIMIT_JANELA_S segundos (proteção contra loop/spam e custo OpenAI).
    // 0 desativa. Padrão: 20 msgs / 60s.
    const RATE_LIMIT_MSGS   = parseInt(env.RATE_LIMIT_MSGS   || '20', 10);
    const RATE_LIMIT_JANELA = parseInt(env.RATE_LIMIT_JANELA_S || '60', 10) * 1000;
    // Blindagem anti-loop (contra outras IAs / auto-respondedores): se um mesmo
    // contato trocar mais de LOOP_MAX_TURNOS mensagens em LOOP_JANELA_MIN minutos,
    // ou repetir a mesma mensagem, a IA PAUSA as respostas para não entrar em
    // ping-pong infinito com outro bot.
    const LOOP_MAX_TURNOS = parseInt(env.LOOP_MAX_TURNOS || '15', 10);
    const LOOP_JANELA_MS  = parseInt(env.LOOP_JANELA_MIN || '3', 10) * 60 * 1000;
    // Teto de respostas da IA DEPOIS que o lead já foi transferido. Passando disso ela
    // se despede e cala: quem conduz o atendimento a partir da transferência é o
    // consultor humano, e a IA respondendo em paralelo atropela o trabalho dele.
    const MAX_RESPOSTAS_POS_HANDOFF = parseInt(env.MAX_RESPOSTAS_POS_HANDOFF || '3', 10);
    // Janela (ms) para AGRUPAR mensagens rápidas do mesmo cliente antes de responder.
    // No WhatsApp o cliente costuma mandar várias mensagens seguidas; juntamos tudo
    // num único turno em vez de responder só a primeira e ignorar o resto.
    const AGRUPAR_MS     = parseInt(env.AGRUPAR_MENSAGENS_MS || '2000', 10);
    // Reinicia o atendimento após N horas sem interação do cliente (padrão: 24h).
    const RESET_INATIVIDADE = parseInt(env.RESET_INATIVIDADE_HORAS || '24', 10) * 3600 * 1000;
    // Transferência REAL do ticket para o departamento da loja escolhida (fila do
    // CRM), via forceTicketToDepartment da Push API. Defina false para voltar ao
    // comportamento antigo (só a nota interna, encaminhamento manual do atendente).
    const TRANSFERIR_DEPARTAMENTO = (env.TRANSFERIR_DEPARTAMENTO || 'true') !== 'false';
    // A plataforma só reposiciona ticket que está FECHADO ou é primeiro contato. Com
    // isto ligado, o push de transferência fecha o ticket junto (forceTicketToClosed),
    // que é o gatilho documentado para ele reabrir já no departamento certo. Ligue se
    // a transferência simples não mover o ticket de fila.
    const TRANSFERIR_FECHANDO = (env.TRANSFERIR_FECHANDO || 'false') === 'true';

    return Object.freeze({
        OPENAI_API_KEY,
        CC_PUSH_URL,
        WEBHOOK_SECRET,
        EQUIPE_NUMERO,
        IA_ALLOWED_CONTACTS,
        PORT,
        ADMIN_KEY,
        IGNORAR_GRUPOS,
        IA_SO_PENDENTES,
        RATE_LIMIT_MSGS,
        RATE_LIMIT_JANELA,
        LOOP_MAX_TURNOS,
        LOOP_JANELA_MS,
        MAX_RESPOSTAS_POS_HANDOFF,
        AGRUPAR_MS,
        RESET_INATIVIDADE,
        TRANSFERIR_DEPARTAMENTO,
        TRANSFERIR_FECHANDO
    });
}

module.exports = { carregar };
