import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FollowUp = require('../../src/application/reativacao/FollowUp');

// =============================================================
//  Follow-up de reativacao.
//
//  O teste dourado nao alcanca isto: depende de um varredor periodico e de
//  estado com vencimento. Aqui da para verificar a promessa central — a
//  mensagem retoma a ETAPA em que o cliente parou, e nao repete se ele
//  continuar calado.
// =============================================================

const CHAT = '5583999998888';

function montar({ leads = new Map(), ocupados = [] } = {}) {
    const enviadas = [];
    const store = {
        leads,
        saveLead: vi.fn(async (chatId, lead) => leads.set(chatId, lead)),
        getLead: vi.fn(async (chatId) => leads.get(chatId) || null),
        scanLeadIds: vi.fn(async () => [...leads.keys()])
    };
    const servico = FollowUp.criar({
        store,
        lockDeAtendimento: { ocupado: (id) => ocupados.includes(id) },
        enviarMensagem: vi.fn(async (chatId, texto) => {
            enviadas.push({ chatId, texto });
            return true;
        }),
        determinarProximoCampo: (lead) => {
            for (const campo of ['finalidade', 'transporteAtual', 'gastoMensal', 'modeloInteresse', 'loja']) {
                if (!lead[campo]) return { campo, pergunta: 'pergunta' };
            }
            return null;
        }
    });
    return { servico, store, enviadas };
}

describe('agendar', () => {
    it('marca o vencimento 30 minutos a frente', () => {
        const { servico } = montar();
        const lead = {};
        const antes = Date.now();

        servico.agendar(lead);

        expect(lead.followUpDueAt).toBeGreaterThanOrEqual(antes + servico.TEMPO_INATIVIDADE);
    });

    it('lead finalizado NAO recebe follow-up — ele ja esta com o consultor', () => {
        const { servico } = montar();
        const lead = { finalizado: true, followUpDueAt: 123 };

        servico.agendar(lead);
        expect(lead.followUpDueAt).toBeNull();
    });

    it('o vencimento fica no ESTADO, nao num timer — sobrevive a redeploy', () => {
        const { servico } = montar();
        const lead = {};
        servico.agendar(lead);

        expect(typeof lead.followUpDueAt).toBe('number');
    });
});

describe('a mensagem retoma a etapa em que o cliente parou', () => {
    const mensagemPara = (lead) => montar().servico.montarMensagem(lead);

    it('parou na finalidade: pergunta pra que ele quer a moto', () => {
        expect(mensagemPara({})).toContain('pra que você quer a moto');
    });

    it('parou no transporte: pergunta como ele se locomove', () => {
        expect(mensagemPara({ finalidade: 'app' })).toContain('se locomovendo hoje');
    });

    it('parou no gasto: retoma de onde pararam', () => {
        const m = mensagemPara({ finalidade: 'app', transporteAtual: 'uber' });
        expect(m).toContain('seguindo de onde paramos');
        expect(m).toContain('quanto você gasta');
    });

    it('parou no modelo: oferece indicar a moto', () => {
        const m = mensagemPara({ finalidade: 'app', transporteAtual: 'uber', gastoMensal: '300' });
        expect(m).toContain('indique o modelo');
    });

    it('parou na loja: pergunta a unidade, citando as tres', () => {
        const lead = { finalidade: 'app', transporteAtual: 'uber', gastoMensal: '300', modeloInteresse: 'AZ125' };
        const m = mensagemPara(lead);
        expect(m).toContain('Matriz');
        expect(m).toContain('Malvinas');
        expect(m).toContain('Monteiro');
    });

    it('usa o PRIMEIRO nome do cliente quando ele existe', () => {
        expect(mensagemPara({ nome: 'Rafael Silva Santos' })).toMatch(/^Oi Rafael[!,]/);
    });

    it('sem nome, cumprimenta sem constranger', () => {
        expect(mensagemPara({})).toMatch(/^Oi[!,]/);
    });

    it('funil completo NAO gera mensagem', () => {
        const completo = {
            finalidade: 'app',
            transporteAtual: 'uber',
            gastoMensal: '300',
            modeloInteresse: 'AZ125',
            loja: 'Malvinas'
        };
        expect(mensagemPara(completo)).toBeNull();
    });
});

describe('disparar: nao repete a mesma mensagem', () => {
    it('envia e guarda o texto enviado', async () => {
        const { servico, enviadas, store } = montar();
        const lead = { followUpDueAt: 1 };

        await servico.disparar(CHAT, lead);

        expect(enviadas).toHaveLength(1);
        expect(lead.followUpUltimo).toBe(enviadas[0].texto);
        expect(store.saveLead).toHaveBeenCalled();
    });

    it('zera o vencimento, para nao disparar de novo no proximo ciclo', async () => {
        const { servico } = montar();
        const lead = { followUpDueAt: 1 };

        await servico.disparar(CHAT, lead);
        expect(lead.followUpDueAt).toBeNull();
    });

    it('NAO reenvia o mesmo texto — o cliente calado nao merece spam', async () => {
        const { servico, enviadas } = montar();
        const lead = { followUpDueAt: 1 };

        await servico.disparar(CHAT, lead);
        lead.followUpDueAt = 1; // como se tivesse sido reagendado
        await servico.disparar(CHAT, lead);

        expect(enviadas).toHaveLength(1);
    });

    it('avancando de etapa, o texto muda e o envio acontece', async () => {
        const { servico, enviadas } = montar();
        const lead = { followUpDueAt: 1 };

        await servico.disparar(CHAT, lead);
        lead.finalidade = 'app';
        lead.followUpDueAt = 1;
        await servico.disparar(CHAT, lead);

        expect(enviadas).toHaveLength(2);
        expect(enviadas[0].texto).not.toBe(enviadas[1].texto);
    });

    it('falha ao gravar NAO impede o envio', async () => {
        const { servico } = montar();
        const quebrado = FollowUp.criar({
            store: {
                saveLead: async () => {
                    throw new Error('redis fora');
                }
            },
            lockDeAtendimento: { ocupado: () => false },
            enviarMensagem: vi.fn(async () => true),
            determinarProximoCampo: () => ({ campo: 'finalidade', pergunta: 'p' })
        });

        await expect(quebrado.disparar(CHAT, { followUpDueAt: 1 })).resolves.not.toThrow();
        void servico;
    });
});

describe('varrer: quem dispara os vencidos', () => {
    const agora = Date.now();
    const leadVencido = () => ({ followUpDueAt: agora - 1000, conversationHistory: [] });

    it('dispara o lead vencido', async () => {
        const leads = new Map([[CHAT, leadVencido()]]);
        const { servico, enviadas } = montar({ leads });

        await servico.varrer();
        expect(enviadas).toHaveLength(1);
    });

    it('NAO dispara lead cujo vencimento ainda nao chegou', async () => {
        const leads = new Map([[CHAT, { followUpDueAt: agora + 600000 }]]);
        const { servico, enviadas } = montar({ leads });

        await servico.varrer();
        expect(enviadas).toHaveLength(0);
    });

    it('NAO dispara lead sem vencimento marcado', async () => {
        const leads = new Map([[CHAT, { conversationHistory: [] }]]);
        const { servico, enviadas } = montar({ leads });

        await servico.varrer();
        expect(enviadas).toHaveLength(0);
    });

    it('NAO dispara lead ja finalizado', async () => {
        const leads = new Map([[CHAT, { ...leadVencido(), finalizado: true }]]);
        const { servico, enviadas } = montar({ leads });

        await servico.varrer();
        expect(enviadas).toHaveLength(0);
    });

    it('PULA quem esta sendo atendido agora — nao fala por cima do turno', async () => {
        const leads = new Map([[CHAT, leadVencido()]]);
        const { servico, enviadas } = montar({ leads, ocupados: [CHAT] });

        await servico.varrer();
        expect(enviadas).toHaveLength(0);
    });

    it('um lead que falha ao ser lido nao interrompe a varredura dos outros', async () => {
        const leads = new Map([
            ['quebrado', leadVencido()],
            [CHAT, leadVencido()]
        ]);
        const enviadas = [];
        const servico = FollowUp.criar({
            store: {
                scanLeadIds: async () => [...leads.keys()],
                getLead: async (id) => {
                    if (id === 'quebrado') throw new Error('redis fora');
                    return leads.get(id);
                },
                saveLead: async () => {}
            },
            lockDeAtendimento: { ocupado: () => false },
            enviarMensagem: async (chatId, texto) => void enviadas.push({ chatId, texto }),
            determinarProximoCampo: () => ({ campo: 'finalidade', pergunta: 'p' })
        });

        await servico.varrer();
        expect(enviadas.map((e) => e.chatId)).toEqual([CHAT]);
    });

    it('falha ao LISTAR os leads nao lanca — a varredura tenta de novo depois', async () => {
        const servico = FollowUp.criar({
            store: {
                scanLeadIds: async () => {
                    throw new Error('redis fora');
                }
            },
            lockDeAtendimento: { ocupado: () => false },
            enviarMensagem: async () => {},
            determinarProximoCampo: () => null
        });

        await expect(servico.varrer()).resolves.not.toThrow();
    });
});
