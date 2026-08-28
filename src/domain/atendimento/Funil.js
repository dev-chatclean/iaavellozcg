// =============================================================
//  FUNIL — a ordem em que o atendimento avanca
//
//  Decide qual e a PROXIMA informacao a coletar, e devolve junto a instrucao
//  que o modelo recebe para pedi-la. Uma pergunta por vez, sempre: perguntas
//  duplas ("quanto gasta E quanto tempo perde?") fazem o cliente responder so
//  a segunda parte, o campo continua vazio, a IA repete e ele se irrita.
//
//  A ordem nao e arbitraria — e o metodo de venda. O DIAGNOSTICO da realidade
//  atual vem antes de qualquer produto, porque quem ouve o preco antes de
//  fazer a conta do que ja gasta compara a moto com zero.
//
//  Modulo puro: recebe o estado, devolve a etapa. Nao faz I/O.
//
//  NOTA DE LEITURA: o corpo foi movido verbatim do flow.js.
// =============================================================
const CAMPOS = ['finalidade', 'transporteAtual', 'gastoMensal', 'situacaoMoto', 'modeloInteresse', 'formaPagamento', 'loja'];

// Dados coletados EM BLOCO para a simulação (capturados oportunamente, não
// bloqueiam o fluxo 1-a-1). O nome também é capturado aqui quando surge.
const CAMPOS_EXTRAS = ['nome', 'nomeCompleto', 'cpf', 'dataNascimento', 'telefone', 'cnh', 'corModelo'];

// State machine: retorna o próximo campo a coletar (com a instrução p/ o modelo)
// ou null quando a qualificação está completa (marca leadData.qualificacaoCompleta).
// Modelo citado num texto (usado para saber qual moto a IA já apresentou).
// A ordem importa: AZX160 e AZ125 são testados antes de AZ1, senão "AZ1"
// casaria dentro de "AZ125".
function detectarModeloMencionado(texto) {
    if (!texto) return null;
    if (/\bAZX\s?-?\s?160\b/i.test(texto)) return 'AZX160';
    if (/\bAZ\s?-?\s?125\b/i.test(texto)) return 'AZ125';
    if (/\bAZ\s?-?\s?1\b/i.test(texto))   return 'AZ1';
    return null;
}

function determinarProximoCampo(leadData) {
    // ATALHO: o cliente disse que tem pressa / quer ir direto ao assunto. O funil
    // inteiro é abandonado e só a LOJA importa, porque é o único campo obrigatório
    // para transferir de verdade (sem ela o ticket não sai da fila do Agente IA).
    // Ligado em index.js quando querAvancar / PEDE_AGILIDADE dispara.
    if (leadData.modoAtalho) {
        if (!leadData.loja) return { campo: 'loja', pergunta: 'O cliente pediu OBJETIVIDADE. NÃO faça diagnóstico, NÃO pergunte gasto, transporte ou forma de pagamento e NÃO ofereça modelo. Pergunte SÓ em qual unidade ele quer ser atendido, citando as três (Matriz, Malvinas e Monteiro). Uma frase curta, nada mais.' };
        leadData.qualificacaoCompleta = true;
        return null;
    }

    // A IA já recomendou uma moto e o cliente SEGUIU ADIANTE (falou de pagamento,
    // escolheu loja ou passou dados) sem dizer "quero essa" com todas as letras.
    // Sem isto o fluxo fica preso em modeloInteresse: a cada mensagem a instrução
    // volta a ser "recomende um modelo", e a IA acaba trocando de moto sozinha,
    // contradizendo o preço que ela mesma acabou de dar.
    // Também adota quando a moto já apareceu em DUAS mensagens da IA sem o cliente
    // recusar: senão ela fica presa em "é essa que você quer levar?" a cada turno.
    if (!leadData.modeloInteresse && leadData.modeloApresentado) {
        const vezesApresentada = (leadData.conversationHistory || [])
            .filter(h => h.role === 'assistant' && detectarModeloMencionado(h.content) === leadData.modeloApresentado)
            .length;
        if (vezesApresentada >= 2 || leadData.formaPagamento || leadData.loja || leadData.cpf || leadData.corModelo) {
            leadData.modeloInteresse = leadData.modeloApresentado;
        }
    }
    // UMA pergunta por vez, sempre. Perguntas duplas ("quanto gasta E quanto tempo
    // perde?") fazem o cliente responder só a segunda parte: o campo continua vazio,
    // a IA repete a pergunta e ele se irrita — foi o que travou o atendimento no print.
    if (!leadData.finalidade)      return { campo: 'finalidade',      pergunta: 'Pergunte APENAS pra que ele quer a moto (trabalhar, economizar, passear, pra esposa) — passo 2, interesse. Não emende nenhuma outra pergunta na mesma mensagem.' };
    if (!leadData.transporteAtual) return { campo: 'transporteAtual', pergunta: 'Pergunte APENAS como ele se locomove HOJE: carro, Uber, ônibus, carona ou moto alugada (passo 3 — diagnóstico). Uma coisa de cada vez.' };
    if (!leadData.gastoMensal)     return { campo: 'gastoMensal',     pergunta: 'Pergunte APENAS quanto ele gasta por mês nesse transporte, fazendo ele dizer o número em reais. NÃO pergunte junto sobre tempo perdido no trânsito nem qualquer outra coisa — só o valor.' };
    if (!leadData.situacaoMoto)    return { campo: 'situacaoMoto',    pergunta: 'Descubra se ele já tem moto e a situação (própria, alugada, velha, manutenção cara). Se roda de app, pergunte quanto paga de aluguel por semana/mês.' };
    if (!leadData.modeloInteresse) return { campo: 'modeloInteresse', pergunta: leadData.modeloApresentado
        ? `Você JÁ recomendou a ${leadData.modeloApresentado} e JÁ mostrou a conta do gasto anual. NÃO recomende outro modelo, NÃO repita o preço e NÃO refaça o cálculo: apenas confirme, numa pergunta curta, se é essa mesma que ele quer levar.`
        : 'Diagnóstico feito: mostre a conta (o gasto dele projetado no ano) UMA vez e recomende o modelo que encaixa (AZ1 economia, AZ125 equilíbrio, AZX160 potência). Confirme qual interessou.' };
    // A forma de pagamento NÃO bloqueia o fechamento depois que o cliente escolheu
    // a unidade: quem fecha a condição é o consultor da loja. Insistir aqui fazia a
    // IA voltar atrás e reperguntar pagamento depois de o cliente já ter decidido
    // onde comprar — que foi o que travou o atendimento no print.
    if (!leadData.formaPagamento && !leadData.loja) return { campo: 'formaPagamento',  pergunta: 'Pergunte qual forma de pagamento faz mais sentido: cartão (até 21x), financiamento (entrada zero em até 48x dependendo do CPF), consórcio ou à vista.' };
    if (!leadData.loja)            return { campo: 'loja',            pergunta: 'Pergunte qual unidade fica melhor pra ele, citando SEMPRE as TRÊS: Matriz e Malvinas (Campina Grande) e Monteiro. Nunca ofereça só duas. Identificar a loja é OBRIGATÓRIO antes de transferir.' };
    leadData.qualificacaoCompleta = true;
    return null;
}

// Campos de ESCOLHA que mudam ao longo da conversa: o último valor informado
// vence (ex.: perguntou o preço da AZ1 mas depois escolheu a AZ125; trocou a
// forma de pagamento ou a loja). Diferente dos fatos do diagnóstico, que ficam.
const MUTAVEIS = ['modeloInteresse', 'formaPagamento', 'loja', 'corModelo', 'cnh'];

// Aplica os campos extraídos ao leadData. Por padrão NÃO sobrescreve o que já
// foi coletado — exceto os campos MUTAVEIS (último valor vence) e os que o
// cliente está CORRIGINDO explicitamente (extraido.correcao = lista de campos).
function aplicarCampos(leadData, extraido) {
    if (!extraido) return;
    const correcoes = Array.isArray(extraido.correcao) ? extraido.correcao : [];
    for (const c of [...CAMPOS, ...CAMPOS_EXTRAS]) {
        const v = extraido[c];
        if (v === null || v === undefined || v === '') continue;
        if (!leadData[c] || correcoes.includes(c) || MUTAVEIS.includes(c)) {
            leadData[c] = v;
        }
    }
}

// Detecta o PERFIL do cliente (para o gancho de dor) por palavras-chave.
// Ordem importa: casos de app/aluguel são checados antes dos genéricos.
const PERFIL_KEYWORDS = [
    ['app_aluga',      ['alug', 'aluguel', 'alugada', 'locada']],
    ['app_comecando',  ['começando', 'comecando', 'vou começar', 'quero rodar', 'começar a rodar']],
    ['app_trocar',     ['trocar a moto', 'trocar minha moto', 'moto velha', 'moto parada', 'manutenção cara', 'manutencao cara']],
    ['esposa',         ['esposa', 'minha mulher', 'namorada', 'pra ela', 'pra minha filha', 'pra minha esposa']],
    ['depende_uber',   ['uber', '99', 'noventa e nove', 'aplicativo de transporte', 'indriver', 'táxi', 'taxi']],
    ['depende_onibus', ['ônibus', 'onibus', 'passagem', 'transporte público', 'transporte publico', 'busão', 'busao']],
    ['tem_carro',      ['carro', 'meu carro', 'gasolina do carro', 'combustível do carro', 'estacionamento']],
    ['primeira_moto',  ['primeira moto', 'nunca tive moto', 'nunca tive uma moto', 'minha primeira']]
];
function detectarPerfil(texto) {
    if (!texto) return null;
    const t = texto.toLowerCase();
    for (const [key, kws] of PERFIL_KEYWORDS) {
        if (kws.some(kw => t.includes(kw))) return key;
    }
    return null;
}

module.exports = { CAMPOS, CAMPOS_EXTRAS, determinarProximoCampo, aplicarCampos, detectarPerfil, detectarModeloMencionado };
