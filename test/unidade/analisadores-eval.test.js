import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const a = require('../../src/eval/analisadores');

// =============================================================
//  SPEC 0011 — os analisadores medem se o MODELO obedeceu.
//
//  Os testes existentes garantem que a instrucao CHEGA ao prompt. Estes
//  garantem que o instrumento de medida funciona — sem ele, "0% de vazamento"
//  e opiniao.
//
//  Falso positivo aqui e caro: acusaria violacao onde nao houve e faria a
//  equipe desconfiar da metrica. Por isso ha tantos casos negativos.
// =============================================================

const SEM_DIAGNOSTICO = { diagnosticoCompleto: false };
const COM_DIAGNOSTICO = { diagnosticoCompleto: true };

describe('RN-001 — vazamento de produto antes do diagnostico', () => {
    it('acusa preco em reais', () => {
        const r = a.vazouProduto('A AZ1 está R$ 11.390,00 já com emplacamento. Quer ver?', SEM_DIAGNOSTICO);
        expect(r.violou).toBe(true);
        expect(r.evidencias.join(' ')).toContain('AZ1');
        expect(r.evidencias.join(' ')).toContain('valor');
    });

    it('acusa nome de modelo mesmo sem preco', () => {
        expect(a.vazouProduto('Recomendo a AZ125 pra você. Faz sentido?', SEM_DIAGNOSTICO).violou).toBe(true);
    });

    it('acusa valor escrito por extenso com "reais"', () => {
        expect(a.vazouProduto('Sai por 14.190 reais. Topa?', SEM_DIAGNOSTICO).violou).toBe(true);
    });

    it('NAO acusa quando o diagnostico ja foi feito', () => {
        expect(a.vazouProduto('A AZ125 está R$ 14.190,00. Qual forma de pagamento?', COM_DIAGNOSTICO).violou).toBe(
            false
        );
    });

    it('NAO acusa a resposta correta de redirecionamento', () => {
        const resposta = 'Boa! Antes de te indicar a certa, me conta: hoje você se locomove como — carro, Uber, ônibus?';
        expect(a.vazouProduto(resposta, SEM_DIAGNOSTICO).violou).toBe(false);
    });

    it('NAO confunde numeros do dia a dia com preco', () => {
        expect(a.vazouProduto('Você gasta uns 30 por dia com Uber? Quanto dá por mês?', SEM_DIAGNOSTICO).violou).toBe(
            false
        );
    });

    it('reconhece os tres modelos e nada alem deles', () => {
        expect(a.mencionaModelo('quero a AZ1 ou a AZX160')).toEqual(['AZ1', 'AZX160']);
        expect(a.mencionaModelo('tenho uma Biz e uma Pop')).toEqual([]);
    });
});

describe('RN-020 — revelar que e IA', () => {
    it.each([
        'Sou uma IA treinada pela OpenAI',
        'Sou um bot de atendimento',
        'Como assistente virtual, posso ajudar',
        'Sou um modelo de linguagem'
    ])('acusa: "%s"', (texto) => {
        expect(a.revelouSerIa(texto).violou).toBe(true);
    });

    it('NAO acusa a resposta correta de desvio', () => {
        const resposta = 'Aqui é do time da Avelloz Campina! Posso te ajudar com as motos. Como você se locomove hoje?';
        expect(a.revelouSerIa(resposta).violou).toBe(false);
    });

    it('NAO acusa a palavra "virtual" em outro contexto', () => {
        expect(a.revelouSerIa('A simulação é feita de forma virtual, sem sair de casa. Quer?').violou).toBe(false);
    });
});

describe('RN-010 — informar valor de parcela', () => {
    it.each([
        'Fica em 48x de R$ 320. Fechado?',
        'A parcela fica em 350 por mês. Topa?',
        'São R$ 299,00 por mês. Quer simular?'
    ])('acusa: "%s"', (texto) => {
        expect(a.informouParcela(texto).violou).toBe(true);
    });

    it('NAO acusa quando fala de prazo sem valor', () => {
        expect(a.informouParcela('Dá pra fazer em até 48x, dependendo do CPF. Quer que eu simule?').violou).toBe(false);
    });

    it('NAO acusa o preco a vista (isso e RN-012, nao parcela)', () => {
        expect(a.informouParcela('Está R$ 14.190,00 já com emplacamento. Qual unidade fica melhor?').violou).toBe(
            false
        );
    });
});

describe('RN-021 — terminar com pergunta', () => {
    it('aceita interrogacao no fim', () => {
        expect(a.terminaComPergunta('Como você se locomove hoje?').violou).toBe(false);
    });

    it('aceita interrogacao seguida de emoji', () => {
        expect(a.terminaComPergunta('Qual unidade fica melhor pra você? 😊').violou).toBe(false);
    });

    it('acusa afirmacao sem pergunta', () => {
        const r = a.terminaComPergunta('Perfeito, vou repassar pro nosso consultor.');
        expect(r.violou).toBe(true);
        expect(r.evidencias[0]).toContain('termina com');
    });

    it('acusa mensagem vazia', () => {
        expect(a.terminaComPergunta('').violou).toBe(true);
    });

    it('pergunta no meio nao basta', () => {
        expect(a.terminaComPergunta('Você usa Uber? Vou anotar aqui.').violou).toBe(true);
    });
});

describe('RN-022 — sem markdown, no maximo 1 emoji', () => {
    it('acusa negrito e lista', () => {
        expect(a.usouMarkdown('**AZ125** é a melhor').violou).toBe(true);
        expect(a.usouMarkdown('Temos:\n- AZ1\n- AZ125').violou).toBe(true);
    });

    it('NAO acusa texto corrido', () => {
        expect(a.usouMarkdown('Temos três modelos e todos vêm com emplacamento. Qual te interessa?').violou).toBe(
            false
        );
    });

    it('conta emojis e acusa acima do limite', () => {
        expect(a.contarEmojis('Oi 😊')).toBe(1);
        expect(a.excedeuEmojis('Oi 😊').violou).toBe(false);
        expect(a.excedeuEmojis('Oi 😊🏍️🔥').violou).toBe(true);
    });
});

describe('analisar: relatorio consolidado', () => {
    it('resposta correta nao acusa nada', () => {
        const resposta = 'Boa! Me conta: hoje você se locomove de carro, Uber ou ônibus? 😊';
        expect(a.analisar(resposta, SEM_DIAGNOSTICO).violacoes).toEqual([]);
    });

    it('resposta ruim acusa varias regras de uma vez', () => {
        const resposta = 'Sou uma IA! A **AZ125** sai por R$ 14.190,00, em 48x de R$ 320. 😊🏍️';
        const regras = a.analisar(resposta, SEM_DIAGNOSTICO).violacoes.map((v) => v.regra);

        expect(regras).toContain('RN-001');
        expect(regras).toContain('RN-010');
        expect(regras).toContain('RN-020');
        expect(regras).toContain('RN-021');
        expect(regras).toContain('RN-022 (markdown)');
        expect(regras).toContain('RN-022 (emojis)');
    });

    it('toda violacao traz evidencia', () => {
        for (const v of a.analisar('Sou um bot.', SEM_DIAGNOSTICO).violacoes) {
            expect(v.evidencias.length).toBeGreaterThan(0);
        }
    });
});
