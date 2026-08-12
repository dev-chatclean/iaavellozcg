// =============================================================
//  FAKES DAS PORTAS (SPEC 0004)
//
//  Adapters falsos, conformes aos contratos de src/application/portas.
//  São injetados pelo próprio sistema (`usarDependencias`), sem manipular o
//  require.cache do Node — que era como a SPEC 0001 fazia, na falta de
//  portas. Aquele truque foi a evidência do acoplamento descrito em D-02;
//  agora ele não é mais necessário.
//
//  Fakes, não mocks de verificação: as asserções olham o RESULTADO
//  (mensagem enviada, estado salvo), não "esta função foi chamada".
// =============================================================

const { createRequire } = require('module');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const requireDaRaiz = createRequire(path.join(raiz, 'index.js'));

// -------------------------------------------------------------
//  Inteligência: extrator, redator, leitor de imagem e transcritor.
//  Compartilham um estado único porque, do ponto de vista do teste, são
//  "o que a IA respondeu".
// -------------------------------------------------------------
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

function criarIaFake() {
    const { SYSTEM_SDR, promptExtracao, promptResposta } = requireDaRaiz('./prompts');

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
            // O adapter real engole a falha e devolve null; o fake faz igual.
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

    // Auxiliares de leitura usados nas asserções.
    estado.promptsDeResposta = () => estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.prompt);
    estado.ultimoPromptDeResposta = () => estado.promptsDeResposta().at(-1);
    estado.systemsDeResposta = () => estado.chamadas.filter((c) => c.tipo === 'resposta').map((c) => c.system);

    return estado;
}

// -------------------------------------------------------------
//  Canal e notificador (o adapter real é o mesmo objeto: ChatClean)
// -------------------------------------------------------------
function criarCanalFake({ numeroDaEquipe = '' } = {}) {
    const estado = {
        enviadas: [], // mensagens ao cliente
        notas: [], // notas internas no ticket
        falharPush: false
    };

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
//  Repositório em memória, com controle do lock para teste
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

// -------------------------------------------------------------
//  Baixador de mídia
// -------------------------------------------------------------
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
//  Montagem
// -------------------------------------------------------------
function montarSistema({ env = {} } = {}) {
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
        ...env
    };
    for (const [k, v] of Object.entries(padroes)) {
        envAnterior[k] = process.env[k];
        process.env[k] = v;
    }

    // Recarrega o index para que ele releia a configuração deste cenário.
    delete requireDaRaiz.cache[requireDaRaiz.resolve('./index.js')];
    const sistema = requireDaRaiz('./index.js');

    const ia = criarIaFake();
    const canal = criarCanalFake({ numeroDaEquipe: padroes.EQUIPE_NUMERO });
    const repositorio = criarRepositorioFake();
    const midia = criarMidiaFake();

    sistema.usarDependencias({
        canal: canal.canal,
        notificador: canal.canal,
        repositorio: repositorio.repositorio,
        extrator: ia.extrator,
        redator: ia.redator,
        transcritor: ia.transcritor,
        leitorDeImagem: ia.leitorDeImagem,
        baixadorDeMidia: midia.baixador,
        relogio: { agora: () => Date.now(), data: () => new Date() },
        expediente: { consultar: (data) => requireDaRaiz('./horario').estaEmExpediente(data) }
    });

    return {
        sistema,
        ia,
        canal,
        repositorio,
        midia,
        desmontar() {
            delete requireDaRaiz.cache[requireDaRaiz.resolve('./index.js')];
            for (const [k, v] of Object.entries(envAnterior)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    };
}

module.exports = { montarSistema, criarIaFake, criarCanalFake, criarRepositorioFake, criarMidiaFake };
