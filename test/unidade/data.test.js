import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    MODELOS,
    LOJAS,
    PERFIS,
    OBJECOES,
    DEPARTAMENTOS,
    FORMAS_PAGAMENTO,
    lojaParaDepartamento,
    CAMPOS_QUALIFICACAO,
    CAMPOS_SIMULACAO
} = require('../../src/domain/catalogo/Catalogo');

// =============================================================
//  SPEC 0001 — T14 · Cobre RN-041 (roteamento por departamento),
//  RN-011 (nomes de produto) e RN-012 (preco unico).
// =============================================================

describe('data: roteamento loja para departamento (RN-041)', () => {
    it.each([
        ['Malvinas', 'Loja Malvinas'],
        ['malvinas', 'Loja Malvinas'],
        ['loja malvina', 'Loja Malvinas'],
        ['Monteiro', 'Loja Monteiro'],
        ['monteiro', 'Loja Monteiro'],
        ['a de Monteiro mesmo', 'Loja Monteiro'],
        ['Matriz', 'Loja Matriz'],
        ['matriz', 'Loja Matriz'],
        ['centro', 'Loja Matriz'],
        ['joão suassuna', 'Loja Matriz'],
        ['joao suassuna', 'Loja Matriz']
    ])('"%s" roteia para %s', (entrada, esperado) => {
        expect(lojaParaDepartamento(entrada)).toBe(esperado);
    });

    it.each([[''], [null], [undefined], ['nao sei ainda'], ['campina grande']])(
        'entrada "%s" nao identifica loja (o ticket permanece no Agente IA)',
        (entrada) => {
            expect(lojaParaDepartamento(entrada)).toBeNull();
        }
    );

    it('a precedencia coloca Malvinas antes de Matriz quando ambas aparecem', () => {
        // "malvina" e testado primeiro no encadeamento de regex.
        expect(lojaParaDepartamento('malvinas, perto do centro')).toBe('Loja Malvinas');
    });

    // Nao existe mais um departamento "Comercial" de fallback: quando a loja nao
    // e identificada, o ticket PERMANECE em "Agente IA", que e a porta de entrada
    // onde o lead ja esta enquanto a IA atende. Nao transferir e o caminho feliz.
    it('departamentos previstos incluem a porta de entrada e o pos-venda', () => {
        expect(DEPARTAMENTOS.entrada).toBe('Agente IA');
        expect(DEPARTAMENTOS.posvenda).toBe('Pós-venda');
        expect(DEPARTAMENTOS.geral).toBeUndefined();
        expect(Object.values(DEPARTAMENTOS)).toContain('Loja Matriz');
        expect(Object.values(DEPARTAMENTOS)).toContain('Loja Malvinas');
        expect(Object.values(DEPARTAMENTOS)).toContain('Loja Monteiro');
    });
});

describe('data: catalogo (RN-011, RN-012)', () => {
    it('existem exatamente tres modelos, com os nomes oficiais', () => {
        const nomes = Object.values(MODELOS).map((m) => m.nome);
        expect(nomes).toEqual(['AZ1', 'AZ125', 'AZX160']);
    });

    it('cada modelo tem preco formatado e valor numerico coerentes', () => {
        for (const m of Object.values(MODELOS)) {
            expect(m.preco).toMatch(/^R\$ [\d.]+,\d{2}$/);
            const numeroDoTexto = Number(m.preco.replace(/[^\d,]/g, '').replace(',', '.'));
            expect(numeroDoTexto).toBeCloseTo(m.precoNum, 2);
        }
    });

    it('cada modelo traz cilindrada, perfil, descricao, cores e imagem', () => {
        for (const m of Object.values(MODELOS)) {
            for (const campo of ['cilindrada', 'perfil', 'descricao', 'cores', 'comparativo', 'imagem']) {
                expect(m[campo], `${m.nome}.${campo}`).toBeTruthy();
            }
        }
    });

    it('a ordem de preco acompanha a cilindrada (economia -> potencia)', () => {
        expect(MODELOS.az1.precoNum).toBeLessThan(MODELOS.az125.precoNum);
        expect(MODELOS.az125.precoNum).toBeLessThan(MODELOS.az160.precoNum);
    });
});

describe('data: lojas', () => {
    it('sao tres unidades, cada uma com endereco, cidade e maps', () => {
        expect(Object.keys(LOJAS)).toEqual(['matriz', 'malvinas', 'monteiro']);
        for (const l of Object.values(LOJAS)) {
            expect(l.nome).toBeTruthy();
            expect(l.endereco).toBeTruthy();
            expect(l.cidade).toMatch(/PB$/);
            expect(l.maps).toMatch(/^https:\/\//);
        }
    });

    it('Monteiro e outra cidade', () => {
        expect(LOJAS.monteiro.cidade).toContain('Monteiro');
        expect(LOJAS.matriz.cidade).toContain('Campina Grande');
        expect(LOJAS.malvinas.cidade).toContain('Campina Grande');
    });

    it('toda loja tem um departamento correspondente (RN-041)', () => {
        for (const l of Object.values(LOJAS)) {
            expect(lojaParaDepartamento(l.nome)).toBeTruthy();
        }
    });
});

describe('data: perfis e objecoes', () => {
    it('os 8 perfis tem nome e gancho de dor (RN-005)', () => {
        expect(Object.keys(PERFIS)).toHaveLength(8);
        for (const p of Object.values(PERFIS)) {
            expect(p.nome).toBeTruthy();
            expect(p.gancho).toBeTruthy();
        }
    });

    it('as 10 objecoes mapeadas tem resposta consultiva', () => {
        const esperadas = [
            'juros_financiamento',
            'ta_caro',
            'preciso_pensar',
            'medo_credito',
            'sem_cnh',
            'moto_usada_troca',
            'test_drive',
            'prazo_entrega',
            'marca_desconhecida',
            // A loja NAO vende moto eletrica. A objecao existe para a IA parar de
            // afirmar que vende quando o cliente pergunta.
            'moto_eletrica'
        ];
        expect(Object.keys(OBJECOES).sort()).toEqual(esperadas.sort());
        for (const o of Object.values(OBJECOES)) expect(o.length).toBeGreaterThan(20);
    });

    it('as quatro formas de pagamento estao descritas (RN-014)', () => {
        expect(Object.keys(FORMAS_PAGAMENTO).sort()).toEqual(['avista', 'cartao', 'consorcio', 'financiamento']);
        expect(FORMAS_PAGAMENTO.cartao).toMatch(/21x/);
        expect(FORMAS_PAGAMENTO.financiamento).toMatch(/48x/);
        expect(FORMAS_PAGAMENTO.financiamento).toMatch(/3 bancos/);
    });
});

describe('data: campos de qualificacao', () => {
    it('a lista do data.js e a do flow.js descrevem o mesmo funil (mais o nome)', () => {
        const { CAMPOS, CAMPOS_EXTRAS } = require('../../src/domain/atendimento/Funil');
        // data.js inclui "nome" no inicio; o resto e identico e na mesma ordem.
        expect(CAMPOS_QUALIFICACAO[0]).toBe('nome');
        expect(CAMPOS_QUALIFICACAO.slice(1)).toEqual(CAMPOS);
        expect(CAMPOS_SIMULACAO).toEqual(CAMPOS_EXTRAS.filter((c) => c !== 'nome'));
    });
});

describe('catalogo: IDs de departamento injetados', () => {
    const Catalogo = require('../../src/domain/catalogo/Catalogo');

    it('sem sobrescrita, usa os IDs cadastrados hoje no painel', () => {
        const { departamentoId } = Catalogo.criarDepartamentos();
        expect(departamentoId('Loja Matriz')).toBe(228);
        expect(departamentoId('Loja Malvinas')).toBe(230);
        expect(departamentoId('Loja Monteiro')).toBe(231);
    });

    // A porta de entrada e o pos-venda nascem SEM id: nao ha para onde
    // transferir, o ticket permanece onde esta.
    it.each(['Agente IA', 'Pós-venda'])('"%s" nasce sem ID', (nome) => {
        expect(Catalogo.criarDepartamentos().departamentoId(nome)).toBeNull();
    });

    it('a sobrescrita vale por departamento, sem afetar os outros', () => {
        const { departamentoId } = Catalogo.criarDepartamentos({ ids: { 'Loja Malvinas': 777 } });
        expect(departamentoId('Loja Malvinas')).toBe(777);
        expect(departamentoId('Loja Matriz')).toBe(228);
    });

    it('cadastrar o pos-venda passa a permitir transferir para ele', () => {
        const { departamentoId } = Catalogo.criarDepartamentos({ ids: { 'Pós-venda': 42 } });
        expect(departamentoId('Pós-venda')).toBe(42);
    });

    // Uma variavel mal digitada no .env nao pode derrubar a transferencia:
    // cair no padrao mantem o lead chegando ao vendedor.
    it.each(['abc', '', null, undefined, {}])('valor invalido (%s) cai no padrao', (v) => {
        const { departamentoId } = Catalogo.criarDepartamentos({ ids: { 'Loja Matriz': v } });
        expect(departamentoId('Loja Matriz')).toBe(228);
    });

    it('instancias diferentes nao se contaminam', () => {
        const a = Catalogo.criarDepartamentos({ ids: { 'Loja Matriz': 1 } });
        const b = Catalogo.criarDepartamentos();
        expect(a.departamentoId('Loja Matriz')).toBe(1);
        expect(b.departamentoId('Loja Matriz')).toBe(228);
    });

    it('os padroes sao congelados: mudar exige mudar codigo', () => {
        expect(Object.isFrozen(Catalogo.IDS_PADRAO)).toBe(true);
    });
});
