// =============================================================
//  FAKES DAS DEPENDENCIAS EXTERNAS (SPEC 0001, PR6)
//
//  O index.js instancia OpenAI, axios e o store no proprio modulo, entao a
//  unica forma de injetar substitutos SEM refatorar e pre-popular o
//  require.cache do Node antes de carrega-lo.
//
//  Isto e feio DE PROPOSITO: e a evidencia do acoplamento descrito em D-02.
//  A partir da Fase 2 (spec 0004) as dependencias entram por portas e este
//  arquivo e substituido por adapters fake de verdade.
// =============================================================

const { createRequire } = require('module');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const requireDaRaiz = createRequire(path.join(raiz, 'index.js'));

function instalarNoCache(especificador, exports) {
    const caminho = requireDaRaiz.resolve(especificador);
    requireDaRaiz.cache[caminho] = {
        id: caminho,
        filename: caminho,
        path: path.dirname(caminho),
        loaded: true,
        children: [],
        paths: [],
        exports
    };
}

function limparDoCache(especificador) {
    try {
        delete requireDaRaiz.cache[requireDaRaiz.resolve(especificador)];
    } catch {
        // modulo nunca carregado — nada a limpar
    }
}

// -------------------------------------------------------------
//  OpenAI
// -------------------------------------------------------------
// Distingue as tres chamadas pelo formato dos parametros:
//   - response_format json_object -> extracao (temp 0)
//   - conteudo com image_url      -> visao
//   - demais                      -> redacao da resposta
function criarOpenAIFake() {
    const estado = {
        chamadas: [],
        filaExtracao: [],
        filaResposta: [],
        descricaoImagem: 'O cliente enviou a foto de uma moto vermelha.',
        erroNaResposta: null,
        erroNaExtracao: null
    };

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

    class OpenAIFake {
        constructor(opcoes) {
            estado.construidoCom = opcoes;
            this.chat = {
                completions: {
                    create: async (params) => {
                        const ehVisao = JSON.stringify(params.messages).includes('image_url');
                        const ehExtracao = params.response_format?.type === 'json_object';
                        const tipo = ehVisao ? 'visao' : ehExtracao ? 'extracao' : 'resposta';
                        estado.chamadas.push({ tipo, params });

                        if (tipo === 'visao') {
                            return { choices: [{ message: { content: estado.descricaoImagem } }] };
                        }
                        if (tipo === 'extracao') {
                            if (estado.erroNaExtracao) throw new Error(estado.erroNaExtracao);
                            const proxima = estado.filaExtracao.shift() || {};
                            const conteudo = JSON.stringify({ ...EXTRACAO_VAZIA, ...proxima });
                            return { choices: [{ message: { content: conteudo } }] };
                        }
                        if (estado.erroNaResposta) throw new Error(estado.erroNaResposta);
                        const texto = estado.filaResposta.shift() || 'Entendi! Como você se locomove hoje?';
                        return { choices: [{ message: { content: texto } }] };
                    }
                }
            };
        }
    }

    estado.classe = OpenAIFake;

    // Auxiliares de leitura usados nas asserções.
    estado.promptsDeResposta = () =>
        estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.params.messages.at(-1).content);
    estado.ultimoPromptDeResposta = () => estado.promptsDeResposta().at(-1);
    estado.systemsDeResposta = () =>
        estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.params.messages[0].content);

    return estado;
}

// -------------------------------------------------------------
//  axios — Push do ChatClean, transcricao Whisper e download de midia
// -------------------------------------------------------------
function criarAxiosFake() {
    const estado = {
        enviadas: [], // mensagens ao cliente (body)
        notas: [], // notas internas (onlyNote)
        posts: [], // todos os POSTs, cru
        transcricao: 'texto transcrito do audio',
        falharTranscricao: false,
        falharDownload: false,
        falharPush: false
    };

    estado.modulo = {
        post: async (url, payload, config) => {
            estado.posts.push({ url, payload, config });

            if (String(url).includes('audio/transcriptions')) {
                if (estado.falharTranscricao) throw new Error('whisper indisponivel');
                return { data: { text: estado.transcricao } };
            }

            if (estado.falharPush) throw new Error('push indisponivel');
            if (payload?.onlyNote) estado.notas.push({ number: payload.number, body: payload.body });
            else estado.enviadas.push({ number: payload.number, body: payload.body });
            return { data: { ok: true } };
        },
        get: async (url) => {
            if (estado.falharDownload) throw new Error('midia indisponivel');
            return { data: Buffer.from('midia-falsa'), url };
        }
    };

    // Auxiliares de leitura.
    estado.textosEnviadosPara = (numero) =>
        estado.enviadas.filter((m) => m.number === numero).map((m) => m.body);
    estado.tudoEnviado = () => estado.enviadas.map((m) => m.body).join('\n');

    // Transferencia de ticket entre departamentos: a Push API a carrega no
    // MESMO post da nota interna, pelos campos forceTicketToDepartment/queueId.
    estado.transferencias = () =>
        estado.posts
            .filter((p) => p.payload?.forceTicketToDepartment)
            .map((p) => ({
                number: p.payload.number,
                queueId: p.payload.queueId,
                fechandoTicket: !!p.payload.forceTicketToClosed
            }));

    return estado;
}

// -------------------------------------------------------------
//  store — estado das conversas em memoria
// -------------------------------------------------------------
function criarStoreFake() {
    const leads = new Map();
    const finalizados = [];
    const locks = new Set();

    const estado = {
        leads,
        finalizados,
        locks,
        travarProximoLock: false
    };

    estado.modulo = {
        isRedis: () => false,
        getLead: async (chatId) => {
            const l = leads.get(chatId);
            return l ? JSON.parse(JSON.stringify(l)) : null;
        },
        saveLead: async (chatId, leadData) => {
            leads.set(chatId, JSON.parse(JSON.stringify(leadData)));
        },
        deleteLead: async (chatId) => {
            leads.delete(chatId);
        },
        scanLeadIds: async () => [...leads.keys()],
        appendLeadFinalizado: async (registro) => {
            finalizados.push(registro);
        },
        acquireLock: async (chatId) => {
            if (estado.travarProximoLock) {
                estado.travarProximoLock = false;
                return false;
            }
            locks.add(chatId);
            return true;
        },
        releaseLock: async (chatId) => {
            locks.delete(chatId);
        }
    };

    return estado;
}

// -------------------------------------------------------------
//  Montagem: instala os fakes e carrega o index.js sobre eles
// -------------------------------------------------------------
// Modulos do legado que leem process.env no carregamento. Precisam sair do
// cache a cada montagem para o teste conseguir variar a configuracao.
const MODULOS_QUE_LEEM_ENV = ['./data', './horario'];

// O composition root captura openai/axios no escopo do modulo. Sem limpa-lo,
// a segunda montagem reusaria os clientes REAIS da primeira, e os fakes nao
// teriam efeito nenhum.
const MODULOS_DE_MONTAGEM = ['./src/main/container', './src/main/config'];

function montarSistema({ env = {} } = {}) {
    const openai = criarOpenAIFake();
    const axios = criarAxiosFake();
    const store = criarStoreFake();

    const envAnterior = {};
    const padroes = {
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
        // Transferencia de departamento: fixada aqui para o teste nao depender
        // do .env da maquina. Os IDs vazios caem nos padroes do data.js
        // (Matriz 228, Malvinas 230, Monteiro 231).
        TRANSFERIR_DEPARTAMENTO: 'true',
        TRANSFERIR_FECHANDO: 'false',
        DEPT_ID_MATRIZ: '',
        DEPT_ID_MALVINAS: '',
        DEPT_ID_MONTEIRO: '',
        DEPT_ID_AGENTE_IA: '',
        DEPT_ID_POSVENDA: '',
        FERIADOS: '',
        ...env
    };
    for (const [k, v] of Object.entries(padroes)) {
        envAnterior[k] = process.env[k];
        process.env[k] = v;
    }

    instalarNoCache('openai', openai.classe);
    instalarNoCache('axios', axios.modulo);
    instalarNoCache('./store', store.modulo);
    // data.js e horario.js leem process.env no CARREGAMENTO do modulo (IDs de
    // departamento e feriados). Sem limpa-los, o override de env do teste nao
    // teria efeito: o primeiro require do processo venceria para sempre.
    for (const modulo of MODULOS_QUE_LEEM_ENV) limparDoCache(modulo);
    limparDoCache('./index.js');

    const sistema = requireDaRaiz('./index.js');

    return {
        sistema,
        openai,
        axios,
        store,
        desmontar() {
            limparDoCache('./index.js');
            limparDoCache('openai');
            limparDoCache('axios');
            limparDoCache('./store');
            for (const modulo of MODULOS_QUE_LEEM_ENV) limparDoCache(modulo);
            for (const modulo of MODULOS_DE_MONTAGEM) limparDoCache(modulo);
            for (const [k, v] of Object.entries(envAnterior)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    };
}

module.exports = { montarSistema, criarOpenAIFake, criarAxiosFake, criarStoreFake };
