import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Sinais = require('../../src/domain/atendimento/SinaisDoCliente');

// =============================================================
//  Leitura de intencao por texto.
//
//  Cada uma destas expressoes nasceu de um atendimento que deu errado. Os
//  testes abaixo guardam tanto o que elas DEVEM pegar quanto o que elas NAO
//  podem pegar — e a segunda lista e a que importa, porque um falso positivo
//  aqui aborta o funil no meio de uma conversa que estava indo bem.
// =============================================================

describe('pedeAgilidade: cliente com pressa', () => {
    it.each([
        'vamos direto ao ponto',
        'vamos direto ao assunto',
        'quero ir ao ponto',
        'sem enrolação',
        'sem rodeios',
        'para de perguntar tanta coisa',
        'muitas perguntas',
        'quantas perguntas você vai fazer',
        'tô com pressa',
        'estou sem tempo',
        'não tenho tempo',
        'quanto custa logo',
        'me manda o preço agora',
        'vamos logo',
        'quero resolver rápido'
    ])('reconhece "%s"', (texto) => {
        expect(Sinais.pedeAgilidade(texto)).toBe(true);
    });

    // ------------------------------------------------------------------
    //  CASO REAL: "pouco tempo" foi retirado do gatilho.
    //  E a resposta natural para "quanto tempo você perde no trânsito?" —
    //  incluí-la abortava o funil no meio de uma conversa que ia bem.
    // ------------------------------------------------------------------
    it.each([
        'perco pouco tempo no trânsito',
        'pouco tempo',
        'uns 40 minutos por dia',
        'quanto custa a AZ1?',
        'qual o preço?',
        'quero saber o preço da moto',
        'oi, tudo bem?'
    ])('NAO confunde "%s" com pressa', (texto) => {
        expect(Sinais.pedeAgilidade(texto)).toBe(false);
    });

    it('"quanto custa" so vira pressa quando vem com logo/agora/direto por perto', () => {
        expect(Sinais.pedeAgilidade('quanto custa')).toBe(false);
        expect(Sinais.pedeAgilidade('quanto custa, me diz logo')).toBe(true);
    });
});

describe('pedeTransferencia: pedido inequivoco', () => {
    it.each([
        'me transfire pro vendedor',
        'podem transferir',
        'quero ser transferido',
        'me passa pro vendedor',
        'me passa para o consultor',
        'chama um atendente'
    ])('reconhece "%s"', (texto) => {
        expect(Sinais.pedeTransferencia(texto)).toBe(true);
    });

    // ------------------------------------------------------------------
    //  CASO REAL: "quero falar com humano" ficou DE FORA de proposito.
    //  Aparece negada com frequencia ("nao quero falar com humano"), e um
    //  regex nao distingue. Esse julgamento fica com a extracao, que ve o
    //  historico.
    // ------------------------------------------------------------------
    it.each([
        'quero falar com humano',
        'não quero falar com humano',
        'você é um robô?',
        'prefiro continuar com você'
    ])('NAO reconhece "%s" — o julgamento fica com a extracao', (texto) => {
        expect(Sinais.pedeTransferencia(texto)).toBe(false);
    });
});

describe('prometeTransferencia: a IA disse que ja repassou', () => {
    it.each([
        'já transferi seu atendimento',
        'estou transferindo agora',
        'estou repassando pro consultor',
        'repassei tudo pro time',
        'já vou te passar pro consultor',
        'o consultor vai continuar daqui',
        'o consultor vai dar sequência'
    ])('reconhece "%s"', (texto) => {
        expect(Sinais.prometeTransferencia(texto)).toBe(true);
    });

    // ============================================================
    //  CONGELA (D-34) — buraco real na expressao
    //
    //  O trecho `consultor (j[áa]|vai) (assumir|continuar|dar sequ)` casa
    //  "consultor JA assumir" e "consultor VAI assumir", mas NAO
    //  "consultor JA VAI assumir" — que e a redacao mais natural das tres, e
    //  a que o modelo produz com frequencia.
    //
    //  Consequencia: se a transferencia falhar e a IA tiver escrito assim, a
    //  guarda nao pega e o cliente recebe uma promessa que nao aconteceu —
    //  exatamente o que esta expressao existe para impedir.
    //
    //  Corrigir e mudanca de comportamento (mais respostas passariam a ser
    //  substituidas). Fica como divida.
    // ============================================================
    it.each([
        'o consultor já vai assumir',
        'o consultor já vai continuar',
        'o consultor já vai dar sequência'
    ])('CONGELA: "%s" escapa da guarda', (texto) => {
        expect(Sinais.prometeTransferencia(texto)).toBe(false);
    });

    it('texto que NAO promete repasse passa livre', () => {
        expect(Sinais.prometeTransferencia('a AZ125 custa R$ 14.190,00')).toBe(false);
        expect(Sinais.prometeTransferencia('em qual unidade prefere ser atendido?')).toBe(false);
    });
});

describe('sinalizaEncerramento: o cliente so vai aguardar', () => {
    it.each([
        'não',
        'nada',
        'ok',
        'okay',
        'blz',
        'beleza',
        'tá bom',
        'certo',
        'obrigado',
        'obg',
        'vlw',
        'valeu',
        'show',
        'perfeito',
        'é isso',
        'combinado',
        'fechou',
        'vou aguardar',
        'só esperar'
    ])('reconhece "%s"', (texto) => {
        expect(Sinais.sinalizaEncerramento(texto)).toBe(true);
    });

    // ------------------------------------------------------------------
    //  A ancora no inicio e o limite de tamanho existem para isto: um "nao"
    //  dentro de uma frase longa NAO e um encerramento.
    // ------------------------------------------------------------------
    it.each([
        'não entendi o preço',
        'não, quero saber da AZ125',
        'ok mas e o financiamento?',
        'certo, e a cor vermelha tem?',
        'obrigado, mas ainda tenho uma dúvida'
    ])('NAO confunde "%s" com encerramento', (texto) => {
        expect(Sinais.sinalizaEncerramento(texto)).toBe(false);
    });

    it('tolera pontuacao e espacos em volta', () => {
        expect(Sinais.sinalizaEncerramento('  ok!  ')).toBe(true);
        expect(Sinais.sinalizaEncerramento('beleza.')).toBe(true);
    });
});

describe('todos os sinais: entrada degenerada', () => {
    const funcoes = ['prometeTransferencia', 'pedeTransferencia', 'pedeAgilidade', 'sinalizaEncerramento'];

    it.each(funcoes)('%s aceita null, undefined e vazio sem lancar', (nome) => {
        for (const entrada of [null, undefined, '', 0, false]) {
            expect(() => Sinais[nome](entrada)).not.toThrow();
        }
    });

    it.each(funcoes)('%s e insensivel a caixa', (nome) => {
        // Nao afirma o resultado, so que caixa nao muda o veredito.
        const amostra = 'VAMOS DIRETO AO PONTO';
        expect(Sinais[nome](amostra)).toBe(Sinais[nome](amostra.toLowerCase()));
    });
});
