// =============================================================
//  PORTAS — os contratos que a aplicação define para falar com o mundo.
//
//  Em JavaScript não há interface de linguagem, então as portas vivem como
//  contratos DOCUMENTADOS (JSDoc) mais uma suíte de contrato compartilhada
//  entre o adapter real e o fake. Quem garante a conformidade é o teste, não
//  o compilador.
//
//  Regra: quem consome depende DESTES contratos, nunca de `openai`, `axios`
//  ou `ioredis`. O composition root (src/main/container.js) é o único lugar
//  que conhece os adapters concretos.
// =============================================================

/**
 * Fala com o cliente final.
 * @typedef {object} CanalDeMensagem
 * @property {(chatId: string, texto: string) => Promise<boolean>} enviarTexto
 * @property {(chatId: string, texto: string) => Promise<boolean>} enviarNotaInterna
 *   Nota visível apenas para a equipe no ticket do CRM.
 */

/**
 * Guarda e recupera o estado do atendimento.
 * @typedef {object} RepositorioDeAtendimento
 * @property {(chatId: string) => Promise<object|null>} buscar
 * @property {(chatId: string, dados: object) => Promise<void>} salvar
 * @property {(chatId: string) => Promise<void>} remover
 * @property {() => Promise<string[]>} listarIds
 * @property {(registro: object) => Promise<void>} registrarLeadFinalizado
 * @property {(chatId: string, ttlMs?: number) => Promise<boolean>} adquirirLock
 * @property {(chatId: string) => Promise<void>} liberarLock
 * @property {() => boolean} ehDuravel
 *   Informa se o estado sobrevive ao restart. Usado só por diagnóstico.
 */

/**
 * Converte a mensagem do cliente em campos estruturados.
 * @typedef {object} ExtratorDeInformacoes
 * @property {(mensagem: string, campoAtual: string|null, historico: Array) => Promise<object|null>} extrair
 *   Devolve null quando não foi possível extrair — o turno segue sem novos campos.
 */

/**
 * Escreve a resposta ao cliente, com a persona do SDR.
 * @typedef {object} RedatorDeResposta
 * @property {(contexto: object) => Promise<string>} redigir
 *   contexto: { leadData, mensagemCliente, proximoCampo, historico, expediente }
 * @property {(contexto: object) => Promise<string>} redigirAposTransbordo
 *   Prompt curto para quem já foi encaminhado ao consultor (UC-010).
 */

/**
 * Transcreve áudio e a trilha de vídeo.
 * @typedef {object} TranscritorDeAudio
 * @property {(arquivo: {buffer: Buffer, nome: string, mimetype: string}) => Promise<string>} transcrever
 *   Lança em caso de falha — o chamador decide o que dizer ao cliente.
 */

/**
 * Descreve uma imagem enviada pelo cliente.
 * @typedef {object} LeitorDeImagem
 * @property {(url: string) => Promise<string|null>} descrever
 *   Devolve null quando não foi possível ler — o turno segue sem a descrição.
 */

/**
 * Avisa a equipe sobre um lead qualificado.
 * @typedef {object} NotificadorDeEquipe
 * @property {(chatId: string, resumo: string) => Promise<void>} publicarNoTicket
 * @property {(resumo: string) => Promise<void>} enviarParaEquipe
 * @property {() => boolean} temNumeroDaEquipe
 */

/**
 * O tempo, injetado para que reativação e reset sejam testáveis sem esperar.
 * @typedef {object} Relogio
 * @property {() => number} agora        Epoch em milissegundos.
 * @property {() => Date} data
 */

/**
 * Consulta o expediente do time.
 * @typedef {object} RelogioDeExpediente
 * @property {(data?: Date) => {aberto: boolean, motivo: string|null, proximoExpediente: string|null}} consultar
 */

/**
 * Baixa mídia a partir de uma URL informada pelo canal.
 * @typedef {object} BaixadorDeMidia
 * @property {(url: string, timeoutMs?: number) => Promise<Buffer>} baixar
 */

module.exports = {};
