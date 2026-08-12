// =============================================================
//  FAKES DAS PORTAS (SPEC 0004, reescrito na SPEC 0018)
//
//  Adapters falsos, conformes aos contratos de src/application/portas.
//
//  Historia da injecao de dependencias nos testes:
//    SPEC 0001  manipulava o require.cache do Node — a unica forma possivel
//               sem portas, e a prova viva do acoplamento (D-02).
//    SPEC 0004  passou a injetar por `usarDependencias`, uma costura no
//               index.js.
//    SPEC 0018  a costura morreu: o teste monta o sistema chamando
//               `montar(config, fakes)`, exatamente como o bootstrap faz.
//
//  Fakes, nao mocks de verificacao: as assercoes olham o RESULTADO (mensagem
//  enviada, estado salvo), nao "esta funcao foi chamada".
// =============================================================

const { createRequire } = require('module');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const requireDaRaiz = createRequire(path.join(raiz, 'index.js'));

const EXTRACAO_VAZIA = {
    nome: null,
    finalidade: null,
    transporteAtual: null,
    gastoMensal: null,
    situacaoMoto: null,
    modeloInteresse: null,
    formaPagamento: null,
    loja: null,
    cpf: null,
    dataNascimento: null,
    nomeCompleto: null,
    telefone: null,
    cnh: null,
    corModelo: null,
    querFalarComHumano: false,
    perguntou: false,
    tipoContato: 'lead',
    objecao: null,
    correcao: []
};

// -------------------------------------------------------------
//  Inteligencia: extrator, redator, leitor de imagem e transcritor.
//  Compartilham um estado unico porque, do ponto de vista do teste, sao
//  "o que a IA respondeu".
// -------------------------------------------------------------
function criarIaFake() {
    const { SYSTEM_SDR, promptExtracao, promptResposta } = requireDaRaiz('./src/infrastructure/openai/prompts');

    const estado = {
        chamadas: [],
        filaExtracao: [],
        filaResposta: [],
        descricaoImagem: 'O cliente enviou a foto de uma moto vermelha.',
        transcricao: 'texto transcrito do audio',
        erroNaResposta: null,
        erroNaExtracao: null,
        falharTranscricao: false
    };

    estado.extrator = {
        async extrair(mensagem, campoAtual, historico = []) {
            const mensagemSanitizada = String(mensagem).replace(/[<>]/g, '').substring(0, 1000);
            const prompt = promptExtracao({ mensagemSanitizada, campoAtual });
            estado.chamadas.push({ tipo: 'extracao', prompt, historico });
            if (estado.erroNaExtracao) {
                console.error('Erro ao extrair informações:', estado.erroNaExtracao);
                return null;
            }
            return { ...EXTRACAO_VAZIA, ...(estado.filaExtracao.shift() || {}) };
        }
    };

    estado.redator = {
        async redigir({ leadData, mensagemCliente, proximoCampo, historico = [], expediente = null }) {
            const mensagemSanitizada = String(mensagemCliente).replace(/[<>]/g, '').substring(0, 1000);
            const isInicioConversa = leadData.conversationHistory.length === 0;
            const prompt = promptResposta({ isInicioConversa, mensagemSanitizada, proximoCampo, leadData, expediente });
            estado.chamadas.push({ tipo: 'resposta', prompt, system: SYSTEM_SDR, historico });
            if (estado.erroNaResposta) throw new Error(estado.erroNaResposta);
            return estado.filaResposta.shift() || 'Entendi! Como você se locomove hoje?';
        },

        async redigirAposTransbordo({ mensagemCliente, historico = [] }) {
            estado.chamadas.push({
                tipo: 'resposta',
                prompt: String(mensagemCliente),
                system: 'Você é um consultor do time da Avelloz Campina. Escrita natural, curta, registro de WhatsApp.',
                historico
            });
            return estado.filaResposta.shift() || 'O consultor continua com você. Ficou alguma dúvida?';
        }
    };

    estado.leitorDeImagem = {
        async descrever(url) {
            if (!url) return null;
            estado.chamadas.push({ tipo: 'visao', url });
            return estado.descricaoImagem;
        }
    };

    estado.transcritor = {
        async transcrever({ buffer, nome, mimetype }) {
            estado.chamadas.push({ tipo: 'transcricao', nome, mimetype, bytes: buffer?.length ?? 0 });
            if (estado.falharTranscricao) throw new Error('whisper indisponivel');
            return estado.transcricao;
        }
    };

    estado.promptsDeResposta = () => estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.prompt);
    estado.ultimoPromptDeResposta = () => estado.promptsDeResposta().at(-1);
    estado.systemsDeResposta = () => estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.system);

    return estado;
}

// -------------------------------------------------------------
//  Canal e notificador (o adapter real e o mesmo objeto: ChatClean)
// -------------------------------------------------------------
function criarCanalFake({ numeroDaEquipe = '' } = {}) {
    const estado = { enviadas: [], notas: [], falharPush: false };

    const registrar = (lista, number, body) => {
        if (estado.falharPush) return false;
        lista.push({ number, body });
        return true;
    };

    estado.canal = {
        async enviarTexto(chatId, texto) {
            if (!texto || !String(texto).trim()) return false;
            return registrar(estado.enviadas, chatId, texto);
        },
        async enviarNotaInterna(chatId, texto) {
            return registrar(estado.notas, chatId, texto);
        },
        async publicarNoTicket(chatId, resumo) {
            registrar(estado.notas, chatId, resumo);
        },
        async enviarParaEquipe(resumo) {
            if (!numeroDaEquipe) return;
            registrar(estado.enviadas, numeroDaEquipe, resumo);
        },
        temNumeroDaEquipe: () => !!numeroDaEquipe
    };

    estado.textosEnviadosPara = (numero) => estado.enviadas.filter((m) => m.number === numero).map((m) => m.body);
    estado.tudoEnviado = () => estado.enviadas.map((m) => m.body).join('\n');

    return estado;
}

// -------------------------------------------------------------
//  Repositorio em memoria, com controle do lock para teste
// -------------------------------------------------------------
function criarRepositorioFake() {
    const leads = new Map();
    const finalizados = [];
    const locks = new Set();
    const estado = { leads, finalizados, locks, travarProximoLock: false };

    estado.repositorio = {
        ehDuravel: () => false,
        async buscar(chatId) {
            const l = leads.get(chatId);
            return l ? JSON.parse(JSON.stringify(l)) : null;
        },
        async salvar(chatId, dados) {
            leads.set(chatId, JSON.parse(JSON.stringify(dados)));
        },
        async remover(chatId) {
            leads.delete(chatId);
        },
        async listarIds() {
            return [...leads.keys()];
        },
        async registrarLeadFinalizado(registro) {
            finalizados.push(registro);
        },
        async adquirirLock(chatId) {
            if (estado.travarProximoLock) {
                estado.travarProximoLock = false;
                return false;
            }
            locks.add(chatId);
            return true;
        },
        async liberarLock(chatId) {
            locks.delete(chatId);
        }
    };

    return estado;
}

function criarMidiaFake() {
    const estado = { falharDownload: false, baixados: [] };
    estado.baixador = {
        async baixar(url) {
            estado.baixados.push(url);
            if (estado.falharDownload) throw new Error('midia indisponivel');
            return Buffer.from('midia-falsa');
        }
    };
    return estado;
}

// -------------------------------------------------------------
//  Montagem: a MESMA funcao que o bootstrap usa, com fakes no lugar dos
//  adapters reais. Sem require.cache, sem costura.
// -------------------------------------------------------------
function montarSistema({ env = {} } = {}) {
    const { validar } = requireDaRaiz('./src/main/config');
    const { montar } = requireDaRaiz('./index.js');

    const ambiente = {
        OPENAI_API_KEY: 'sk-teste',
        CC_PUSH_URL: 'https://fake.chatclean/v1/api/external/uuid/?token=JWT',
        EQUIPE_NUMERO: '',
        ADMIN_KEY: 'chave-de-teste',
        WEBHOOK_SECRET: '',
        IA_ALLOWED_CONTACTS: '',
        REDIS_URL: '',
        AGRUPAR_MENSAGENS_MS: '0',
        RATE_LIMIT_MSGS: '20',
        RATE_LIMIT_JANELA_S: '60',
        LOOP_MAX_TURNOS: '15',
        LOOP_JANELA_MIN: '3',
        RESET_INATIVIDADE_HORAS: '24',
        ...env
    };

    const resultado = validar(ambiente);
    if (!resultado.ok) throw new Error('configuração de teste inválida:\n' + resultado.mensagem);
    const config = resultado.config;

    const ia = criarIaFake();
    const canal = criarCanalFake({ numeroDaEquipe: config.EQUIPE_NUMERO });
    const repositorio = criarRepositorioFake();
    const midia = criarMidiaFake();

    const deps = {
        canal: canal.canal,
        notificador: canal.canal,
        repositorio: repositorio.repositorio,
        extrator: ia.extrator,
        redator: ia.redator,
        transcritor: ia.transcritor,
        leitorDeImagem: ia.leitorDeImagem,
        baixadorDeMidia: midia.baixador,
        relogio: { agora: () => Date.now(), data: () => new Date() },
        expediente: { consultar: (data) => requireDaRaiz('./src/domain/expediente/Expediente').estaEmExpediente(data) }
    };

    const sistema = montar(config, deps);

    return {
        // Interface que os testes usam. `sistema` expõe o atendimento e o
        // handler HTTP montados exatamente como em produção.
        sistema: {
            processarMensagem: (m) => sistema.atendimento.processarMensagem(m),
            varrerFollowUps: () => sistema.atendimento.varrerFollowUps(),
            handleWebhook: (req, res) => sistema.handleWebhook(req, res),
            app: sistema.app
        },
        config,
        ia,
        canal,
        repositorio,
        midia,
        desmontar() {
            // Nada a desfazer: o sistema e montado por chamada de funcao, sem
            // estado global nem cache de modulo.
        }
    };
}

module.exports = { montarSistema, criarIaFake, criarCanalFake, criarRepositorioFake, criarMidiaFake };
