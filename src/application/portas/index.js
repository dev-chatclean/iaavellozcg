// =============================================================
//  PORTAS
//
//  Os contratos que a aplicacao espera do mundo externo. Nao ha implementacao
//  aqui: sao typedefs. O adapter concreto vive em src/infrastructure e e
//  escolhido no composition root.
//
//  Existir por escrito importa: e o que permite trocar Redis por memoria, ou
//  OpenAI por um fake, sem que a regra de negocio perceba.
// =============================================================

/**
 * Resultado de um envio pelo canal. Nao e booleano de proposito: a
 * transferencia de departamento precisa saber O QUE o CRM respondeu para so
 * entao confirmar a transferencia ao cliente.
 *
 * @typedef {object} ResultadoDeEnvio
 * @property {boolean} ok
 * @property {number} [status]   codigo HTTP devolvido pelo CRM
 * @property {any}    [data]     corpo cru da resposta
 * @property {string} [erro]     mensagem, quando ok = false
 */

/**
 * Canal de saida para o cliente e para a equipe.
 *
 * @typedef {object} CanalDeSaida
 * @property {() => boolean} configurado
 *   false quando falta credencial: quem chama decide se avisa ou segue.
 * @property {(numero: string, payload: object) => Promise<ResultadoDeEnvio>} enviar
 *   Entrega o payload cru ao transporte. Quem monta o payload e o chamador.
 */

/**
 * Cliente HTTP minimo esperado pelos adapters. Existe para o adapter nao
 * depender do axios diretamente — o que tambem o torna testavel sem rede.
 *
 * @typedef {object} ClienteHttp
 * @property {(url: string, corpo: any, config?: object) => Promise<{status: number, data: any}>} post
 * @property {(url: string, config?: object) => Promise<{status: number, data: any}>} [get]
 */

/**
 * Estado das conversas. Duas implementacoes: Redis (duravel, compartilhado
 * entre instancias) e memoria (processo local, e fallback do Redis). O teste
 * de contrato roda a mesma bateria contra as duas.
 *
 * @typedef {object} RepositorioDeAtendimento
 * @property {() => boolean} isRedis
 * @property {(chatId: string) => Promise<object|null>} getLead
 * @property {(chatId: string, leadData: object) => Promise<void>} saveLead
 * @property {(chatId: string) => Promise<void>} deleteLead
 * @property {() => Promise<string[]>} scanLeadIds
 * @property {(registro: object) => Promise<void>} appendLeadFinalizado
 * @property {(chatId: string, ttlMs?: number) => Promise<boolean>} acquireLock
 *   Lock cross-instancia. Fail-OPEN: um Redis instavel nao pode impedir o
 *   cliente de ser atendido.
 * @property {(chatId: string) => Promise<void>} releaseLock
 */

module.exports = {};
