// =============================================================
//  FLOW — lógica PURA do fluxo de qualificação do SDR Avelloz.
//  Compartilhada entre o servidor (index.js) e o tester local
//  (test-chat.js / sim-lead.js) para não haver drift. Sem I/O, sem OpenAI.
//
//  O fluxo é um GUIA: o diagnóstico da realidade atual (transporte + gasto +
//  situação de moto) vem ANTES de liberar modelo/preço. A ordem forte está no
//  SYSTEM (prompts.js); aqui só ditamos a próxima "dica" de campo a coletar.
// =============================================================

const { lojaCanonica, MODELOS } = require('./data');

// Ordem oficial do fluxo Avelloz (diagnóstico → modelo → pagamento → loja).
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
    const t = corrigirNomeModelo(texto); // "AV1" (erro da IA / do cliente) vira AZ1
    if (/\bAZX\s?-?\s?160\b/i.test(t)) return 'AZX160';
    if (/\bAZ\s?-?\s?125\b/i.test(t)) return 'AZ125';
    if (/\bAZ\s?-?\s?1\b/i.test(t))   return 'AZ1';
    return null;
}

// Conserta o nome dos modelos no texto. O modelo de linguagem escreve "AV1"
// puxado por "Avelloz" (aconteceu em produção: o cliente recebeu "AV1 (50cc)"),
// e também troca AZX160 por AZ160/AVX160. O prompt já proíbe mudar o nome dos
// produtos, mas instrução não garante nada: esta correção é determinística e
// roda depois da geração, antes do texto chegar ao cliente.
//
// A ordem importa: os nomes mais longos primeiro, senão o padrão de "AZ1"
// casaria dentro de "AZ125". Também normaliza "AZ 1" e "AZ-1" para a grafia
// oficial, que é sem espaço nem hífen.
function corrigirNomeModelo(texto) {
    if (!texto) return texto;
    return String(texto)
        .replace(/\bA[VZ]X?\s?-?\s?160\b/gi, 'AZX160')
        .replace(/\bA[VZ]Z?\s?-?\s?125\b/gi, 'AZ125')
        .replace(/\bA[VZ]Z?\s?-?\s?1\b/gi,   'AZ1');
}

// Conserta a frase do preço da AZX160, o único modelo em que o emplacamento é
// cobrado à parte. O modelo de linguagem copia o texto da AZ1/AZ125 ("preço
// promocional de R$ X já com o emplacamento incluso") e aplica no valor SEM
// emplacamento — foi o que o cliente recebeu em produção: "R$ 19.990,00 já com
// o emplacamento incluso", R$ 1.000,00 a menos do que a moto emplacada custa.
//
// A frase inteira é trocada pela versão correta, com os dois valores. Trocar só
// "já com" por "sem" deixaria a mensagem contraditória com o resto da frase.
const AZX = MODELOS.az160;
const PRECO_SEM = new RegExp(String(AZX.precoNum).replace(/^(\d+)(\d{3})$/, '$1\\.?$2') + '(?:,00)?');
const PRECO_COM = new RegExp(String(AZX.precoComEmplacamentoNum).replace(/^(\d+)(\d{3})$/, '$1\\.?$2') + '(?:,00)?');
const DIZ_INCLUSO = /(j[áa]\s+)?com\s+(o\s+)?emplacamento|emplacamento\s+(incluso|inclu[ií]d[oa])/i;
const DIZ_SEM     = /sem\s+(o\s+)?emplacamento/i;
const FRASE_CERTA = `A ${AZX.nome} está ${AZX.preco} sem o emplacamento e ${AZX.precoComEmplacamento} com o emplacamento incluso`;

function corrigirPrecoEmplacamento(texto) {
    if (!texto) return texto;
    // Quebra em frases preservando a pontuação, para trocar só a frase errada.
    // O (?!\d) evita quebrar dentro do próprio valor: o ponto de "19.990" é
    // separador de milhar, não fim de frase.
    return String(texto).split(/(?<=[.!?\n])(?!\d)/).map(frase => {
        const temSem = PRECO_SEM.test(frase);
        const temCom = PRECO_COM.test(frase);
        if (temSem && temCom) return frase;                    // já cita os dois valores: correto
        const erroNoSem = temSem && DIZ_INCLUSO.test(frase) && !DIZ_SEM.test(frase);
        const erroNoCom = temCom && DIZ_SEM.test(frase) && !DIZ_INCLUSO.test(frase);
        if (!erroNoSem && !erroNoCom) return frase;
        // Preserva o espaço em volta: a frase trocada continua colada ao resto
        // do texto do mesmo jeito que estava.
        const espacoInicial = frase.match(/^(\s+)/)?.[1] || '';
        const espacoFinal = frase.match(/(\s+)$/)?.[1] || '';
        const pontuacao = frase.trimEnd().match(/([.!?]+)$/)?.[1] || '.';
        return espacoInicial + FRASE_CERTA + pontuacao + espacoFinal;
    }).join('');
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
    // Campo que o cliente não respondeu depois de várias tentativas é PULADO
    // (index.js preenche camposPulados). Sem isto o prompt mandava "deixar o
    // assunto de lado", mas a state machine continuava exigindo o dado: a
    // qualificação nunca fechava e o lead nunca era transferido, mesmo já tendo
    // escolhido a loja. A loja não entra aqui: sem ela não há para onde transferir.
    const pulados = Array.isArray(leadData.camposPulados) ? leadData.camposPulados : [];
    const falta = (c) => !leadData[c] && !pulados.includes(c);

    // UMA pergunta por vez, sempre. Perguntas duplas ("quanto gasta E quanto tempo
    // perde?") fazem o cliente responder só a segunda parte: o campo continua vazio,
    // a IA repete a pergunta e ele se irrita — foi o que travou o atendimento no print.
    if (falta('finalidade'))      return { campo: 'finalidade',      pergunta: 'Pergunte APENAS pra que ele quer a moto (trabalhar, economizar, passear, pra esposa). Esse é o passo 2, interesse. Não emende nenhuma outra pergunta na mesma mensagem.' };
    if (falta('transporteAtual')) return { campo: 'transporteAtual', pergunta: 'Pergunte APENAS como ele se locomove HOJE: carro, Uber, ônibus, carona ou moto alugada (passo 3, diagnóstico). Uma coisa de cada vez.' };
    if (falta('gastoMensal'))     return { campo: 'gastoMensal',     pergunta: 'Pergunte APENAS quanto ele gasta por mês nesse transporte, fazendo ele dizer o número em reais. NÃO pergunte junto sobre tempo perdido no trânsito nem qualquer outra coisa: só o valor.' };
    if (falta('situacaoMoto'))    return { campo: 'situacaoMoto',    pergunta: 'Descubra se ele já tem moto e a situação (própria, alugada, velha, manutenção cara). Se roda de app, pergunte quanto paga de aluguel por semana/mês.' };
    if (falta('modeloInteresse')) return { campo: 'modeloInteresse', pergunta: leadData.modeloApresentado
        ? `Você JÁ recomendou a ${leadData.modeloApresentado} e JÁ mostrou a conta do gasto anual. NÃO recomende outro modelo, NÃO repita o preço e NÃO refaça o cálculo: apenas confirme, numa pergunta curta, se é essa mesma que ele quer levar.`
        : 'Diagnóstico feito: mostre a conta (o gasto dele projetado no ano) UMA vez e recomende o modelo que encaixa (AZ1 economia, AZ125 equilíbrio, AZX160 potência). Confirme qual interessou.' };
    // A forma de pagamento NÃO bloqueia o fechamento depois que o cliente escolheu
    // a unidade: quem fecha a condição é o consultor da loja. Insistir aqui fazia a
    // IA voltar atrás e reperguntar pagamento depois de o cliente já ter decidido
    // onde comprar — que foi o que travou o atendimento no print.
    if (falta('formaPagamento') && !leadData.loja) return { campo: 'formaPagamento',  pergunta: 'Pergunte qual forma de pagamento faz mais sentido: cartão (até 21x), financiamento (até 48x, podendo sair com entrada zero dependendo da análise do CPF), consórcio ou à vista.' };
    if (!leadData.loja)            return { campo: 'loja',            pergunta: 'Pergunte qual unidade fica melhor pra ele, citando SEMPRE as TRÊS: Matriz e Malvinas (Campina Grande) e Monteiro. Nunca ofereça só duas. Identificar a loja é OBRIGATÓRIO antes de transferir.' };
    leadData.qualificacaoCompleta = true;
    return null;
}

// Diagnóstico mínimo: transporte + gasto + situação de moto. Dado que o cliente
// não quis responder e foi pulado (camposPulados) conta como resolvido.
function diagnosticoCompleto(leadData) {
    const pulados = Array.isArray(leadData.camposPulados) ? leadData.camposPulados : [];
    const resolvido = (c) => !!leadData[c] || pulados.includes(c);
    return resolvido('transporteAtual') && resolvido('gastoMensal') && resolvido('situacaoMoto');
}

// INSISTÊNCIA NO PREÇO. O bloqueio de diagnóstico vale só para o PRIMEIRO pedido:
// no print, quem perguntou "qual é o preço?" duas vezes (ou disse "só quero saber
// o preço") recebeu mais uma pergunta de diagnóstico e foi embora. A partir do
// 2º pedido, ou de um "só quero o preço" logo de cara, o preço fica liberado.
// Pergunta de parcela/entrada/juros não conta: essa quem responde é o consultor.
const PEDE_PRECO = /(pre[çc]o|quanto\s+(custa|[ée]|t[áa]|sai|fica|vale)|\bvalor(es)?\b)/i;
const NAO_E_PRECO_DA_MOTO = /parcela|entrada|juros|presta[çc]/i;
const SO_QUER_PRECO = /(s[óo]|apenas|somente)\s+(quero\s+)?(saber\s+)?(o\s+|os\s+)?(pre[çc]o|valor)|quero\s+(s[óo]|apenas|somente)\s+(saber\s+)?(o\s+|os\s+)?(pre[çc]o|valor)/i;

// `texto` é a fala do cliente SEM o trecho citado (a citação pode ser uma
// mensagem da própria IA falando de preço). Liga leadData.precoLiberado, que
// fica ligado: o prompt libera o valor enquanto ele ainda não foi informado.
function registrarPedidoPreco(leadData, texto, extraido) {
    const t = texto || '';
    const pediu = (!!(extraido && extraido.pediuPreco) || PEDE_PRECO.test(t)) && !NAO_E_PRECO_DA_MOTO.test(t);
    if (!pediu) return;
    leadData.pedidosPreco = (leadData.pedidosPreco || 0) + 1;
    if (leadData.pedidosPreco >= 2 || SO_QUER_PRECO.test(t)) leadData.precoLiberado = true;
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
        let v = extraido[c];
        // Só aceita loja que aponta para um departamento de verdade. Um valor
        // como "Campina Grande" antes fechava a qualificação sem destino: o
        // ticket ficava no Agente IA e a equipe nem era alertada.
        if (c === 'loja' && v) v = lojaCanonica(v);
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

module.exports = { CAMPOS, CAMPOS_EXTRAS, determinarProximoCampo, aplicarCampos, detectarPerfil, detectarModeloMencionado, corrigirNomeModelo, corrigirPrecoEmplacamento, diagnosticoCompleto, registrarPedidoPreco };
