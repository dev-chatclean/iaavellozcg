// =============================================================
//  FLOW — FACHADA do fluxo de qualificação.
//
//  A lógica vive em src/domain/atendimento/ desde a SPEC 0006:
//    EtapaDoFunil  ordem oficial e a próxima etapa (RN-002)
//    Qualificacao  política de sobrescrita de campos (RN-003)
//    Perfil        classificação da dor (RN-005)
//
//  Este arquivo continua existindo porque index.js, test-chat.js e sim-lead.js
//  ainda o importam. Ele morre quando o turno virar caso de uso (spec 0008) e
//  os testers forem unificados (spec 0010).
//
//  ATENÇÃO — a fachada PRESERVA o efeito colateral do legado (D-06):
//  `determinarProximoCampo` marca `qualificacaoCompleta` no lead ao consultar.
//  No domínio isso não existe: `EtapaDoFunil.proxima()` é pura. A correção do
//  D-06 muda comportamento observável (montar um follow-up deixa de qualificar
//  o lead) e por isso tem spec própria — não entra numa fatia estrutural.
// =============================================================

const EtapaDoFunil = require('./src/domain/atendimento/EtapaDoFunil');
const Qualificacao = require('./src/domain/atendimento/Qualificacao');
const Perfil = require('./src/domain/atendimento/Perfil');

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
