import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const EtapaDoFunil = require('../../src/domain/atendimento/EtapaDoFunil');
const Qualificacao = require('../../src/domain/atendimento/Qualificacao');
const Perfil = require('../../src/domain/atendimento/Perfil');
const PoliticaDeDiagnostico = require('../../src/domain/atendimento/politicas/PoliticaDeDiagnostico');
const PoliticaDeTransbordo = require('../../src/domain/atendimento/politicas/PoliticaDeTransbordo');
const MontadorDeResumo = require('../../src/domain/atendimento/MontadorDeResumo');

// =============================================================
//  SPEC 0006 — o dominio, testado diretamente.
//
//  As mesmas regras ja estao cobertas via flow.js em flow.test.js e via
//  index.js na caracterizacao. Aqui elas sao exercitadas SEM o legado no
//  meio — que e o ponto de tirar a regra de dentro do God Object.
//
//  O que se ganha: RN-001 tem teste proprio (antes era so uma expressao
//  booleana dentro de um prompt) e o funil pode ser consultado sem que a
//  consulta altere nada (D-06).
// =============================================================

const funilCompleto = () => ({
    finalidade: 'app',
    transporteAtual: 'moto alugada',
    gastoMensal: '250 por semana',
    situacaoMoto: 'alugada',
    modeloInteresse: 'AZ125',
    formaPagamento: 'financiamento',
    loja: 'Malvinas'
});

describe('EtapaDoFunil (RN-002)', () => {
    it('a ordem oficial comeca pela finalidade e termina na loja', () => {
        expect(EtapaDoFunil.CAMPOS[0]).toBe('finalidade');
        expect(EtapaDoFunil.CAMPOS.at(-1)).toBe('loja');
        expect(EtapaDoFunil.CAMPOS).toHaveLength(7);
    });

    it('o diagnostico vem ANTES de modelo e preco', () => {
        const ordem = EtapaDoFunil.CAMPOS;
        for (const campoDoDiagnostico of ['transporteAtual', 'gastoMensal', 'situacaoMoto']) {
            expect(ordem.indexOf(campoDoDiagnostico)).toBeLessThan(ordem.indexOf('modeloInteresse'));
        }
    });

    it('devolve a primeira etapa vazia', () => {
        expect(EtapaDoFunil.proxima({}).campo).toBe('finalidade');
        expect(EtapaDoFunil.proxima({ finalidade: 'app' }).campo).toBe('transporteAtual');
    });

    it('cada etapa tem instrucao para o modelo', () => {
        for (const etapa of EtapaDoFunil.ETAPAS) {
            expect(etapa.instrucao.length).toBeGreaterThan(20);
        }
    });

    it('funil completo devolve null', () => {
        expect(EtapaDoFunil.proxima(funilCompleto())).toBeNull();
        expect(EtapaDoFunil.completo(funilCompleto())).toBe(true);
    });

    // A diferenca central em relacao ao legado (D-06).
    it('consultar NAO altera o objeto consultado', () => {
        const campos = funilCompleto();
        const copia = JSON.parse(JSON.stringify(campos));

        EtapaDoFunil.proxima(campos);
        EtapaDoFunil.completo(campos);

        expect(campos).toEqual(copia);
        expect(campos.qualificacaoCompleta).toBeUndefined();
    });

    it('as etapas sao imutaveis', () => {
        expect(Object.isFrozen(EtapaDoFunil.ETAPAS)).toBe(true);
        expect(Object.isFrozen(EtapaDoFunil.ETAPAS[0])).toBe(true);
    });
});

describe('Qualificacao (RN-003)', () => {
    it('preenche campo vazio', () => {
        expect(Qualificacao.aplicar({}, { finalidade: 'trabalho' }).finalidade).toBe('trabalho');
    });

    it('NAO sobrescreve fato do diagnostico', () => {
        const r = Qualificacao.aplicar({ transporteAtual: 'uber' }, { transporteAtual: 'onibus' });
        expect(r.transporteAtual).toBe('uber');
    });

    it.each(Qualificacao.MUTAVEIS)('campo mutavel "%s" aceita o ultimo valor', (campo) => {
        const r = Qualificacao.aplicar({ [campo]: 'antigo' }, { [campo]: 'novo' });
        expect(r[campo]).toBe('novo');
    });

    it('correcao explicita vence sobre fato ja coletado', () => {
        const r = Qualificacao.aplicar(
            { transporteAtual: 'uber' },
            { transporteAtual: 'onibus', correcao: ['transporteAtual'] }
        );
        expect(r.transporteAtual).toBe('onibus');
    });

    it('nao muta o objeto de entrada', () => {
        const atuais = { finalidade: 'app' };
        Qualificacao.aplicar(atuais, { transporteAtual: 'uber' });
        expect(atuais.transporteAtual).toBeUndefined();
    });

    it('ignora vazios e sinais transitorios', () => {
        const r = Qualificacao.aplicar({}, { finalidade: '', gastoMensal: null, objecao: 'ta_caro', perguntou: true });
        expect(r.finalidade).toBeUndefined();
        expect(r.objecao).toBeUndefined();
        expect(r.perguntou).toBeUndefined();
    });

    it('extracao ausente devolve os campos intactos', () => {
        expect(Qualificacao.aplicar({ finalidade: 'app' }, null)).toEqual({ finalidade: 'app' });
    });

    it('apenasCamposConhecidos descarta o que nao e do funil', () => {
        const r = Qualificacao.apenasCamposConhecidos({ finalidade: 'app', conversationHistory: [], loopAvisado: true });
        expect(r).toEqual({ finalidade: 'app' });
    });
});

describe('PoliticaDeDiagnostico (RN-001)', () => {
    const diagnosticoFeito = { transporteAtual: 'uber', gastoMensal: '300', situacaoMoto: 'nao_tem' };

    it('sao tres os campos do diagnostico minimo', () => {
        expect(PoliticaDeDiagnostico.CAMPOS_DO_DIAGNOSTICO).toEqual([
            'transporteAtual',
            'gastoMensal',
            'situacaoMoto'
        ]);
    });

    it('completo so com os tres preenchidos', () => {
        expect(PoliticaDeDiagnostico.completo(diagnosticoFeito)).toBe(true);
    });

    it.each(['transporteAtual', 'gastoMensal', 'situacaoMoto'])('sem "%s", NAO pode revelar produto', (campo) => {
        const campos = { ...diagnosticoFeito };
        delete campos[campo];
        expect(PoliticaDeDiagnostico.podeRevelarProduto(campos)).toBe(false);
    });

    it('lead novo nao pode receber preco', () => {
        expect(PoliticaDeDiagnostico.podeRevelarProduto({})).toBe(false);
    });

    it('ter modelo escolhido NAO substitui o diagnostico', () => {
        expect(PoliticaDeDiagnostico.podeRevelarProduto({ modeloInteresse: 'AZ125', finalidade: 'app' })).toBe(false);
    });

    it('informa o que ainda falta', () => {
        expect(PoliticaDeDiagnostico.faltando({ transporteAtual: 'uber' })).toEqual(['gastoMensal', 'situacaoMoto']);
        expect(PoliticaDeDiagnostico.faltando(diagnosticoFeito)).toEqual([]);
    });
});

describe('PoliticaDeTransbordo (RN-040, RN-041, RN-042)', () => {
    it('roteia pela loja escolhida', () => {
        expect(PoliticaDeTransbordo.departamentoDaLoja('Malvinas')).toBe('Loja Malvinas');
        expect(PoliticaDeTransbordo.departamentoDaLoja('Monteiro')).toBe('Loja Monteiro');
    });

    it('sem loja identificada, Comercial', () => {
        expect(PoliticaDeTransbordo.departamentoDaLoja(null)).toBe('Comercial');
        expect(PoliticaDeTransbordo.departamentoDaLoja('nao sei')).toBe('Comercial');
    });

    it('cliente atual vai para o Pos-venda', () => {
        const r = PoliticaDeTransbordo.transbordoImediato({ tipoContato: 'cliente' }, {});
        expect(r.motivo).toBe(PoliticaDeTransbordo.MOTIVOS.CLIENTE_ATUAL);
        expect(r.departamento).toBe('Pós-venda');
    });

    it('pedido de humano transfere para a loja escolhida', () => {
        const r = PoliticaDeTransbordo.transbordoImediato({ querFalarComHumano: true }, { loja: 'Monteiro' });
        expect(r.motivo).toBe(PoliticaDeTransbordo.MOTIVOS.PEDIDO_DO_CLIENTE);
        expect(r.departamento).toBe('Loja Monteiro');
    });

    it('cliente atual tem precedencia sobre pedido de humano', () => {
        const r = PoliticaDeTransbordo.transbordoImediato({ tipoContato: 'cliente', querFalarComHumano: true }, {});
        expect(r.motivo).toBe(PoliticaDeTransbordo.MOTIVOS.CLIENTE_ATUAL);
    });

    it('sem sinal, nao ha transbordo imediato', () => {
        expect(PoliticaDeTransbordo.transbordoImediato({ tipoContato: 'lead' }, {})).toBeNull();
        expect(PoliticaDeTransbordo.transbordoImediato(null, {})).toBeNull();
    });

    it('dentro do expediente, sem etiqueta nem retorno sugerido', () => {
        const m = PoliticaDeTransbordo.marcacaoDeExpediente({ aberto: true, proximoExpediente: null });
        expect(m.tagExtra).toBeUndefined();
        expect(m.proximoExpediente).toBeNull();
    });

    it('fora do expediente, etiqueta e retorno (RN-061)', () => {
        const m = PoliticaDeTransbordo.marcacaoDeExpediente(
            { aberto: false, proximoExpediente: 'amanhã às 9h' },
            { etiquetaForaDeExpediente: 'FORA DE EXPEDIENTE — AGENDAR RETORNO' }
        );
        expect(m.tagExtra).toBe('FORA DE EXPEDIENTE — AGENDAR RETORNO');
        expect(m.proximoExpediente).toBe('amanhã às 9h');
    });
});

describe('MontadorDeResumo (RN-043)', () => {
    const lead = { ...funilCompleto(), nome: 'Rafael', perfilKey: 'app_aluga' };

    it('traz o diagnostico e a linha de transferencia', () => {
        const r = MontadorDeResumo.montar(lead, '5583999998888');
        expect(r).toContain('LEAD QUALIFICADO');
        expect(r).toContain('Perfil: Roda de app — moto alugada');
        expect(r).toContain('Gasto atual: 250 por semana');
        expect(r).toContain('Transferir para o departamento Loja Malvinas');
    });

    it('sem dados de simulacao, o bloco nao aparece', () => {
        expect(MontadorDeResumo.montar(lead, '558399')).not.toContain('Dados p/ simulação');
    });

    it('o registro do historico carrega os campos do funil', () => {
        const reg = MontadorDeResumo.paraRegistro(lead, '558399', 'Loja Malvinas', '2026-08-12T10:00:00.000Z');
        expect(reg).toMatchObject({
            chatId: '558399',
            nome: 'Rafael',
            perfil: 'Roda de app — moto alugada',
            loja: 'Malvinas',
            departamento: 'Loja Malvinas'
        });
    });
});

describe('Perfil (RN-005)', () => {
    it('monta o texto de classificacao com os campos antes da fala bruta', () => {
        const texto = Perfil.textoParaClassificar(
            { finalidade: 'app', transporteAtual: 'moto alugada' },
            'oi tudo bem'
        );
        expect(texto).toBe('app moto alugada oi tudo bem');
    });

    it('correcao de campo do diagnostico exige reclassificar', () => {
        expect(Perfil.precisaReclassificar(['transporteAtual'])).toBe(true);
        expect(Perfil.precisaReclassificar(['situacaoMoto'])).toBe(true);
        expect(Perfil.precisaReclassificar(['finalidade'])).toBe(true);
    });

    it('correcao de outro campo nao exige reclassificar', () => {
        expect(Perfil.precisaReclassificar(['modeloInteresse'])).toBe(false);
        expect(Perfil.precisaReclassificar([])).toBe(false);
    });
});
