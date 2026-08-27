import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Transbordo = require('../../src/application/transbordo/Transbordo');

// =============================================================
//  Transbordo, isolado.
//
//  O teste dourado ja cobre o caminho feliz de ponta a ponta. O que ele nao
//  mostra e a ORDEM das tres operacoes nem o que acontece quando cada uma
//  falha sozinha — e e ai que o lead se perde.
// =============================================================

const CHAT = '5583999998888';
const LEAD = () => ({ nome: 'Rafael', loja: 'Malvinas', conversationHistory: [] });

const IDS = { 'Loja Matriz': 228, 'Loja Malvinas': 230, 'Loja Monteiro': 231, 'Agente IA': null };

function montar(over = {}) {
    const chamadas = [];
    const canal = {
        enviados: [],
        enviar: vi.fn(async (numero, payload) => {
            chamadas.push({ tipo: payload.forceTicketToDepartment ? 'transferencia' : payload.onlyNote ? 'nota' : 'mensagem', numero, payload });
            canal.enviados.push({ numero, payload });
            if (over.canalFalha) return { ok: false, erro: 'push indisponivel' };
            return { ok: true, status: 200, data: { ok: true } };
        })
    };
    const store = { appendLeadFinalizado: vi.fn(async () => {}) };

    const servico = Transbordo.criar({
        canal,
        store,
        estaEmExpediente: () => ({ aberto: true, motivo: null, proximoExpediente: null }),
        departamentoLead: (lead) => (lead.loja === 'Malvinas' ? 'Loja Malvinas' : 'Agente IA'),
        departamentoId: (d) => IDS[d] ?? null,
        montarResumo: () => 'RESUMO DO LEAD',
        enviarMensagem: vi.fn(async () => true),
        gerarRespostaIA: vi.fn(async () => 'Já estou repassando pro consultor!'),
        PERFIS: {},
        DEPARTAMENTOS: { entrada: 'Agente IA', posvenda: 'Pós-venda' },
        EQUIPE_NUMERO: '5583900000000',
        TRANSFERIR_DEPARTAMENTO: true,
        TRANSFERIR_FECHANDO: false,
        ...over.deps
    });

    return { servico, canal, store, chamadas };
}

describe('a ordem das tres operacoes', () => {
    it('nota PRIMEIRO, transferencia depois, aviso a equipe por ultimo', async () => {
        const { servico, chamadas } = montar();
        await servico.notificarEquipe(LEAD(), CHAT);

        expect(chamadas.map((c) => c.tipo)).toEqual(['nota', 'transferencia', 'mensagem']);
    });

    it('a nota vem antes para o contexto ja estar no ticket quando ele muda de fila', async () => {
        const { servico, chamadas } = montar();
        await servico.notificarEquipe(LEAD(), CHAT);

        expect(chamadas[0]).toMatchObject({ numero: CHAT });
        expect(chamadas[0].payload.onlyNote).toBe(true);
        expect(chamadas[1].payload.queueId).toBe(230);
    });

    it('o aviso a equipe vai para o numero interno, nao para o cliente', async () => {
        const { servico, chamadas } = montar();
        await servico.notificarEquipe(LEAD(), CHAT);

        expect(chamadas[2].numero).toBe('5583900000000');
    });

    it('sem EQUIPE_NUMERO, o aviso interno simplesmente nao sai', async () => {
        const { servico, chamadas } = montar({ deps: { EQUIPE_NUMERO: '' } });
        await servico.notificarEquipe(LEAD(), CHAT);

        expect(chamadas.map((c) => c.tipo)).toEqual(['nota', 'transferencia']);
    });

    it('o lead qualificado e registrado no histórico append-only', async () => {
        const { servico, store } = montar();
        await servico.notificarEquipe(LEAD(), CHAT);

        expect(store.appendLeadFinalizado).toHaveBeenCalledWith(
            expect.objectContaining({ chatId: CHAT, loja: 'Malvinas', departamento: 'Loja Malvinas' })
        );
    });

    it('falha ao gravar o histórico NAO derruba o transbordo', async () => {
        const { servico } = montar({
            deps: {
                store: {
                    appendLeadFinalizado: async () => {
                        throw new Error('redis fora');
                    }
                }
            }
        });
        await expect(servico.notificarEquipe(LEAD(), CHAT)).resolves.toMatchObject({ ok: true });
    });
});

describe('transferirDepartamento', () => {
    it('manda o interruptor E o queueId — mandar so o id nao move o ticket', async () => {
        const { servico, chamadas } = montar();
        await servico.transferirDepartamento(CHAT, 'Loja Monteiro');

        expect(chamadas[0].payload).toMatchObject({ forceTicketToDepartment: true, queueId: 231, onlyNote: true });
    });

    it('desligada por configuracao, nao chama o CRM', async () => {
        const { servico, canal } = montar({ deps: { TRANSFERIR_DEPARTAMENTO: false } });
        const r = await servico.transferirDepartamento(CHAT, 'Loja Malvinas');

        expect(r.ok).toBe(false);
        expect(canal.enviar).not.toHaveBeenCalled();
    });

    it('TRANSFERIR_FECHANDO acrescenta o fechamento no mesmo push', async () => {
        const { servico, chamadas } = montar({ deps: { TRANSFERIR_FECHANDO: true } });
        await servico.transferirDepartamento(CHAT, 'Loja Malvinas');

        expect(chamadas[0].payload.forceTicketToClosed).toBe(true);
    });

    it('departamento de ENTRADA nao e destino: o ticket ja esta la', async () => {
        const { servico, canal } = montar();
        const r = await servico.transferirDepartamento(CHAT, 'Agente IA');

        expect(r).toMatchObject({ ok: false, permanece: true });
        expect(canal.enviar).not.toHaveBeenCalled();
    });

    it('departamento sem ID cadastrado nao transfere, e diz por que', async () => {
        const { servico, canal } = montar();
        const r = await servico.transferirDepartamento(CHAT, 'Pós-venda');

        expect(r.ok).toBe(false);
        expect(r.motivo).toContain('sem ID cadastrado');
        expect(canal.enviar).not.toHaveBeenCalled();
    });

    it('recusa do CRM devolve ok:false com o motivo, sem lancar', async () => {
        const { servico } = montar({ canalFalha: true });
        const r = await servico.transferirDepartamento(CHAT, 'Loja Malvinas');

        expect(r.ok).toBe(false);
        expect(r.motivo).toBeTruthy();
    });
});

describe('encaminhar: o que o cliente ouve', () => {
    it('com transferencia confirmada, a IA escreve o handoff', async () => {
        const enviar = vi.fn(async () => true);
        const { servico } = montar({ deps: { enviarMensagem: enviar } });

        const lead = LEAD();
        await servico.encaminhar(CHAT, lead, 'Loja Malvinas', 'quero comprar', []);

        expect(enviar.mock.calls[0][1]).toContain('repassando');
        expect(lead.finalizado).toBe(true);
        expect(lead.transferidoOk).toBe(true);
    });

    it('SEM transferencia confirmada, a resposta NAO promete o repasse', async () => {
        const enviar = vi.fn(async () => true);
        const { servico } = montar({ deps: { enviarMensagem: enviar, TRANSFERIR_DEPARTAMENTO: false } });

        const lead = LEAD();
        await servico.encaminhar(CHAT, lead, 'Loja Malvinas', 'quero comprar', []);

        const texto = enviar.mock.calls[0][1];
        expect(texto).not.toMatch(/já (te )?transferi|repassando/i);
        expect(texto).toContain('por aqui mesmo');
        expect(lead.transferidoOk).toBe(false);
    });

    it('falha da redacao cai num texto pronto, em vez de deixar o cliente sem resposta', async () => {
        const enviar = vi.fn(async () => true);
        const { servico } = montar({
            deps: {
                enviarMensagem: enviar,
                gerarRespostaIA: async () => {
                    throw new Error('openai fora');
                }
            }
        });

        await servico.encaminhar(CHAT, LEAD(), 'Loja Malvinas', 'quero comprar', []);
        expect(enviar.mock.calls[0][1]).toContain('consultor');
    });

    it('lead que pediu pressa e etiquetado na nota, para o consultor entender o resumo vazio', async () => {
        const montarResumo = vi.fn(() => 'RESUMO');
        const { servico } = montar({ deps: { montarResumo } });

        await servico.encaminhar(CHAT, { ...LEAD(), modoAtalho: true }, 'Loja Malvinas', 'to com pressa', []);

        expect(montarResumo.mock.calls[0][2].tagExtra).toContain('PEDIU AGILIDADE');
    });

    it('fora de expediente, o resumo leva a etiqueta e o retorno sugerido', async () => {
        const montarResumo = vi.fn(() => 'RESUMO');
        const { servico } = montar({
            deps: {
                montarResumo,
                estaEmExpediente: () => ({ aberto: false, motivo: 'fim de semana', proximoExpediente: 'na segunda-feira às 9h' })
            }
        });

        await servico.encaminhar(CHAT, LEAD(), 'Loja Malvinas', 'oi', []);

        const opcoes = montarResumo.mock.calls[0][2];
        expect(opcoes.tagExtra).toContain('FORA DE EXPEDIENTE');
        expect(opcoes.proximoExpediente).toBe('na segunda-feira às 9h');
    });

    it('encaminhar cancela o follow-up pendente', async () => {
        const { servico } = montar();
        const lead = { ...LEAD(), followUpDueAt: 123456 };

        await servico.encaminhar(CHAT, lead, 'Loja Malvinas', 'oi', []);
        expect(lead.followUpDueAt).toBeNull();
        expect(lead.qualificacaoCompleta).toBe(true);
    });
});
