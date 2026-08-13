// =============================================================
//  CONFIGURAÇÃO — fonte única, validada UMA VEZ, antes de abrir a porta.
//
//  Antes da SPEC 0002 as 21 variáveis eram lidas por process.env espalhado em
//  quatro arquivos, sem validação: o processo subia com configuração inválida e
//  quebrava em runtime, atendendo cliente (D-23). O único caso tratado
//  (OPENAI_API_KEY) era verificado DEPOIS do app.listen — a porta já estava
//  aberta quando o processo morria.
//
//  carregar() lê process.env a cada chamada de propósito: os testes recarregam
//  o módulo com configurações diferentes. Quem consome usa o objeto congelado
//  exportado como `config`.
// =============================================================

const { z } = require('zod');

/**
 * A configuracao validada. Tipar isto vale por dois motivos: o editor
 * autocompleta os nomes, e um erro de digitacao em `config.RATE_LIMIT_MGS`
 * vira erro de verificacao em vez de `undefined` silencioso em producao.
 *
 * @typedef {object} Configuracao
 * @property {string} NODE_ENV
 * @property {string} OPENAI_API_KEY
 * @property {string} CC_PUSH_URL
 * @property {string} WEBHOOK_SECRET
 * @property {string} ADMIN_KEY
 * @property {string} EQUIPE_NUMERO
 * @property {string} REDIS_URL
 * @property {string} REDIS_PREFIX
 * @property {string} FERIADOS
 * @property {string[]} IA_ALLOWED_CONTACTS
 * @property {number} PORT
 * @property {number} RATE_LIMIT_MSGS
 * @property {number} RATE_LIMIT_JANELA_S
 * @property {number} LOOP_MAX_TURNOS
 * @property {number} LOOP_JANELA_MIN
 * @property {number} AGRUPAR_MENSAGENS_MS
 * @property {number} RESET_INATIVIDADE_HORAS
 * @property {boolean} IGNORAR_GRUPOS
 * @property {boolean} IA_SO_PENDENTES
 * @property {boolean} LOG_PAYLOAD
 * @property {boolean} ehProducao
 * @property {number} RATE_LIMIT_JANELA_MS
 * @property {number} LOOP_JANELA_MS
 * @property {number} RESET_INATIVIDADE_MS
 */

// --- Auxiliares de coerção -----------------------------------------------
// As variáveis chegam como string (ou ausentes). Cada helper documenta o
// padrão aplicado quando a variável está vazia.

const texto = (padrao = '') =>
    z
        .string()
        .optional()
        .transform((v) => (v === undefined ? padrao : v.trim()));

const inteiro = (padrao, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
    z
        .string()
        .optional()
        .transform((v) => (v === undefined || v.trim() === '' ? String(padrao) : v.trim()))
        .refine((v) => /^-?\d+$/.test(v), { message: 'precisa ser um número inteiro' })
        .transform((v) => parseInt(v, 10))
        .refine((n) => n >= min && n <= max, { message: `precisa estar entre ${min} e ${max}` });

// O legado trata qualquer valor diferente de "false" como true (IGNORAR_GRUPOS,
// IA_SO_PENDENTES). Preservamos isso para não mudar comportamento.
const booleanoPadraoLigado = () =>
    z
        .string()
        .optional()
        .transform((v) => (v === undefined ? 'true' : v.trim()))
        .transform((v) => v !== 'false');

const listaSeparadaPorVirgula = () =>
    z
        .string()
        .optional()
        .transform((v) =>
            (v || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
        );

// --- Esquema --------------------------------------------------------------

function montarEsquema(ambiente) {
    const producao = ambiente === 'production';

    return z.object({
        NODE_ENV: texto('development'),

        // Obrigatória sempre: sem ela nenhuma resposta é gerada.
        OPENAI_API_KEY: z
            .string({ message: 'é obrigatória (chave da OpenAI com crédito)' })
            .trim()
            .min(1, 'é obrigatória (chave da OpenAI com crédito)'),

        // Sem push a IA recebe mensagens e não consegue responder. Em produção
        // isso é erro; em desenvolvimento é aviso (o tester local não usa push).
        CC_PUSH_URL: producao
            ? z
                  .string({ message: 'é obrigatória em produção (URL de Push do ChatClean)' })
                  .trim()
                  .url('precisa ser uma URL válida')
            : texto(''),

        // S4 — fail-closed: em produção o webhook não pode ficar aberto.
        WEBHOOK_SECRET: producao
            ? z
                  .string({ message: 'é obrigatório em produção (sem ele /webhook fica ABERTO)' })
                  .trim()
                  .min(16, 'é obrigatório em produção e precisa ter pelo menos 16 caracteres (sem ele /webhook fica ABERTO)')
            : texto(''),

        // Endpoints administrativos são fail-closed por natureza (503 sem chave),
        // então a ausência não impede o boot.
        ADMIN_KEY: texto(''),
        EQUIPE_NUMERO: texto(''),
        REDIS_URL: texto(''),
        REDIS_PREFIX: texto('avellozcg'),
        FERIADOS: texto(''),

        IA_ALLOWED_CONTACTS: listaSeparadaPorVirgula(),

        PORT: inteiro(3000, { min: 1, max: 65535 }),
        RATE_LIMIT_MSGS: inteiro(20, { min: 0, max: 10000 }),
        RATE_LIMIT_JANELA_S: inteiro(60, { min: 1, max: 86400 }),
        LOOP_MAX_TURNOS: inteiro(15, { min: 1, max: 1000 }),
        LOOP_JANELA_MIN: inteiro(3, { min: 1, max: 1440 }),
        AGRUPAR_MENSAGENS_MS: inteiro(2000, { min: 0, max: 60000 }),
        RESET_INATIVIDADE_HORAS: inteiro(24, { min: 1, max: 8760 }),

        IGNORAR_GRUPOS: booleanoPadraoLigado(),
        IA_SO_PENDENTES: booleanoPadraoLigado(),

        // S1 — o payload bruto contém PII (nome, telefone, CPF, nascimento, CNH).
        // Fica DESLIGADO por padrão; ligar é decisão explícita de depuração.
        LOG_PAYLOAD: z
            .string()
            .optional()
            .transform((v) => (v || '').trim() === 'true')
    });
}

// Mensagem de erro que lista TODOS os problemas de uma vez — quem está fazendo
// deploy precisa corrigir tudo numa passada, não descobrir um por vez.
function formatarErros(erro, env) {
    const linhas = erro.issues.map((i) => {
        const variavel = i.path.join('.') || '(configuração)';
        const recebido = env[variavel];
        const valor = recebido === undefined ? '(não definida)' : `"${recebido}"`;
        return `  - ${variavel}: ${i.message} — recebido ${valor}`;
    });
    return ['Configuração inválida — o servidor não vai subir:', ...linhas, '', 'Corrija o .env (ver .env.example) e suba de novo.'].join(
        '\n'
    );
}

/**
 * Lê e valida as variáveis de ambiente.
 * @returns {{ ok: true, config: Configuracao } | { ok: false, mensagem: string }}
 */
function validar(env = process.env) {
    const ambiente = (env.NODE_ENV || 'development').trim();
    const resultado = montarEsquema(ambiente).safeParse(env);
    if (!resultado.success) return { ok: false, mensagem: formatarErros(resultado.error, env) };

    const dados = resultado.data;
    return {
        ok: true,
        config: /** @type {Configuracao} */ (Object.freeze({
            ...dados,
            ehProducao: ambiente === 'production',
            // Derivados, para quem consome não repetir a conta.
            RATE_LIMIT_JANELA_MS: dados.RATE_LIMIT_JANELA_S * 1000,
            LOOP_JANELA_MS: dados.LOOP_JANELA_MIN * 60 * 1000,
            RESET_INATIVIDADE_MS: dados.RESET_INATIVIDADE_HORAS * 3600 * 1000
        }))
    };
}

/**
 * Valida e devolve a configuração. Encerra o processo se algo estiver errado —
 * ANTES de qualquer efeito colateral (porta aberta, timer agendado).
 */
function carregar(env = process.env) {
    const r = validar(env);
    if (r.ok === false) {
        console.error('');
        console.error(r.mensagem);
        console.error('');
        process.exit(1);
    }
    return r.config;
}

// Avisos do que é legal, mas merece atenção. Não impedem o boot.
function avisos(config) {
    const lista = [];
    if (!config.ADMIN_KEY) lista.push('ADMIN_KEY vazia — /leads e /diag ficarão BLOQUEADOS (503).');
    if (!config.EQUIPE_NUMERO) lista.push('EQUIPE_NUMERO vazio — o resumo do lead irá só como nota interna no ticket.');
    if (!config.REDIS_URL) lista.push('REDIS_URL vazia — o estado das conversas fica em memória e SE PERDE no restart.');
    if (!config.CC_PUSH_URL) lista.push('CC_PUSH_URL vazia — a IA não conseguirá responder.');
    if (!config.WEBHOOK_SECRET) lista.push('WEBHOOK_SECRET vazio — /webhook está ABERTO (aceito fora de produção).');
    if (config.LOG_PAYLOAD) lista.push('LOG_PAYLOAD=true — o payload bruto (com dados pessoais) está sendo registrado no log.');
    return lista;
}

module.exports = { carregar, validar, avisos };
