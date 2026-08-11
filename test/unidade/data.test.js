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
} = require('../../data');

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
        'entrada "%s" nao identifica loja (chamador aplica o fallback Comercial)',
        (entrada) => {
            expect(lojaParaDepartamento(entrada)).toBeNull();
        }
    );

    it('a precedencia coloca Malvinas antes de Matriz quando ambas aparecem', () => {
        // "malvina" e testado primeiro no encadeamento de regex.
        expect(lojaParaDepartamento('malvinas, perto do centro')).toBe('Loja Malvinas');
    });

    it('departamentos previstos incluem fallback e pos-venda', () => {
        expect(DEPARTAMENTOS.geral).toBe('Comercial');
        expect(DEPARTAMENTOS.posvenda).toBe('Pós-venda');
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

    it('as 9 objecoes mapeadas tem resposta consultiva', () => {
        const esperadas = [
            'juros_financiamento',
            'ta_caro',
            'preciso_pensar',
            'medo_credito',
            'sem_cnh',
            'moto_usada_troca',
            'test_drive',
            'prazo_entrega',
            'marca_desconhecida'
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
        const { CAMPOS, CAMPOS_EXTRAS } = require('../../flow');
        // data.js inclui "nome" no inicio; o resto e identico e na mesma ordem.
        expect(CAMPOS_QUALIFICACAO[0]).toBe('nome');
        expect(CAMPOS_QUALIFICACAO.slice(1)).toEqual(CAMPOS);
        expect(CAMPOS_SIMULACAO).toEqual(CAMPOS_EXTRAS.filter((c) => c !== 'nome'));
    });
});
