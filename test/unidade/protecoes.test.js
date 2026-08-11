import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// =============================================================
//  SPEC 0001 — T27 · Cobre RF-050 (autenticacao do webhook) e
//  RN-053 (rate-limit por numero).
//
//  index.js le as variaveis de ambiente no carregamento, entao cada bloco
//  recarrega o modulo com a configuracao que quer exercitar.
// =============================================================

function recarregarIndex() {
    delete require.cache[require.resolve('../../index')];
    return require('../../index');
}

const requisicao = ({ headers = {}, query = {}, params = {} } = {}) => ({ headers, query, params });

describe('webhookAutorizado: sem WEBHOOK_SECRET (fora de producao)', () => {
    let webhookAutorizado;

    beforeEach(() => {
        delete process.env.WEBHOOK_SECRET;
        ({ webhookAutorizado } = recarregarIndex());
    });

    // S4 ENDURECIDO pela spec 0002: fora de producao o webhook aberto continua
    // aceito (desenvolvimento simples, CA-005), mas em PRODUCAO o boot passou a
    // exigir o segredo — ver test/unidade/config.test.js, CA-004. O teste que
    // congelava o risco virou a documentacao do compromisso.
    it('CA-005: fora de producao, aceita requisicao sem token', () => {
        expect(webhookAutorizado(requisicao())).toBe(true);
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': 'qualquer-coisa' } }))).toBe(true);
    });

    it('em producao esta combinacao nem chega a rodar: o boot falha antes', () => {
        const { validar } = require('../../src/main/config');
        const r = validar({
            NODE_ENV: 'production',
            OPENAI_API_KEY: 'sk-teste',
            CC_PUSH_URL: 'https://x/y',
            WEBHOOK_SECRET: ''
        });
        expect(r.ok).toBe(false);
    });
});

describe('webhookAutorizado: com WEBHOOK_SECRET definido', () => {
    const SEGREDO = 'segredo-de-teste-123';
    let webhookAutorizado;
    let original;

    beforeEach(() => {
        original = process.env.WEBHOOK_SECRET;
        process.env.WEBHOOK_SECRET = SEGREDO;
        ({ webhookAutorizado } = recarregarIndex());
    });

    afterEach(() => {
        if (original === undefined) delete process.env.WEBHOOK_SECRET;
        else process.env.WEBHOOK_SECRET = original;
        recarregarIndex();
    });

    it('aceita o token no header x-webhook-token', () => {
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': SEGREDO } }))).toBe(true);
    });

    it('aceita o token no header Authorization com prefixo Bearer', () => {
        expect(webhookAutorizado(requisicao({ headers: { authorization: `Bearer ${SEGREDO}` } }))).toBe(true);
    });

    it('aceita o token na query string', () => {
        expect(webhookAutorizado(requisicao({ query: { token: SEGREDO } }))).toBe(true);
    });

    it('aceita o token no path (/webhook/<segredo>)', () => {
        expect(webhookAutorizado(requisicao({ params: { token: SEGREDO } }))).toBe(true);
    });

    it('rejeita token errado do mesmo tamanho', () => {
        const errado = 'x'.repeat(SEGREDO.length);
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': errado } }))).toBe(false);
    });

    it('rejeita token de tamanho diferente', () => {
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': 'curto' } }))).toBe(false);
    });

    it('rejeita requisicao sem token', () => {
        expect(webhookAutorizado(requisicao())).toBe(false);
    });

    it('a precedencia e header, depois query, depois path', () => {
        // Header errado vence a query certa: a comparacao usa o primeiro encontrado.
        expect(
            webhookAutorizado(requisicao({ headers: { 'x-webhook-token': 'errado-mesmo' }, query: { token: SEGREDO } }))
        ).toBe(false);
    });
});

// S5 CORRIGIDO pela spec 0002: a comparacao usava padEnd(128), truncando
// segredos longos. Dois segredos diferentes que compartilhassem os primeiros
// 128 caracteres eram considerados iguais.
describe('webhookAutorizado: segredo longo (CA-006, CA-007)', () => {
    const PREFIXO = 'a'.repeat(128);
    const SEGREDO = PREFIXO + 'FINAL-VERDADEIRO';
    let webhookAutorizado;
    let original;

    beforeEach(() => {
        original = process.env.WEBHOOK_SECRET;
        process.env.WEBHOOK_SECRET = SEGREDO;
        ({ webhookAutorizado } = recarregarIndex());
    });

    afterEach(() => {
        if (original === undefined) delete process.env.WEBHOOK_SECRET;
        else process.env.WEBHOOK_SECRET = original;
        recarregarIndex();
    });

    it('CA-006: token que compartilha os primeiros 128 caracteres e REJEITADO', () => {
        const impostor = PREFIXO + 'FINAL-FALSIFICADO';
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': impostor } }))).toBe(false);
    });

    it('o segredo longo correto continua sendo aceito', () => {
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': SEGREDO } }))).toBe(true);
    });

    it('CA-007: token vazio e rejeitado sem comparar comprimentos em texto claro', () => {
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': '' } }))).toBe(false);
        expect(webhookAutorizado(requisicao())).toBe(false);
    });

    it('apenas o prefixo (sem o final) e rejeitado', () => {
        expect(webhookAutorizado(requisicao({ headers: { 'x-webhook-token': PREFIXO } }))).toBe(false);
    });
});

describe('dentroDoLimite: rate-limit por numero (RN-053)', () => {
    let dentroDoLimite;

    beforeEach(() => {
        process.env.RATE_LIMIT_MSGS = '5';
        process.env.RATE_LIMIT_JANELA_S = '60';
        ({ dentroDoLimite } = recarregarIndex());
    });

    afterEach(() => {
        delete process.env.RATE_LIMIT_MSGS;
        delete process.env.RATE_LIMIT_JANELA_S;
        recarregarIndex();
    });

    it('permite ate o limite configurado', () => {
        const chat = '5583900000001';
        for (let i = 1; i <= 5; i++) expect(dentroDoLimite(chat), `mensagem ${i}`).toBe(true);
    });

    it('bloqueia a partir da mensagem seguinte ao limite', () => {
        const chat = '5583900000002';
        for (let i = 0; i < 5; i++) dentroDoLimite(chat);
        expect(dentroDoLimite(chat)).toBe(false);
        expect(dentroDoLimite(chat)).toBe(false);
    });

    it('conta por numero, sem interferencia entre contatos', () => {
        const a = '5583900000003';
        const b = '5583900000004';
        for (let i = 0; i < 5; i++) dentroDoLimite(a);
        expect(dentroDoLimite(a)).toBe(false);
        expect(dentroDoLimite(b)).toBe(true);
    });
});

describe('dentroDoLimite: desativado', () => {
    let dentroDoLimite;

    beforeEach(() => {
        process.env.RATE_LIMIT_MSGS = '0';
        ({ dentroDoLimite } = recarregarIndex());
    });

    afterEach(() => {
        delete process.env.RATE_LIMIT_MSGS;
        recarregarIndex();
    });

    it('RATE_LIMIT_MSGS=0 libera qualquer volume', () => {
        const chat = '5583900000005';
        for (let i = 0; i < 100; i++) expect(dentroDoLimite(chat)).toBe(true);
    });
});

describe('montarMsgReativacao: follow-up contextual (RN-070)', () => {
    let montarMsgReativacao;

    beforeEach(() => {
        ({ montarMsgReativacao } = recarregarIndex());
    });

    it.each([
        ['finalidade', {}, /pra que você quer a moto/i],
        ['transporteAtual', { finalidade: 'trabalho' }, /como você tá se locomovendo hoje/i],
        [
            'gastoMensal',
            { finalidade: 'trabalho', transporteAtual: 'uber' },
            /quanto você gasta por mês com transporte/i
        ],
        [
            'modeloInteresse',
            { finalidade: 'trabalho', transporteAtual: 'uber', gastoMensal: '300', situacaoMoto: 'nao_tem' },
            /modelo que mais encaixa/i
        ],
        [
            'loja',
            {
                finalidade: 'trabalho',
                transporteAtual: 'uber',
                gastoMensal: '300',
                situacaoMoto: 'nao_tem',
                modeloInteresse: 'AZ125',
                formaPagamento: 'financiamento'
            },
            /Matriz, Malvinas ou Monteiro/i
        ]
    ])('quando falta "%s", a mensagem e especifica daquela etapa', (_campo, lead, esperado) => {
        expect(montarMsgReativacao({ ...lead })).toMatch(esperado);
    });

    it('usa o primeiro nome do lead quando ele existe', () => {
        expect(montarMsgReativacao({ nome: 'Rafael Silva' })).toMatch(/^Oi Rafael/);
    });

    it('sem nome, cumprimenta genericamente', () => {
        expect(montarMsgReativacao({})).toMatch(/^Oi!/);
    });

    it('mensagem generica para a etapa de situacao de moto (sem texto proprio)', () => {
        const lead = { finalidade: 'trabalho', transporteAtual: 'uber', gastoMensal: '300' };
        expect(montarMsgReativacao(lead)).toMatch(/seguimos de onde paramos/i);
    });

    // CONGELA BUG D-06 — montar a mensagem de reativacao consulta
    // determinarProximoCampo, que MUTA o lead. Num funil completo, so montar
    // o follow-up marca o lead como qualificado.
    it('CONGELA BUG D-06: montar reativacao de funil completo marca qualificacaoCompleta', () => {
        const lead = {
            finalidade: 'trabalho',
            transporteAtual: 'uber',
            gastoMensal: '300',
            situacaoMoto: 'nao_tem',
            modeloInteresse: 'AZ125',
            formaPagamento: 'financiamento',
            loja: 'Matriz'
        };
        expect(montarMsgReativacao(lead)).toBeNull();
        expect(lead.qualificacaoCompleta).toBe(true);
    });
});
