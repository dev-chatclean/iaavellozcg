// =============================================================
//  DADOS DE NEGÓCIO — IA Avelloz Campina
//  Todo o conhecimento comercial e operacional que a IA usa.
//  A lógica (state machine, chamadas OpenAI) fica no index.js;
//  os prompts em prompts.js. Aqui só CONTEÚDO.
//
//  Fonte: PROMPT-MESTRE ULTRABLOQUEADO — SDR Virtual Avelloz Campina (V2).
// =============================================================

// -------------------------------------------------------------
//  A EMPRESA
// -------------------------------------------------------------
const EMPRESA_INFO = {
    nome: 'Avelloz Campina - Realliza Motos',
    tagline: 'Motos econômicas com facilidade de pagamento',
    descricao: 'Concessionária Avelloz em Campina Grande e Monteiro — PB. Referência em moto econômica, emplacamento incluso e facilidade de pagamento (cartão, financiamento, consórcio e à vista).',
    localizacao: 'Campina Grande–PB (Matriz e Malvinas) e Monteiro–PB. Atendimento pelo WhatsApp e presencial nas lojas.',
    horarioSuporte: 'Segunda a sábado, em horário comercial.',
    site: ''
};

// -------------------------------------------------------------
//  CATÁLOGO DE MODELOS (preços promocionais JÁ COM EMPLACAMENTO)
//  Regras (ver prompts.js): só liberar modelo/preço APÓS o diagnóstico
//  mínimo. Nunca informar valor de PARCELA (transferir para humano).
//  Nunca mudar o nome dos produtos: AZ1, AZ125, AZX160.
// -------------------------------------------------------------
const MODELOS = {
    az1: {
        nome: 'AZ1',
        cilindrada: '50cc',
        preco: 'R$ 11.390,00',
        precoNum: 11390,
        perfil: 'Economia máxima para o dia a dia na cidade.',
        descricao: 'Super econômica e confortável, chega a fazer até 50km com 1L de gasolina. Entrada USB e Tipo C pra carregar o celular. Aro 17 pra não passar arrastando nas lombadas. Porta-sacolas, baú espaçoso, painel digital (marcha, setas, km, gasolina e neutro) e freio a disco na dianteira.',
        cores: 'Branca, Preta e Vermelha',
        comparativo: 'Motoneta urbana estilo "cub", concorre com Pop/Biz/Jet e outras 50cc. Motor 49cc com 2,7 cv, câmbio semiautomático de 4 marchas, partida elétrica e pedal. Design moderno com LED, painel completo, freio a disco dianteiro, rodas aro 17 e entrada USB. Consumo médio entre 40 e 50 km/L, tanque de 5 litros.',
        imagem: 'https://www.instagram.com/p/DOHMgM_Ejjq/?igsh=NjE5b3V0MjM4dWt4'
    },
    az125: {
        nome: 'AZ125',
        cilindrada: '125cc (Alfa)',
        preco: 'R$ 14.190,00',
        precoNum: 14190,
        perfil: 'Equilíbrio, conforto e potência para o dia a dia.',
        descricao: 'Moto completa, com conforto e potência. Injeção eletrônica, faróis full LED e freio CBS (mais segurança).',
        cores: 'Branca, Preta, Vermelha e Cinza (cor exclusiva)',
        comparativo: 'Moto urbana 125cc que concorre com Pop/Biz/Jet e outras 125cc. Motor 123,67 cm³ com injeção eletrônica, 8,5 cv, câmbio semiautomático de 4 marchas (sem embreagem). Design moderno, farol LED, painel digital, entradas USB (A e C), freios CBS, rodas aro 17. Foco em conforto, agilidade e baixo consumo.',
        imagem: 'https://www.instagram.com/p/DOHMiySkqHw/?igsh=MWZoNmVjZGxocGloYQ=='
    },
    az160: {
        nome: 'AZX160',
        cilindrada: '160cc',
        preco: 'R$ 19.990,00',
        precoNum: 19990,
        perfil: 'Potência, conforto e estilo — cidade e estrada.',
        descricao: 'Alta potência, confortável, econômica, já vem com proteção de carenagem e muito estilo. Entrada USB e Tipo C, farol full LED, pneus aro 19 dianteiro e 17 traseiro, painel digital, injeção eletrônica e freio CBS.',
        cores: 'Preta, Vermelha e Azul',
        comparativo: 'Moto trail de 160cc que concorre com Bros 160 e Crosser 150. Motor 161,9 cm³ com injeção eletrônica, 12,3 cv, câmbio de 5 marchas, consumo médio de ~35 km/L. Design aventureiro com rodas raiadas, protetores e bolha frontal, painel digital, iluminação full LED e entradas USB. Suspensão de longo curso, freios a disco com CBS, tanque de 13 litros. Garantia de 6 meses.',
        imagem: 'https://www.instagram.com/p/DOHMkywki9w/?igsh=MW5nejRvbGx0ZXJtcg=='
    }
};

// -------------------------------------------------------------
//  FORMAS DE PAGAMENTO
//  Nunca informar valor de PARCELA (transferir para humano).
// -------------------------------------------------------------
const FORMAS_PAGAMENTO = {
    cartao: 'Cartão de crédito em até 21x.',
    financiamento: 'Financiamento com entrada ZERO em até 48x, dependendo do CPF. A gente consulta em 3 bancos; banco aprovou, sai com a moto no mesmo dia.',
    consorcio: 'Consórcio.',
    avista: 'À vista.'
};

// -------------------------------------------------------------
//  UNIDADES / LOJAS (identificar a loja é OBRIGATÓRIO antes de transferir)
//  Monteiro é OUTRA cidade, tratada igual a Campina.
// -------------------------------------------------------------
const LOJAS = {
    matriz: {
        nome: 'Loja Matriz',
        cidade: 'Campina Grande - PB',
        endereco: 'Rua João Suassuna, 300 - Centro',
        maps: 'https://maps.app.goo.gl/NLzrCiEozVgKW3ch7'
    },
    malvinas: {
        nome: 'Loja Malvinas',
        cidade: 'Campina Grande - PB',
        endereco: 'Avenida Francisco Lopes de Almeida, 7 - Rocha Cavalcante',
        maps: 'https://maps.app.goo.gl/LbUkKANGKE6GTbw7A'
    },
    monteiro: {
        nome: 'Loja Monteiro',
        cidade: 'Monteiro - PB',
        endereco: 'Rua Coronel Francisco Cândido, 11 - Loteamento Boa Vista',
        maps: 'https://maps.app.goo.gl/wQFZWXjhWSTx57bU7'
    }
};

// -------------------------------------------------------------
//  PERFIS DE CLIENTE (o "gancho" da dor — como abordar cada caso).
//  Usado para a IA reconhecer a realidade do lead e mostrar a conta.
//  (No código antigo isso era "segmento"; aqui vira "perfil".)
// -------------------------------------------------------------
const PERFIS = {
    app_aluga:      { nome: 'Roda de app — moto alugada', gancho: 'Descobrir quanto paga de aluguel por semana/mês: costuma ser maior que uma parcela, e ele paga sem nunca ficar com a moto. Mostrar que a parcela tende a ser menor e no fim a moto é DELE.' },
    app_comecando:  { nome: 'Roda de app — começando', gancho: 'Custo de oportunidade: cada dia sem moto é entrega que ele deixa de fazer. A moto se paga rodando.' },
    app_trocar:     { nome: 'Roda de app — quer trocar', gancho: 'Foco em economia e confiabilidade: perguntar quanto gasta de manutenção e quanto a moto vive parada. Uma zero sem oficina compensa.' },
    depende_uber:   { nome: 'Depende de Uber/99', gancho: 'Somar o gasto diário/semanal de Uber e projetar no ano: o valor já daria pra ter a própria moto — e sem ficar com nada na mão.' },
    depende_onibus: { nome: 'Depende de ônibus', gancho: 'Somar a passagem mensal e o tempo perdido no ponto/lotado: liberdade de sair na hora que quiser.' },
    tem_carro:      { nome: 'Tem carro', gancho: 'Deixar o carro em casa no dia a dia e economizar combustível e estacionamento, usando a moto pra correria.' },
    esposa:         { nome: 'Compra pra esposa/família', gancho: 'Autonomia pra ela não depender de ninguém nem de Uber pra sair — muda a rotina de casa.' },
    primeira_moto:  { nome: 'Primeira moto', gancho: 'Realizar o sonho da própria moto com facilidade de pagamento e emplacamento incluso.' }
};

// -------------------------------------------------------------
//  BIBLIOTECA DE OBJEÇÕES (respostas consultivas)
//  A IA conhece isto para responder com segurança.
// -------------------------------------------------------------
const OBJECOES = {
    juros_financiamento: 'Reconheça o juros com honestidade, mas vire a chave: hoje ele já paga Uber/ônibus/aluguel todo mês e não fica com nada; na moto ele paga a parcela e a moto é DELE. Melhor pagar por algo que fica.',
    ta_caro:            'Ancore no que ele já gasta hoje com transporte (o número que ELE deu) projetado no ano. O preço é promocional e já inclui o emplacamento. Nunca informar valor de parcela — transferir para o consultor.',
    preciso_pensar:     'Faça sentido, sem pressão. Reforce a economia do dia a dia e convide a conhecer a moto pessoalmente na loja. Termine com uma pergunta que mantenha a conversa viva.',
    medo_credito:       'Tranquilize: a consulta é em 3 bancos e existe chance de entrada ZERO em até 48x, dependendo do CPF. Só coletar os dados pra simulação — quem confirma a aprovação é o consultor.',
    sem_cnh:            'CNH NUNCA é obrigatório pra comprar a moto. Tranquilize e siga normalmente com a simulação.',
    moto_usada_troca:   'A Avelloz NÃO trabalha com troca/aceite de moto usada. Conduza com simpatia para as formas de pagamento (cartão, financiamento, consórcio, à vista).',
    test_drive:         'A Avelloz NÃO oferece test drive. Convide o cliente a conhecer a moto pessoalmente na loja.',
    prazo_entrega:      'NUNCA prometa prazo de entrega. Diga que o consultor humano confirma os prazos certinhos.',
    marca_desconhecida: 'A Avelloz é referência em moto econômica e com facilidade de pagamento. Valorize a economia (km/L), o emplacamento incluso e as condições, e já puxe a próxima pergunta.'
};

// -------------------------------------------------------------
//  DEPARTAMENTOS DE TRANSFERÊNCIA
//  O sinal enviado ao CRM é "Transferir para o departamento [nome]".
//  A loja escolhida define o departamento (identificação OBRIGATÓRIA).
// -------------------------------------------------------------
const DEPARTAMENTOS = {
    matriz:   'Loja Matriz',
    malvinas: 'Loja Malvinas',
    monteiro: 'Loja Monteiro',
    geral:    'Comercial',   // fallback quando a loja não foi identificada
    posvenda: 'Pós-venda'    // cliente atual pedindo suporte/pós-venda
};

// Mapeia o texto da loja escolhida pelo cliente para o departamento do CRM.
function lojaParaDepartamento(lojaTexto) {
    const t = String(lojaTexto || '').toLowerCase();
    if (/malvina/.test(t)) return DEPARTAMENTOS.malvinas;
    if (/monteiro/.test(t)) return DEPARTAMENTOS.monteiro;
    if (/matriz|centro|jo[aã]o suassuna/.test(t)) return DEPARTAMENTOS.matriz;
    return null;
}

// -------------------------------------------------------------
//  CAMPOS DE QUALIFICAÇÃO (ordem do fluxo SDR Avelloz)
//  O diagnóstico da realidade atual vem ANTES de modelo/preço.
//  O index.js usa isto na state machine (flow.js).
// -------------------------------------------------------------
const CAMPOS_QUALIFICACAO = [
    'nome', 'finalidade', 'transporteAtual', 'gastoMensal',
    'situacaoMoto', 'modeloInteresse', 'formaPagamento', 'loja'
];

// Dados coletados EM BLOCO para a simulação (não entram na ordem 1-a-1 do fluxo).
const CAMPOS_SIMULACAO = ['nomeCompleto', 'cpf', 'dataNascimento', 'telefone', 'cnh', 'corModelo'];

module.exports = {
    EMPRESA_INFO,
    MODELOS,
    FORMAS_PAGAMENTO,
    LOJAS,
    PERFIS,
    OBJECOES,
    DEPARTAMENTOS,
    lojaParaDepartamento,
    CAMPOS_QUALIFICACAO,
    CAMPOS_SIMULACAO
};
