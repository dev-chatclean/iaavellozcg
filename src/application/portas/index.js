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
 * O que a extracao devolve sobre a mensagem do cliente. Todos os campos sao
 * opcionais: o modelo preenche o que conseguiu identificar.
 *
 * @typedef {object} Extracao
 * @property {string|null} [nome]
 * @property {string|null} [finalidade]
 * @property {string|null} [transporteAtual]
 * @property {string|null} [gastoMensal]
 * @property {string|null} [situacaoMoto]
 * @property {string|null} [modeloInteresse]
 * @property {string|null} [formaPagamento]
 * @property {string|null} [loja]
 * @property {string|null} [nomeCompleto]
 * @property {string|null} [cpf]
 * @property {string|null} [dataNascimento]
 * @property {string|null} [telefone]
 * @property {string|null} [cnh]
 * @property {string|null} [corModelo]
 * @property {boolean} [querFalarComHumano]
 * @property {boolean} [perguntou]
 * @property {string|null} [tipoContato]  lead | cliente | outros
 * @property {string|null} [objecao]      uma das nove objecoes mapeadas
 * @property {string[]} [correcao]        campos que o cliente esta corrigindo
 */

/**
 * Converte a mensagem do cliente em campos estruturados.
 * @typedef {object} ExtratorDeInformacoes
 * @property {(mensagem: string, campoAtual: string|null, historico: Array) => Promise<Extracao|null>} extrair
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

/**
 * O conjunto completo de dependencias que a aplicacao recebe do composition
 * root. Usado como tipo em toda parte: `@param {import('../portas').Dependencias} deps`.
 *
 * @typedef {object} Dependencias
 * @property {CanalDeMensagem} canal
 * @property {NotificadorDeEquipe} notificador
 * @property {RepositorioDeAtendimento} repositorio
 * @property {ExtratorDeInformacoes} extrator
 * @property {RedatorDeResposta} redator
 * @property {TranscritorDeAudio} transcritor
 * @property {LeitorDeImagem} leitorDeImagem
 * @property {BaixadorDeMidia} baixadorDeMidia
 * @property {Relogio} relogio
 * @property {RelogioDeExpediente} expediente
 */

/**
 * Uma mensagem pronta para o turno. Os campos sao os de MensagemRecebida.
 * @typedef {object} TurnoDoCliente
 * @property {string} chatId
 * @property {number|null} [contactId]
 * @property {string} [texto]
 * @property {string} [tipo]
 * @property {string|null} [mediaBase64]
 * @property {string|null} [mediaUrl]
 * @property {string|null} [mediaMimetype]
 * @property {string|null} [quotedText]
 * @property {string} [nomeContato]
 * @property {string|null} [msgId]
 */

module.exports = {};
