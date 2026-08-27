import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PoliticaDeDiagnostico = require('../../src/domain/atendimento/politicas/PoliticaDeDiagnostico');
const PoliticaDeTransbordo = require('../../src/domain/atendimento/politicas/PoliticaDeTransbordo');

// =============================================================
//  As duas politicas centrais do atendimento.
//
//  A RN-001 nunca teve teste proprio: era uma expressao solta dentro de um
//  template de prompt. Se alguem acrescentasse um quarto campo ao diagnostico,
//  nada ligava esse campo a regra.
// =============================================================

const DIAGNOSTICO = {
    transporteAtual: 'moto alugada',
    gastoMensal: '250 por semana',
    situacaoMoto: 'alugada'
};

describe('PoliticaDeDiagnostico (RN-001)', () => {
    it('os tres campos do diagnostico estao declarados, na ordem de coleta', () => {
        expect(PoliticaDeDiagnostico.CAMPOS_DO_DIAGNOSTICO).toEqual([
            'transporteAtual',
            'gastoMensal',
            'situacaoMoto'
        ]);
    });

    it('a lista e imutavel: acrescentar campo tem de ser mudanca de codigo, nao acidente', () => {
        expect(Object.isFrozen(PoliticaDeDiagnostico.CAMPOS_DO_DIAGNOSTICO)).toBe(true);
    });

    it('diagnostico completo libera o produto', () => {
        expect(PoliticaDeDiagnostico.completo(DIAGNOSTICO)).toBe(true);
        expect(PoliticaDeDiagnostico.podeRevelarProduto(DIAGNOSTICO)).toBe(true);
    });

    it.each(PoliticaDeDiagnostico.CAMPOS_DO_DIAGNOSTICO)(
        'faltando "%s", o produto continua BLOQUEADO',
        (campo) => {
            const parcial = { ...DIAGNOSTICO };
            delete parcial[campo];
            expect(PoliticaDeDiagnostico.podeRevelarProduto(parcial)).toBe(false);
        }
    );

    it('estado vazio bloqueia, e nao lanca', () => {
        expect(PoliticaDeDiagnostico.podeRevelarProduto({})).toBe(false);
        expect(PoliticaDeDiagnostico.podeRevelarProduto()).toBe(false);
    });

    it('campo em branco ou vazio NAO conta como coletado', () => {
        for (const vazio of ['', null, undefined, 0, false]) {
            expect(PoliticaDeDiagnostico.podeRevelarProduto({ ...DIAGNOSTICO, gastoMensal: vazio })).toBe(false);
        }
    });

    it('ter loja, modelo e pagamento NAO substitui o diagnostico', () => {
        // O funil pode avancar por outros caminhos; a RN-001 nao cede a nenhum.
        const semDiagnostico = { loja: 'Malvinas', modeloInteresse: 'AZ125', formaPagamento: 'financiamento' };
        expect(PoliticaDeDiagnostico.podeRevelarProduto(semDiagnostico)).toBe(false);
    });

    it('faltando() lista o que resta, na ordem', () => {
        expect(PoliticaDeDiagnostico.faltando({})).toEqual([
            'transporteAtual',
            'gastoMensal',
            'situacaoMoto'
        ]);
        expect(PoliticaDeDiagnostico.faltando({ transporteAtual: 'uber' })).toEqual([
            'gastoMensal',
            'situacaoMoto'
        ]);
        expect(PoliticaDeDiagnostico.faltando(DIAGNOSTICO)).toEqual([]);
    });
});

describe('PoliticaDeTransbordo (RN-040, RN-041)', () => {
    const catalogo = ({ idPosVenda = null } = {}) => ({
        resolverLoja: (texto) => {
            if (!texto) return null;
            if (/malvinas/i.test(texto)) return 'Loja Malvinas';
            if (/monteiro/i.test(texto)) return 'Loja Monteiro';
            if (/matriz|centro/i.test(texto)) return 'Loja Matriz';
            return null;
        },
        departamentoDeEntrada: 'Agente IA',
        departamentoDePosVenda: 'Pós-venda',
        idDoDepartamento: (d) =>
            ({ 'Loja Matriz': 228, 'Loja Malvinas': 230, 'Loja Monteiro': 231, 'Pós-venda': idPosVenda })[d] ??
            null
    });

    const politica = (opcoes) => PoliticaDeTransbordo.criar(catalogo(opcoes));

    it('o lead vai para a loja que ele escolheu', () => {
        const p = politica();
        expect(p.destinoDoLead({ loja: 'Malvinas' })).toBe('Loja Malvinas');
        expect(p.destinoDoLead({ loja: 'Monteiro' })).toBe('Loja Monteiro');
        expect(p.destinoDoLead({ loja: 'centro' })).toBe('Loja Matriz');
    });

    it('sem loja identificada, o destino e a propria fila de entrada', () => {
        const p = politica();
        expect(p.destinoDoLead({})).toBe('Agente IA');
        expect(p.destinoDoLead({ loja: 'nao sei ainda' })).toBe('Agente IA');
    });

    it('destino igual a entrada significa NAO transferir: o ticket ja esta la', () => {
        const p = politica();
        expect(p.haParaOndeTransferir(p.destinoDoLead({}))).toBe(false);
        expect(p.haParaOndeTransferir(p.destinoDoLead({ loja: 'Malvinas' }))).toBe(true);
    });

    it('pos-venda sem departamento proprio volta para a unidade onde comprou', () => {
        const p = politica({ idPosVenda: null });
        expect(p.destinoDePosVenda({ loja: 'Matriz' })).toBe('Loja Matriz');
    });

    it('pos-venda COM departamento proprio cadastrado vence a unidade', () => {
        const p = politica({ idPosVenda: 999 });
        expect(p.destinoDePosVenda({ loja: 'Matriz' })).toBe('Pós-venda');
    });

    it('pos-venda sem departamento e sem unidade conhecida fica na entrada', () => {
        const p = politica({ idPosVenda: null });
        expect(p.destinoDePosVenda({})).toBe('Agente IA');
    });

    it('estado vazio nao lanca em nenhum dos caminhos', () => {
        const p = politica();
        expect(() => p.destinoDoLead()).not.toThrow();
        expect(() => p.destinoDePosVenda()).not.toThrow();
    });

    it('instancias com catalogos diferentes nao se contaminam', () => {
        const semPosVenda = politica({ idPosVenda: null });
        const comPosVenda = politica({ idPosVenda: 999 });
        expect(semPosVenda.destinoDePosVenda({ loja: 'Matriz' })).toBe('Loja Matriz');
        expect(comPosVenda.destinoDePosVenda({ loja: 'Matriz' })).toBe('Pós-venda');
    });
});

// =============================================================
//  MontadorDeResumo, isolado.
//
//  A caracterizacao em test/caracterizacao/montarResumo.test.js ja congela o
//  TEXTO, visto de fora pelo index.js. Aqui o alvo e a estrutura: a ordem dos
//  campos e a injecao das dependencias.
// =============================================================
const MontadorDeResumo = require('../../src/domain/atendimento/MontadorDeResumo');

describe('MontadorDeResumo (RN-043)', () => {
    const montador = (over = {}) =>
        MontadorDeResumo.criar({
            nomeDoPerfil: () => 'Roda de app',
            idDoDepartamento: (d) => ({ 'Loja Malvinas': 230 })[d] ?? null,
            destinoPadrao: () => 'Loja Malvinas',
            ...over
        });

    const LEAD = {
        nome: 'Rafael',
        finalidade: 'app',
        transporteAtual: 'moto alugada',
        gastoMensal: '250 por semana',
        situacaoMoto: 'alugada',
        modeloInteresse: 'AZ125',
        formaPagamento: 'financiamento',
        loja: 'Malvinas'
    };

    it('a ordem em que o vendedor le e explicita e imutavel', () => {
        expect(MontadorDeResumo.LINHAS_DO_DIAGNOSTICO.map(([rotulo]) => rotulo)).toEqual([
            'Finalidade',
            'Transporte hoje',
            'Gasto atual',
            'Situação de moto',
            'Modelo de interesse',
            'Forma de pagamento'
        ]);
        expect(Object.isFrozen(MontadorDeResumo.LINHAS_DO_DIAGNOSTICO)).toBe(true);
        expect(Object.isFrozen(MontadorDeResumo.LINHAS_DE_SIMULACAO)).toBe(true);
    });

    it('as linhas saem na ordem declarada, nao na ordem do objeto', () => {
        // Objeto montado ao contrario de proposito.
        const invertido = Object.fromEntries(Object.entries(LEAD).reverse());
        const texto = montador().montar(invertido, '5583999998888');
        const posicoes = ['Finalidade:', 'Transporte hoje:', 'Gasto atual:', 'Situação de moto:'].map((r) =>
            texto.indexOf(r)
        );
        expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    });

    it('o bloco de simulacao so aparece quando ha algum dado', () => {
        expect(montador().montar(LEAD, '5583999998888')).not.toContain('Dados p/ simulação');
        expect(montador().montar({ ...LEAD, cpf: '000' }, '5583999998888')).toContain('Dados p/ simulação');
    });

    it('um unico campo de simulacao ja traz o bloco inteiro, com os ausentes marcados', () => {
        const texto = montador().montar({ ...LEAD, cnh: 'sim' }, '5583999998888');
        expect(texto).toContain('CNH: sim');
        expect(texto).toContain(`CPF: ${MontadorDeResumo.NAO_INFORMADO}`);
    });

    it('o departamento explicito vence o destino padrao', () => {
        const texto = montador().montar(LEAD, '5583999998888', { departamento: 'Loja Monteiro' });
        expect(texto).toContain('Loja Monteiro');
    });

    it('a etiqueta extra entra no cabecalho', () => {
        expect(montador().montar(LEAD, '5583999998888', { tagExtra: 'CLIENTE ATUAL' })).toContain('[CLIENTE ATUAL]');
    });

    it('o retorno sugerido so aparece quando informado', () => {
        expect(montador().montar(LEAD, '5583999998888')).not.toContain('Retorno sugerido');
        expect(montador().montar(LEAD, '5583999998888', { proximoExpediente: 'amanhã às 9h' })).toContain(
            'Retorno sugerido: amanhã às 9h'
        );
    });

    it('estado vazio nao lanca e marca tudo como nao informado', () => {
        const texto = montador().montar({}, '5583999998888');
        expect(texto).toContain('Contato: Lead (5583999998888)');
        expect(texto).toContain('Loja escolhida: Não informada');
    });

    it('o catalogo de perfis e injetado: o dominio nao o conhece', () => {
        const texto = montador({ nomeDoPerfil: () => 'Perfil inventado' }).montar(LEAD, '5583999998888');
        expect(texto).toContain('Perfil: Perfil inventado');
    });
});
