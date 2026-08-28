// =============================================================
//  CHATCLEAN — PIPELINE COMERCIAL (Oportunidades / CRM)
//  Cria uma oportunidade no funil comercial quando o lead AGENDA
//  uma reunião (etapa "REUNIÃO MARCADA").
//
//  Reaproveita a MESMA base+token do CC_PUSH_URL (endpoint externo):
//     CC_PUSH_URL = https://.../v1/api/external/{uuid}/?token=JWT
//     POST         https://.../v1/api/external/{uuid}/opportunities?token=JWT
//
//  Contrato confirmado por engenharia reversa (2026-08-05):
//    Campos: name, contactId, pipelineStepId, userId, responsibleId,
//            value, description
//    - pipelineStepId JÁ define o funil (não precisa pipelineId).
//    - A API externa NÃO tem DELETE; PUT edita (exige contactId+userId+step).
//    - Etapas: GET .../pipeline-steps (instável). REUNIÃO MARCADA = id 5.
//
//  Env (.env) — ver .env.example:
//    PIPELINE_ENABLED        = "true"/"false" (padrão: auto — liga se tiver o essencial)
//    PIPELINE_STEP_ID        = id da etapa (padrão 5 = REUNIÃO MARCADA)
//    PIPELINE_STEP_NOME      = nome da etapa (só p/ log/diag)
//    PIPELINE_USER_ID        = userId que "cria" a oportunidade (OBRIGATÓRIO)
//    PIPELINE_RESPONSIBLE_ID = userId do responsável (Roni) — padrão = PIPELINE_USER_ID
//    PIPELINE_OPP_NOME       = nome da oportunidade (padrão "REUNIÃO MARCADA")
//    PIPELINE_VALOR          = valor padrão da oportunidade (padrão 1)
// =============================================================

const CC_PUSH_URL     = process.env.CC_PUSH_URL || '';
const STEP_ID         = parseInt(process.env.PIPELINE_STEP_ID || '5', 10);
const STEP_NOME       = process.env.PIPELINE_STEP_NOME || 'REUNIÃO MARCADA';
const USER_ID         = parseInt(process.env.PIPELINE_USER_ID || '', 10);
const RESPONSIBLE_ID  = parseInt(process.env.PIPELINE_RESPONSIBLE_ID || process.env.PIPELINE_USER_ID || '', 10);
const OPP_NOME        = process.env.PIPELINE_OPP_NOME || 'REUNIÃO MARCADA';
const VALOR           = parseFloat(String(process.env.PIPELINE_VALOR || '1').replace(',', '.'));
const ENABLED_ENV     = process.env.PIPELINE_ENABLED; // "true" | "false" | undefined (auto)

// Deriva { base, token } da CC_PUSH_URL.
// CC_PUSH_URL = https://host/v1/api/external/{uuid}/?token=JWT
//   base  → https://host/v1/api/external/{uuid}   (sem barra final)
//   token → JWT
function derivar() {
    if (!CC_PUSH_URL) return null;
    const idx = CC_PUSH_URL.indexOf('?');
    const urlPart = idx === -1 ? CC_PUSH_URL : CC_PUSH_URL.slice(0, idx);
    const query   = idx === -1 ? ''          : CC_PUSH_URL.slice(idx + 1);
    const m = /(?:^|&)token=([^&]+)/.exec(query);
    const token = m ? m[1] : '';
    const base = urlPart.replace(/\/+$/, ''); // remove barras finais → .../external/{uuid}
    if (!base || !token) return null;
    return { base, token };
}

// Está pronto para criar oportunidades?
function configurado() {
    if (ENABLED_ENV === 'false') return false;
    const d = derivar();
    return !!(d && Number.isFinite(USER_ID) && Number.isFinite(RESPONSIBLE_ID) && Number.isFinite(STEP_ID));
}

// =============================================================
//  CODIGO MORTO — o que sobrou aqui SO alimenta o /diag
//
//  A funcao que criava a oportunidade no CRM (criarOportunidade) foi
//  REMOVIDA: nao era chamada de lugar nenhum. Os vendedores nao usam o funil
//  de Oportunidades — o fechamento deste projeto e transferir o ticket para
//  o departamento da loja, nao criar card num pipeline.
//
//  O que ficou (derivar, configurado, diag) existe apenas para o /diag
//  continuar reportando a configuracao de um recurso que nao roda mais.
//  Remover isso muda a resposta do /diag — e mudanca de comportamento num
//  endpoint administrativo, entao depende de decisao, nao de refatoracao.
// =============================================================

// Diagnóstico da config (sem expor token) — usado pelo /diag.
function diag() {
    const d = derivar();
    return {
        configurado:      configurado(),
        pushUrlOk:        !!d,
        stepId:           STEP_ID,
        stepNome:         STEP_NOME,
        userIdSet:        Number.isFinite(USER_ID),
        responsibleIdSet: Number.isFinite(RESPONSIBLE_ID),
        oppNome:          OPP_NOME,
        valor:            VALOR,
        enabled:          ENABLED_ENV || '(auto)'
    };
}

module.exports = { configurado, diag };
