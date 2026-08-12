// =============================================================
//  PROMPTS — versionados (SPEC 0011)
//
//  Prompt e codigo: muda comportamento, precisa de revisao, versao e teste.
//  Antes viviam em `prompts.js` na raiz, editaveis sem rastro. Agora cada
//  versao e um arquivo, e este indice diz qual esta em uso.
//
//  COMO MUDAR UM PROMPT
//  1. Copie o arquivo da versao atual para a proxima (v2.js).
//  2. Edite a copia e registre a mudanca no CHANGELOG abaixo.
//  3. Rode `npm run eval` ANTES e DEPOIS e compare as metricas.
//  4. Troque VERSAO_EM_USO aqui, num commit separado — assim o rollback e
//     uma linha.
//
//  As metricas que nao podem piorar estao em src/eval/analisadores.js:
//  vazamento de produto antes do diagnostico (RN-001, alvo 0%), revelar ser
//  IA (RN-020, alvo 0%), informar parcela (RN-010, alvo 0%) e terminar com
//  pergunta (RN-021).
//
//  CHANGELOG
//  ---------
//  v1  Prompt-mestre herdado do projeto original, com duas correcoes ja
//      aplicadas: o bloqueio de diagnostico passou a consultar
//      PoliticaDeDiagnostico (spec 0006) e o modo plantao passou a chegar ao
//      turno (spec 0009, defeito D-28).
// =============================================================

const VERSAO_EM_USO = 'v1';

const versoes = {
    v1: require('./v1')
};

const emUso = versoes[VERSAO_EM_USO];

module.exports = {
    VERSAO_EM_USO,
    versoes,
    SYSTEM_SDR: emUso.SYSTEM_SDR,
    promptExtracao: emUso.promptExtracao,
    promptResposta: emUso.promptResposta
};
