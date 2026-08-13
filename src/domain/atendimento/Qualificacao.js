// =============================================================
//  QUALIFICAÇÃO — os campos coletados e a política de sobrescrita (RN-003)
//
//  Regra: fatos do diagnóstico, uma vez coletados, NÃO são sobrescritos —
//  o cliente não "desgasta" o que já contou. Campos de ESCOLHA aceitam o
//  último valor (ele pode mudar de modelo, de forma de pagamento, de loja).
//  E qualquer campo cede quando o cliente está corrigindo explicitamente.
//
//  Extraído de flow.js na SPEC 0006, com uma diferença estrutural: `aplicar`
//  é PURA — recebe os campos atuais e devolve os novos, em vez de mutar o
//  objeto do chamador.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

const { CAMPOS } = require('./EtapaDoFunil');

// Dados coletados EM BLOCO para a simulação de crédito (RN-004). Não entram
// na ordem 1-a-1 do funil: são capturados quando surgem.
const CAMPOS_EXTRAS = Object.freeze([
    'nome',
    'nomeCompleto',
    'cpf',
    'dataNascimento',
    'telefone',
    'cnh',
    'corModelo'
]);

// Campos de ESCOLHA: mudam ao longo da conversa e o último valor vence.
// Ex.: perguntou o preço da AZ1 mas depois escolheu a AZ125.
const MUTAVEIS = Object.freeze(['modeloInteresse', 'formaPagamento', 'loja', 'corModelo', 'cnh']);

const TODOS_OS_CAMPOS = Object.freeze([...CAMPOS, ...CAMPOS_EXTRAS]);

/** @param {unknown} valor */
function ehVazio(valor) {
    return valor === null || valor === undefined || valor === '';
}

/**
 * Aplica o que foi extraído aos campos já coletados (RN-003).
 * @param {import('./tipos').EstadoDoAtendimento} [atuais] Campos já coletados.
 * @param {import('../../application/portas').Extracao|null} [extraido]
 * @returns {import('./tipos').EstadoDoAtendimento} Novo objeto; `atuais` não é tocado.
 */
function aplicar(atuais = {}, extraido) {
    const resultado = { ...atuais };
    if (!extraido) return resultado;

    const correcoes = Array.isArray(extraido.correcao) ? extraido.correcao : [];

    for (const campo of TODOS_OS_CAMPOS) {
        const valor = extraido[campo];
        if (ehVazio(valor)) continue;

        const aindaVazio = !resultado[campo];
        const foiCorrigido = correcoes.includes(campo);
        const aceitaUltimoValor = MUTAVEIS.includes(campo);

        if (aindaVazio || foiCorrigido || aceitaUltimoValor) {
            resultado[campo] = valor;
        }
    }
    return resultado;
}

/**
 * Só os campos que a qualificação conhece — descarta sinais transitórios.
 * @param {import('./tipos').EstadoDoAtendimento} [objeto]
 */
function apenasCamposConhecidos(objeto = {}) {
    const saida = {};
    for (const campo of TODOS_OS_CAMPOS) {
        if (!ehVazio(objeto[campo])) saida[campo] = objeto[campo];
    }
    return saida;
}

module.exports = { CAMPOS, CAMPOS_EXTRAS, MUTAVEIS, TODOS_OS_CAMPOS, aplicar, apenasCamposConhecidos };
