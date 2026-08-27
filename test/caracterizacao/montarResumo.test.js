import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { montarResumo, departamentoLead } = require('../../index');

// =============================================================
//  SPEC 0001 — T25 · TESTE DE CARACTERIZACAO
//  Congela o resumo entregue a equipe no transbordo (RF-033, RN-043)
//  e o roteamento por departamento (RN-041).
// =============================================================

const CHAT = '5583999998888';

const leadQualificado = (over = {}) => ({
    nome: 'Rafael',
    perfilKey: 'app_aluga',
    finalidade: 'app',
    transporteAtual: 'moto alugada',
    gastoMensal: '250 por semana',
    situacaoMoto: 'alugada',
    modeloInteresse: 'AZ125',
    formaPagamento: 'financiamento',
    loja: 'Malvinas',
    ...over
});

const dadosSimulacao = {
    nomeCompleto: 'Rafael Silva',
    cpf: '12345678900',
    dataNascimento: '10/05/1995',
    telefone: '83999998888',
    cnh: 'sim',
    corModelo: 'AZ125 vermelha'
};

describe('departamentoLead (RN-041)', () => {
    it('roteia pela loja escolhida', () => {
        expect(departamentoLead({ loja: 'Malvinas' })).toBe('Loja Malvinas');
        expect(departamentoLead({ loja: 'Monteiro' })).toBe('Loja Monteiro');
        expect(departamentoLead({ loja: 'Matriz' })).toBe('Loja Matriz');
    });

    // Nao ha departamento de fallback. Sem loja identificada, o destino e a
    // propria fila de entrada — ou seja, o ticket nao se move.
    it('fica em "Agente IA" quando a loja nao foi identificada', () => {
        expect(departamentoLead({})).toBe('Agente IA');
        expect(departamentoLead({ loja: 'nao sei' })).toBe('Agente IA');
    });
});

describe('montarResumo: conteudo do transbordo (RN-043)', () => {
    it('traz o cabecalho, o contato e todos os campos do diagnostico', () => {
        const r = montarResumo(leadQualificado(), CHAT);
        expect(r).toContain('LEAD QUALIFICADO — Avelloz Campina');
        expect(r).toContain(`Contato: Rafael (${CHAT})`);
        expect(r).toContain('Perfil: Roda de app — moto alugada');
        expect(r).toContain('Finalidade: app');
        expect(r).toContain('Transporte hoje: moto alugada');
        expect(r).toContain('Gasto atual: 250 por semana');
        expect(r).toContain('Situação de moto: alugada');
        expect(r).toContain('Modelo de interesse: AZ125');
        expect(r).toContain('Forma de pagamento: financiamento');
        expect(r).toContain('Loja escolhida: Malvinas');
    });

    it('termina com a linha de transferencia para o departamento da loja', () => {
        expect(montarResumo(leadQualificado(), CHAT)).toContain('Transferir para o departamento Loja Malvinas');
    });

    // Sem loja, a linha final muda de natureza: em vez de mandar transferir,
    // avisa a equipe que o ticket FICA onde esta. E a diferenca entre "faca
    // isso" e "nao ha o que fazer automaticamente".
    it('sem loja identificada, avisa que o ticket permanece na entrada', () => {
        const r = montarResumo(leadQualificado({ loja: null }), CHAT);
        expect(r).toContain('Loja escolhida: Não informada');
        expect(r).toContain('Sem loja escolhida — o ticket permanece em Agente IA');
        expect(r).not.toContain('Transferir para o departamento');
    });

    it('aceita departamento explicito nas opcoes quando ele TEM id cadastrado', () => {
        const r = montarResumo(leadQualificado(), CHAT, { departamento: 'Loja Monteiro' });
        expect(r).toContain('Transferir para o departamento Loja Monteiro (#231)');
    });

    // ============================================================
    //  CONGELA (D-31) — a ultima linha ramifica pelo ID, nao pela loja
    //
    //  O texto final e escolhido por "o departamento tem ID cadastrado?", e
    //  nao por "o cliente escolheu loja?". Como "Pós-venda" nasce sem ID
    //  (DEPT_ID_POSVENDA vazio), a nota diz "Sem loja escolhida" MESMO quando o
    //  cliente escolheu a loja — o vendedor le uma informacao falsa.
    //
    //  Corrigir e mudanca de comportamento: fica como divida.
    // ============================================================
    it('CONGELA: departamento sem id diz "Sem loja escolhida" ainda que a loja exista', () => {
        const r = montarResumo(leadQualificado({ loja: 'Malvinas' }), CHAT, { departamento: 'Pós-venda' });
        expect(r).toContain('Loja escolhida: Malvinas');
        expect(r).toContain('Sem loja escolhida — o ticket permanece em Pós-venda');
    });

    it('preencher DEPT_ID_POSVENDA nao muda o texto do resumo ja carregado', () => {
        // Confirma que o ID vem do data.js carregado, nao de uma leitura tardia.
        const r = montarResumo(leadQualificado({ loja: null }), CHAT, { departamento: 'Pós-venda' });
        expect(r).toContain('permanece em Pós-venda');
    });

    it('preenche "Não informado" para cada campo ausente', () => {
        const r = montarResumo({}, CHAT);
        expect(r).toContain('Contato: Lead');
        expect(r).toContain('Perfil: Não informado');
        expect(r).toContain('Finalidade: Não informado');
        expect(r).toContain('Transporte hoje: Não informado');
        expect(r).toContain('Gasto atual: Não informado');
        expect(r).toContain('Situação de moto: Não informado');
        expect(r).toContain('Modelo de interesse: Não informado');
        expect(r).toContain('Forma de pagamento: Não informado');
        expect(r).toContain('Loja escolhida: Não informada');
    });

    it('perfil desconhecido nao quebra o resumo', () => {
        const r = montarResumo(leadQualificado({ perfilKey: 'inexistente' }), CHAT);
        expect(r).toContain('Perfil: Não informado');
    });
});

describe('montarResumo: bloco de dados de simulacao (RN-004)', () => {
    it('omite o bloco quando nenhum dado foi coletado', () => {
        expect(montarResumo(leadQualificado(), CHAT)).not.toContain('Dados p/ simulação');
    });

    it('inclui o bloco completo quando ha dados', () => {
        const r = montarResumo(leadQualificado(dadosSimulacao), CHAT);
        expect(r).toContain('Dados p/ simulação');
        expect(r).toContain('Nome completo: Rafael Silva');
        expect(r).toContain('Nascimento: 10/05/1995');
        expect(r).toContain('Telefone: 83999998888');
        expect(r).toContain('CNH: sim');
        expect(r).toContain('Cor/modelo: AZ125 vermelha');
    });

    it('basta UM dado de simulacao para o bloco aparecer, com o resto "Não informado"', () => {
        const r = montarResumo(leadQualificado({ cpf: '12345678900' }), CHAT);
        expect(r).toContain('Dados p/ simulação');
        expect(r).toContain('Nome completo: Não informado');
    });

    // CONGELA RISCO S2 — o CPF vai INTEIRO no resumo, que e publicado como nota
    // no ticket e enviado por WhatsApp para EQUIPE_NUMERO. A spec 0016 troca
    // por CPF mascarado; este teste deve ser INVERTIDO la.
    it('CONGELA RISCO S2: o CPF aparece completo, sem mascara', () => {
        const r = montarResumo(leadQualificado(dadosSimulacao), CHAT);
        expect(r).toContain('CPF: 12345678900');
        expect(r).not.toContain('***');
    });
});

describe('montarResumo: expediente e etiquetas (RN-061)', () => {
    it('sem opcoes, nao adiciona etiqueta nem retorno sugerido', () => {
        const r = montarResumo(leadQualificado(), CHAT);
        expect(r).not.toContain('[');
        expect(r).not.toContain('Retorno sugerido');
    });

    it('adiciona a etiqueta de fora de expediente', () => {
        const r = montarResumo(leadQualificado(), CHAT, { tagExtra: 'FORA DE EXPEDIENTE' });
        expect(r).toContain('[FORA DE EXPEDIENTE]');
    });

    it('adiciona o retorno sugerido quando fornecido', () => {
        const r = montarResumo(leadQualificado(), CHAT, { proximoExpediente: 'na segunda-feira às 9h' });
        expect(r).toContain('Retorno sugerido: na segunda-feira às 9h');
    });

    it('combina etiqueta, retorno e departamento explicito', () => {
        const r = montarResumo(leadQualificado(), CHAT, {
            departamento: 'Loja Monteiro',
            tagExtra: 'FORA DE EXPEDIENTE — AGENDAR RETORNO',
            proximoExpediente: 'amanhã às 9h'
        });
        expect(r).toContain('[FORA DE EXPEDIENTE — AGENDAR RETORNO]');
        expect(r).toContain('Retorno sugerido: amanhã às 9h');
        expect(r).toContain('Transferir para o departamento Loja Monteiro');
    });
});
