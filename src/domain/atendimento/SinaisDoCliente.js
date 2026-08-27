// =============================================================
//  SINAIS DO CLIENTE — leitura de intencao por texto
//
//  Rede de seguranca para os campos que a extracao devolve. O modelo erra
//  esses julgamentos com frequencia — costuma classificar impaciencia como
//  conversa normal — e quando erra o funil segue rodando e irrita quem ja
//  disse que tem pressa.
//
//  Sao regras deliberadamente CONSERVADORAS: so entram frases inequivocas em
//  QUALQUER contexto, porque estas expressoes nao enxergam o historico e nao
//  sabem qual pergunta a IA acabou de fazer. O julgamento ambiguo fica com a
//  extracao, que ve a conversa inteira.
//
//  Cada comentario abaixo registra um caso real de producao. Leia antes de
//  acrescentar padrao.
//
//  Modulo puro: so texto entra, so booleano sai.
// =============================================================

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

/** A IA escreveu que ja repassou o atendimento. */
const prometeTransferencia = (texto) => PROMETE_TRANSFERENCIA.test(String(texto || ''));

/** O cliente pediu transferencia com todas as letras. */
const pedeTransferencia = (texto) => PEDE_TRANSFERENCIA.test(String(texto || ''));

/** O cliente nao pediu ninguem, mas quer que o atendimento ANDE. */
const pedeAgilidade = (texto) => PEDE_AGILIDADE.test(String(texto || ''));

/** O cliente nao tem mais nada a tratar e so vai aguardar o consultor. */
const sinalizaEncerramento = (texto) => SINAL_ENCERRAMENTO.test(String(texto || ''));

module.exports = {
    prometeTransferencia,
    pedeTransferencia,
    pedeAgilidade,
    sinalizaEncerramento,
    PROMETE_TRANSFERENCIA,
    PEDE_TRANSFERENCIA,
    PEDE_AGILIDADE,
    SINAL_ENCERRAMENTO
};
