// =============================================================
//  FUNIL — fachada do fluxo de qualificacao
//
//  A logica vive nos modulos ao lado desde a SPEC 0006:
//    EtapaDoFunil  ordem oficial e a proxima etapa (RN-002)
//    Qualificacao  politica de sobrescrita de campos (RN-003)
//    Perfil        classificacao da dor (RN-005)
//
//  Esta fachada existe por UM motivo: preservar o efeito colateral do legado
//  (D-06). `determinarProximoCampo` marca `qualificacaoCompleta` no lead ao
//  CONSULTAR — no dominio isso nao acontece, `EtapaDoFunil.proxima()` e pura.
//
//  Corrigir muda comportamento observavel: hoje, montar uma mensagem de
//  follow-up para um funil completo qualifica o lead. Por isso a correcao tem
//  spec propria (0021) e nao entra numa fatia estrutural. Quando ela chegar,
//  este arquivo some e quem chama passa a usar o dominio direto.
//
//  Era `flow.js` na raiz ate a SPEC 0022.
// =============================================================

const EtapaDoFunil = require('./EtapaDoFunil');
const Qualificacao = require('./Qualificacao');
const Perfil = require('./Perfil');

const CAMPOS = EtapaDoFunil.CAMPOS;
const CAMPOS_EXTRAS = Qualificacao.CAMPOS_EXTRAS;

// State machine: retorna o próximo campo a coletar (com a instrução p/ o modelo)
// ou null quando a qualificação está completa.
function determinarProximoCampo(leadData) {
    const etapa = EtapaDoFunil.proxima(leadData);
    if (etapa) return { campo: etapa.campo, pergunta: etapa.instrucao };

    leadData.qualificacaoCompleta = true; // efeito colateral herdado (D-06)
    return null;
}

// Aplica os campos extraídos ao leadData, segundo a política de sobrescrita.
function aplicarCampos(leadData, extraido) {
    if (!extraido) return;
    const resultado = Qualificacao.aplicar(leadData, extraido);
    for (const campo of Qualificacao.TODOS_OS_CAMPOS) {
        if (resultado[campo] !== undefined) leadData[campo] = resultado[campo];
    }
}

// Detecta o PERFIL do cliente (para o gancho de dor) por palavras-chave.
function detectarPerfil(texto) {
    return Perfil.classificar(texto);
}

module.exports = { CAMPOS, CAMPOS_EXTRAS, determinarProximoCampo, aplicarCampos, detectarPerfil };
