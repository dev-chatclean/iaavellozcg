import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { CAMPOS, CAMPOS_EXTRAS, determinarProximoCampo, aplicarCampos, detectarPerfil } = require('../../flow');

// =============================================================
//  SPEC 0001 — T10/T11/T12
//  Cobre RN-002 (ordem do funil), RN-003 (politica de sobrescrita)
//  e RN-005 (perfil de dor).
// =============================================================

// Lead completo, usado para "apagar" um campo por vez e verificar a ordem.
const leadCompleto = () => ({
    finalidade: 'trabalho',
    transporteAtual: 'uber',
    gastoMensal: '300 por mes',
    situacaoMoto: 'nao_tem',
    modeloInteresse: 'AZ125',
    formaPagamento: 'financiamento',
    loja: 'Malvinas'
});

describe('flow: ordem do funil (RN-002)', () => {
    it('exporta a ordem oficial dos campos', () => {
        expect(CAMPOS).toEqual([
            'finalidade',
            'transporteAtual',
            'gastoMensal',
            'situacaoMoto',
            'modeloInteresse',
            'formaPagamento',
            'loja'
        ]);
    });

    it('exporta os campos de simulacao coletados em bloco (RN-004)', () => {
        expect(CAMPOS_EXTRAS).toEqual([
            'nome',
            'nomeCompleto',
            'cpf',
            'dataNascimento',
            'telefone',
            'cnh',
            'corModelo'
        ]);
    });

    it('lead vazio comeca pela finalidade', () => {
        expect(determinarProximoCampo({}).campo).toBe('finalidade');
    });

    // `formaPagamento` esta fora desta lista de proposito: ele deixou de bloquear
    // o funil depois que a loja foi escolhida. Ver o teste logo abaixo.
    const CAMPOS_BLOQUEANTES = CAMPOS.filter((c) => c !== 'formaPagamento');

    it.each(CAMPOS_BLOQUEANTES)('quando falta apenas "%s", esse e o proximo campo', (campo) => {
        const lead = leadCompleto();
        delete lead[campo];
        expect(determinarProximoCampo(lead).campo).toBe(campo);
    });

    // CONGELA: a forma de pagamento so e perguntada enquanto a loja nao foi
    // escolhida. Quem fecha a condicao e o consultor da unidade; insistir aqui
    // fazia a IA represcar pagamento depois de o cliente ja ter decidido onde
    // comprar. Comportamento atual da producao.
    it('formaPagamento NAO bloqueia o funil quando a loja ja foi escolhida', () => {
        const lead = leadCompleto();
        delete lead.formaPagamento;
        expect(lead.loja).toBeTruthy();
        expect(determinarProximoCampo(lead)).toBeNull();
        expect(lead.qualificacaoCompleta).toBe(true);
    });

    it('formaPagamento e perguntado enquanto a loja nao foi escolhida', () => {
        const lead = leadCompleto();
        delete lead.formaPagamento;
        delete lead.loja;
        expect(determinarProximoCampo(lead).campo).toBe('formaPagamento');
    });

    it('respeita a ordem quando faltam varios campos: sempre o primeiro vazio', () => {
        const lead = { finalidade: 'app' };
        expect(determinarProximoCampo(lead).campo).toBe('transporteAtual');

        lead.transporteAtual = 'moto alugada';
        expect(determinarProximoCampo(lead).campo).toBe('gastoMensal');

        lead.gastoMensal = '250 por semana';
        expect(determinarProximoCampo(lead).campo).toBe('situacaoMoto');

        lead.situacaoMoto = 'alugada';
        expect(determinarProximoCampo(lead).campo).toBe('modeloInteresse');

        lead.modeloInteresse = 'AZ125';
        expect(determinarProximoCampo(lead).campo).toBe('formaPagamento');

        lead.formaPagamento = 'financiamento';
        expect(determinarProximoCampo(lead).campo).toBe('loja');
    });

    it('cada etapa traz uma instrucao nao vazia para o modelo', () => {
        for (const campo of CAMPOS_BLOQUEANTES) {
            const lead = leadCompleto();
            delete lead[campo];
            const proximo = determinarProximoCampo(lead);
            expect(proximo.pergunta).toBeTruthy();
            expect(typeof proximo.pergunta).toBe('string');
        }

        // formaPagamento so tem instrucao no cenario em que ainda bloqueia
        const semLoja = leadCompleto();
        delete semLoja.formaPagamento;
        delete semLoja.loja;
        expect(determinarProximoCampo(semLoja).pergunta).toBeTruthy();
    });

    it('funil completo retorna null', () => {
        expect(determinarProximoCampo(leadCompleto())).toBeNull();
    });

    // CONGELA BUG D-06 — determinarProximoCampo e uma CONSULTA que MUTA o lead.
    // O comportamento atual e intencionalmente preservado nesta fase; a correcao
    // (proximaEtapa pura) vem na Fase 3 / spec 0006.
    it('CONGELA BUG D-06: marca qualificacaoCompleta como efeito colateral da consulta', () => {
        const lead = leadCompleto();
        expect(lead.qualificacaoCompleta).toBeUndefined();
        determinarProximoCampo(lead);
        expect(lead.qualificacaoCompleta).toBe(true);
    });

    it('CONGELA BUG D-06: consultar um funil incompleto NAO marca qualificacaoCompleta', () => {
        const lead = leadCompleto();
        delete lead.loja;
        determinarProximoCampo(lead);
        expect(lead.qualificacaoCompleta).toBeUndefined();
    });
});

describe('flow: politica de sobrescrita (RN-003)', () => {
    it('preenche campo vazio', () => {
        const lead = {};
        aplicarCampos(lead, { finalidade: 'trabalho' });
        expect(lead.finalidade).toBe('trabalho');
    });

    it('NAO sobrescreve fato do diagnostico ja coletado', () => {
        const lead = { transporteAtual: 'uber', gastoMensal: '300' };
        aplicarCampos(lead, { transporteAtual: 'onibus', gastoMensal: '50' });
        expect(lead.transporteAtual).toBe('uber');
        expect(lead.gastoMensal).toBe('300');
    });

    it.each(['modeloInteresse', 'formaPagamento', 'loja', 'corModelo', 'cnh'])(
        'SOBRESCREVE o campo mutavel "%s" (ultimo valor vence)',
        (campo) => {
            const lead = { [campo]: 'valor antigo' };
            aplicarCampos(lead, { [campo]: 'valor novo' });
            expect(lead[campo]).toBe('valor novo');
        }
    );

    it('sobrescreve qualquer campo quando o cliente corrige explicitamente', () => {
        const lead = { transporteAtual: 'uber', finalidade: 'passeio' };
        aplicarCampos(lead, { transporteAtual: 'onibus', correcao: ['transporteAtual'] });
        expect(lead.transporteAtual).toBe('onibus');
        expect(lead.finalidade).toBe('passeio');
    });

    it('ignora null, undefined e string vazia', () => {
        const lead = { finalidade: 'trabalho' };
        aplicarCampos(lead, { finalidade: null, transporteAtual: undefined, gastoMensal: '' });
        expect(lead.finalidade).toBe('trabalho');
        expect(lead.transporteAtual).toBeUndefined();
        expect(lead.gastoMensal).toBeUndefined();
    });

    it('aceita extracao nula sem lancar', () => {
        const lead = { finalidade: 'trabalho' };
        expect(() => aplicarCampos(lead, null)).not.toThrow();
        expect(() => aplicarCampos(lead, undefined)).not.toThrow();
        expect(lead.finalidade).toBe('trabalho');
    });

    it('tolera correcao que nao e array', () => {
        const lead = { transporteAtual: 'uber' };
        aplicarCampos(lead, { transporteAtual: 'onibus', correcao: 'transporteAtual' });
        expect(lead.transporteAtual).toBe('uber');
    });

    it('aplica campos de simulacao coletados em bloco', () => {
        const lead = {};
        aplicarCampos(lead, {
            nome: 'Rafael',
            nomeCompleto: 'Rafael Silva',
            cpf: '12345678900',
            dataNascimento: '10/05/1995',
            telefone: '83999998888',
            cnh: 'sim',
            corModelo: 'AZ125 vermelha'
        });
        expect(lead.nomeCompleto).toBe('Rafael Silva');
        expect(lead.cpf).toBe('12345678900');
        expect(lead.cnh).toBe('sim');
    });

    it('ignora chaves que nao pertencem ao dominio (ex.: sinais transitorios)', () => {
        const lead = {};
        aplicarCampos(lead, { objecao: 'ta_caro', perguntou: true, querFalarComHumano: true });
        expect(lead.objecao).toBeUndefined();
        expect(lead.perguntou).toBeUndefined();
        expect(lead.querFalarComHumano).toBeUndefined();
    });
});

describe('flow: deteccao de perfil (RN-005)', () => {
    it.each([
        ['app_aluga', 'hoje eu rodo de moto alugada'],
        ['app_comecando', 'quero começar a rodar de aplicativo'],
        ['app_trocar', 'preciso trocar a moto, a manutenção cara ta me matando'],
        ['esposa', 'quero comprar pra minha esposa'],
        ['depende_uber', 'gasto muito com uber todo dia'],
        ['depende_onibus', 'vou de ônibus pro trabalho'],
        ['tem_carro', 'tenho carro mas o combustível ta caro'],
        ['primeira_moto', 'seria minha primeira moto']
    ])('classifica como "%s"', (esperado, texto) => {
        expect(detectarPerfil(texto)).toBe(esperado);
    });

    it('perfis de aplicativo tem precedencia sobre os genericos', () => {
        // Texto que casa com app_aluga E depende_uber: aluguel vence.
        expect(detectarPerfil('rodo de uber com moto alugada')).toBe('app_aluga');
        // Texto que casa com app_trocar E tem_carro: trocar vence.
        expect(detectarPerfil('tenho carro mas quero trocar a moto')).toBe('app_trocar');
    });

    it('e insensivel a maiusculas', () => {
        expect(detectarPerfil('MOTO ALUGADA')).toBe('app_aluga');
    });

    it('retorna null para texto sem sinal e para entrada vazia', () => {
        expect(detectarPerfil('bom dia, tudo bem?')).toBeNull();
        expect(detectarPerfil('')).toBeNull();
        expect(detectarPerfil(null)).toBeNull();
        expect(detectarPerfil(undefined)).toBeNull();
    });
});
