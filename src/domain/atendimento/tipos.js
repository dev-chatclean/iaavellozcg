// =============================================================
//  TIPOS DO ATENDIMENTO (SPEC 0017)
//
//  O formato do estado do atendimento — o antigo `leadData` — nunca existiu
//  em lugar nenhum a nao ser na cabeca de quem escreveu e, depois da Fase 0,
//  na prosa de docs/07-estado-e-persistencia.md. Aqui ele vira um contrato
//  VERIFICADO: `npm run typecheck` acusa campo inventado ou nome errado.
//
//  Este arquivo nao tem codigo — so declaracoes. E o primeiro passo da
//  migracao gradual para tipos (D-14), sem trocar de linguagem.
// =============================================================

/**
 * Estado de um atendimento. Nasce vazio (so `conversationHistory`) e vai
 * sendo preenchido a cada turno.
 *
 * @typedef {object} EstadoDoAtendimento
 *
 * Identidade
 * @property {string} [nome]            Primeiro nome, do contato ou extraido.
 * @property {number} [contactId]       Id do contato no CRM.
 *
 * Funil de qualificacao (RN-002)
 * @property {string} [finalidade]
 * @property {string} [transporteAtual]
 * @property {string} [gastoMensal]
 * @property {string} [situacaoMoto]
 * @property {string} [modeloInteresse] AZ1 | AZ125 | AZX160
 * @property {string} [formaPagamento]  cartao | financiamento | consorcio | avista
 * @property {string} [loja]            Matriz | Malvinas | Monteiro
 *
 * Dados de simulacao, coletados em bloco (RN-004)
 * @property {string} [nomeCompleto]
 * @property {string} [cpf]
 * @property {string} [dataNascimento]
 * @property {string} [telefone]
 * @property {string} [cnh]
 * @property {string} [corModelo]
 *
 * Classificacao
 * @property {string|null} [perfilKey]  Um dos 8 perfis (RN-005).
 * @property {string} [tipoContato]     lead | cliente | outros
 *
 * Sinais transitorios — valem so para a resposta do turno
 * @property {string|null} [objecaoAtiva]
 * @property {boolean|null} [perguntouAgora]
 * @property {string|null} [analiseImagem]
 *
 * Controle de fluxo
 * @property {boolean} [qualificacaoCompleta]
 * @property {boolean} [finalizado]
 * @property {Array<{role: string, content: string}>} [conversationHistory]
 *
 * Temporal
 * @property {number} [ultimaInteracao]  epoch ms
 * @property {number|null} [followUpDueAt]
 * @property {string} [followUpUltimo]
 *
 * Blindagem anti-loop (RN-054)
 * @property {number[]} [turnosTs]
 * @property {string[]} [ultimasMsgs]
 * @property {boolean} [loopAvisado]
 */

/**
 * Opcoes do resumo entregue no transbordo.
 * @typedef {object} OpcoesDoResumo
 * @property {string} [departamento]
 * @property {string} [tagExtra]
 * @property {string|null} [proximoExpediente]
 */

module.exports = {};
