import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { montarSistema } = require('../apoio/fakes');

// =============================================================
//  SPEC 0001 — T31/T32/T33 · TESTE DOURADO
//
//  Exercita processarMensagem/handleWebhook de ponta a ponta com OpenAI,
//  ChatClean e store falsificados. E a rede de seguranca que autoriza as
//  fases seguintes: cobre os 15 cenarios definidos em qa-testes.md.
//
//  Cobre CA-005, CA-006, CA-007, CA-008 e UC-001, 005, 006, 007, 009,
//  010, 013, 015, 016.
// =============================================================

const CHAT = '5583999998888';
// Terca-feira, 10h em America/Recife: dentro do expediente atual.
const TERCA_10H = new Date('2026-08-11T10:00:00-03:00');
// Sabado, 10h: fora do expediente atual (ver D-19 — o negocio confirmou que a
// loja ATENDE sabado; a correcao e da spec 0009).
const SABADO_10H = new Date('2026-08-15T10:00:00-03:00');

// setTimeout real, capturado antes do stub, para esperar o processamento
// assincrono disparado pelo webhook.
const setTimeoutReal = globalThis.setTimeout;
const aguardar = (ms = 5) => new Promise((r) => setTimeoutReal(r, ms));
async function aguardarAte(condicao, tentativas = 60) {
    for (let i = 0; i < tentativas; i++) {
        if (condicao()) return true;
        await aguardar(5);
    }
    return condicao();
}

const requisicao = (body) => ({ body, headers: {}, query: {}, params: {} });
const resposta = () => ({ status: () => ({ json: () => {} }) });

const payload = (over = {}) => ({
    contact: { id: 1, name: 'Rafael', number: CHAT, ...(over.contact || {}) },
    ticket: { status: 'pending', userId: null, ...(over.ticket || {}) },
    message: { id: 'MSG-1', body: 'oi', type: 'chat', fromMe: false, ...(over.message || {}) }
});

// Extracao completa do funil, turno a turno (usada no fluxo feliz).
const FUNIL_COMPLETO = [
    { nome: 'Rafael', finalidade: 'app' },
    { transporteAtual: 'moto alugada' },
    { gastoMensal: '250 por semana' },
    { situacaoMoto: 'alugada' },
    { modeloInteresse: 'AZ125' },
    { formaPagamento: 'financiamento' },
    { loja: 'Malvinas' }
];

let s;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TERCA_10H);
    // Neutraliza o atraso de "digitacao" (900ms + 18ms por caractere) sem
    // alterar o timeout de 60s do lock de processamento.
    vi.stubGlobal('setTimeout', (fn, ms, ...args) => setTimeoutReal(fn, ms >= 5000 ? ms : 0, ...args));
});

afterEach(() => {
    s?.desmontar();
    s = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

// -------------------------------------------------------------
//  1. Bloqueio de diagnostico (RN-001, CA-005)
// -------------------------------------------------------------
describe('cenario 1: cliente pede preco na primeira mensagem', () => {
    it('CA-005: o prompt instrui a NAO revelar preco e a redirecionar para o diagnostico', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push({ perguntou: true });
        s.openai.filaResposta.push('Boa! Antes disso, me conta: hoje voce se locomove como?');

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'quanto custa a AZ1?', tipo: 'text' });

        const prompt = s.openai.ultimoPromptDeResposta();
        expect(prompt).toContain('DIAGNÓSTICO ainda NÃO terminou');
        expect(prompt).toContain('NÃO revele preço');
        expect(prompt).toContain('O CLIENTE FEZ UMA PERGUNTA');
        expect(s.axios.enviadas).toHaveLength(1);
    });

    it('o system prompt com as regras da persona acompanha toda resposta', async () => {
        s = montarSistema();
        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        const system = s.openai.systemsDeResposta()[0];
        expect(system).toContain('consultor humano do time comercial da Avelloz Campina');
        expect(system).toContain('BLOQUEIO OBRIGATÓRIO');
        expect(system).toContain('NUNCA informe valor de PARCELA');
    });

    it('libera produto somente quando o diagnostico esta completo', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [],
            finalidade: 'app',
            transporteAtual: 'moto alugada',
            gastoMensal: '250 por semana',
            situacaoMoto: 'alugada'
        });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'qual moto voces indicam?', tipo: 'text' });

        const prompt = s.openai.ultimoPromptDeResposta();
        expect(prompt).toContain('Diagnóstico mínimo OK');
        expect(prompt).not.toContain('DIAGNÓSTICO ainda NÃO terminou');
    });
});

// -------------------------------------------------------------
//  2. Fluxo feliz ate o transbordo (UC-005, RN-040, RN-041, CA-006)
// -------------------------------------------------------------
describe('cenario 2: qualificacao completa e transbordo', () => {
    it('CA-006: ao fechar o funil, notifica a equipe uma vez e finaliza', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push(...FUNIL_COMPLETO);

        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento', 'Malvinas']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        const lead = s.store.leads.get(CHAT);
        expect(lead.qualificacaoCompleta).toBe(true);
        expect(lead.finalizado).toBe(true);

        // Sao DUAS notas internas: o resumo do lead e, logo depois, a confirmacao
        // da transferencia do ticket. A transferencia viaja no mesmo POST da
        // segunda nota, pelos campos forceTicketToDepartment + queueId.
        expect(s.axios.notas).toHaveLength(2);
        expect(s.axios.notas[0].body).toContain('LEAD QUALIFICADO');
        expect(s.axios.notas[0].body).toContain('Transferir para o departamento Loja Malvinas');
        expect(s.axios.notas[1].body).toContain('Loja Malvinas');

        expect(s.axios.transferencias()).toEqual([
            { number: CHAT, queueId: 230, fechandoTicket: false }
        ]);

        expect(s.store.finalizados).toHaveLength(1);
        expect(s.store.finalizados[0].departamento).toBe('Loja Malvinas');
        expect(s.store.finalizados[0].loja).toBe('Malvinas');
    });

    it('o resumo carrega o diagnostico coletado', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push(...FUNIL_COMPLETO);
        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento', 'Malvinas']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        const nota = s.axios.notas[0].body;
        expect(nota).toContain('Transporte hoje: moto alugada');
        expect(nota).toContain('Gasto atual: 250 por semana');
        expect(nota).toContain('Modelo de interesse: AZ125');
        expect(nota).toContain('Perfil: Roda de app — moto alugada');
    });

    it('nao transborda enquanto a loja nao for identificada (RN-040)', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push(...FUNIL_COMPLETO.slice(0, 6));
        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        expect(s.store.leads.get(CHAT).finalizado).toBeFalsy();
        expect(s.axios.notas).toHaveLength(0);
    });

    it('envia o resumo tambem ao WhatsApp da equipe quando configurado', async () => {
        s = montarSistema({ env: { EQUIPE_NUMERO: '5583911112222' } });
        s.openai.filaExtracao.push(...FUNIL_COMPLETO);
        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento', 'Malvinas']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        expect(s.axios.textosEnviadosPara('5583911112222')[0]).toContain('LEAD QUALIFICADO');
    });
});

// -------------------------------------------------------------
//  2b. Transferencia de ticket entre departamentos
//
//  Comportamento NOVO em relacao ao commit raiz, e o mais critico do sistema:
//  e o que faz o lead chegar ao vendedor. A transferencia viaja no MESMO POST
//  da nota interna, por forceTicketToDepartment + queueId.
// -------------------------------------------------------------
describe('cenario 2b: transferencia de departamento', () => {
    const qualificarEscolhendo = async (loja) => {
        s.openai.filaExtracao.push(...FUNIL_COMPLETO.slice(0, 6), { loja });
        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento', loja]) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }
    };

    it.each([
        ['Matriz', 228],
        ['Malvinas', 230],
        ['Monteiro', 231]
    ])('a loja "%s" transfere para a fila #%i', async (loja, queueId) => {
        s = montarSistema();
        await qualificarEscolhendo(loja);
        expect(s.axios.transferencias()).toEqual([{ number: CHAT, queueId, fechandoTicket: false }]);
    });

    it('TRANSFERIR_DEPARTAMENTO=false volta ao encaminhamento manual (so a nota)', async () => {
        s = montarSistema({ env: { TRANSFERIR_DEPARTAMENTO: 'false' } });
        await qualificarEscolhendo('Malvinas');
        expect(s.axios.transferencias()).toHaveLength(0);
        expect(s.axios.notas).toHaveLength(1);
        // O lead continua registrado com a loja: o que muda e so o repasse.
        expect(s.store.finalizados[0].departamento).toBe('Loja Malvinas');
    });

    it('TRANSFERIR_FECHANDO=true fecha o ticket no mesmo push', async () => {
        // A plataforma so reposiciona ticket FECHADO ou de primeiro contato.
        // Fechar junto e o gatilho documentado para ele reabrir na fila certa.
        s = montarSistema({ env: { TRANSFERIR_FECHANDO: 'true' } });
        await qualificarEscolhendo('Malvinas');
        expect(s.axios.transferencias()).toEqual([{ number: CHAT, queueId: 230, fechandoTicket: true }]);
    });

    it('o ID do departamento pode ser sobrescrito pelo ambiente', async () => {
        s = montarSistema({ env: { DEPT_ID_MALVINAS: '777' } });
        await qualificarEscolhendo('Malvinas');
        expect(s.axios.transferencias()).toEqual([{ number: CHAT, queueId: 777, fechandoTicket: false }]);
    });

    it('CONGELA: se o Push falha, o lead e finalizado mesmo sem ninguem receber nada', async () => {
        // Toda chamada ao CRM falha: a resposta ao cliente nao sai, a nota nao
        // chega, a transferencia e recusada. Ainda assim o lead e marcado como
        // finalizado e o turno termina sem repique. Na pratica o atendimento
        // desaparece em silencio — e a D-17 vista de dentro.
        s = montarSistema();
        s.axios.falharPush = true;
        await qualificarEscolhendo('Malvinas');

        expect(s.axios.enviadas).toHaveLength(0);
        expect(s.axios.notas).toHaveLength(0);
        expect(s.store.leads.get(CHAT).finalizado).toBe(true);
    });
});

// -------------------------------------------------------------
//  3. Correcao de campo mutavel (RN-003)
// -------------------------------------------------------------
describe('cenario 3: cliente corrige o modelo escolhido', () => {
    it('o ultimo modelo informado vence', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], modeloInteresse: 'AZ1' });
        s.openai.filaExtracao.push({ modeloInteresse: 'AZ125', correcao: ['modeloInteresse'] });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'na verdade quero a AZ125', tipo: 'text' });

        expect(s.store.leads.get(CHAT).modeloInteresse).toBe('AZ125');
    });

    it('fato do diagnostico NAO e sobrescrito sem correcao explicita', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], transporteAtual: 'uber' });
        s.openai.filaExtracao.push({ transporteAtual: 'onibus' });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'ando de onibus tambem', tipo: 'text' });

        expect(s.store.leads.get(CHAT).transporteAtual).toBe('uber');
    });
});

// -------------------------------------------------------------
//  4. Pedido explicito de humano (UC-006, RN-042)
// -------------------------------------------------------------
describe('cenario 4: cliente pede para falar com humano', () => {
    it('transborda na hora, mesmo com o funil incompleto', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push({ querFalarComHumano: true });
        s.openai.filaResposta.push('Claro! Ja tô repassando pro nosso consultor. Posso ajudar em mais algo?');

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'quero falar com um vendedor', tipo: 'text' });

        const lead = s.store.leads.get(CHAT);
        expect(lead.finalizado).toBe(true);

        // Sem loja escolhida NAO ha transferencia: o ticket permanece em "Agente
        // IA", a fila de entrada onde o lead ja esta. Isso e caminho normal, nao
        // falha — a equipe direciona a partir da nota. So a nota do resumo sai.
        expect(s.axios.notas).toHaveLength(1);
        expect(s.axios.notas[0].body).toContain('permanece em Agente IA');
        expect(s.axios.transferencias()).toHaveLength(0);
    });

    it('roteia para a loja quando ela ja foi escolhida', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], loja: 'Monteiro' });
        s.openai.filaExtracao.push({ querFalarComHumano: true });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'me passa pro vendedor', tipo: 'text' });

        expect(s.axios.notas[0].body).toContain('Transferir para o departamento Loja Monteiro');
    });
});

// -------------------------------------------------------------
//  5. Cliente atual vai para o Pos-venda (UC-007)
// -------------------------------------------------------------
describe('cenario 5: cliente atual pedindo pos-venda', () => {
    it('marca como cliente atual, encerra e pergunta a unidade', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push({ tipoContato: 'cliente' });

        await s.sistema.processarMensagem({
            chatId: CHAT,
            texto: 'comprei uma moto e preciso de assistencia',
            tipo: 'text'
        });

        expect(s.axios.notas[0].body).toContain('[CLIENTE ATUAL]');
        expect(s.axios.enviadas[0].body).toContain('time de pós-venda');
        expect(s.store.leads.get(CHAT).finalizado).toBe(true);

        // Sem a unidade, nao ha para onde transferir: o ticket fica na entrada e
        // a propria resposta ao cliente pergunta onde ele comprou.
        expect(s.axios.notas[0].body).toContain('permanece em Agente IA');
        expect(s.axios.transferencias()).toHaveLength(0);
    });

    it('cliente atual COM unidade conhecida vai para a loja onde comprou', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], loja: 'Matriz' });
        s.openai.filaExtracao.push({ tipoContato: 'cliente' });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'preciso de revisao', tipo: 'text' });

        expect(s.axios.notas[0].body).toContain('Transferir para o departamento Loja Matriz');
        expect(s.axios.transferencias()).toEqual([
            { number: CHAT, queueId: 228, fechandoTicket: false }
        ]);
    });
});

// -------------------------------------------------------------
//  6. Fora de expediente (RN-061)
// -------------------------------------------------------------
describe('cenario 6: transbordo fora de expediente', () => {
    it('etiqueta o resumo e sugere o retorno', async () => {
        vi.setSystemTime(SABADO_10H);
        s = montarSistema();
        s.openai.filaExtracao.push(...FUNIL_COMPLETO);

        for (const texto of ['oi', 'uber', '250', 'alugada', 'AZ125', 'financiamento', 'Malvinas']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        const nota = s.axios.notas[0].body;
        expect(nota).toContain('[FORA DE EXPEDIENTE — AGENDAR RETORNO]');
        expect(nota).toContain('Retorno sugerido: na segunda-feira às 9h');
    });

    // CONGELA BUG D-28 — o expediente e passado para promptResposta e IGNORADO:
    // o prompt da resposta nao menciona plantao em lugar nenhum, entao o modelo
    // escreve como se a loja estivesse aberta. Corrigido na spec 0009.
    it('CONGELA BUG D-28: o prompt da resposta nao informa que esta fora de expediente', async () => {
        vi.setSystemTime(SABADO_10H);
        s = montarSistema();

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        const prompt = s.openai.ultimoPromptDeResposta();
        expect(prompt).not.toMatch(/expediente|plantão|fechado|amanhã às 9h/i);
    });
});

// -------------------------------------------------------------
//  7 e 8. Midia (UC-009)
// -------------------------------------------------------------
describe('cenario 7: audio que falha na transcricao', () => {
    it('pede texto e encerra o turno sem chamar a redacao', async () => {
        s = montarSistema();
        s.axios.falharTranscricao = true;

        await s.sistema.processarMensagem({
            chatId: CHAT,
            texto: '',
            tipo: 'audio',
            mediaBase64: Buffer.from('audio').toString('base64')
        });

        expect(s.axios.enviadas[0].body).toContain('prefiro que a gente converse por texto');
        expect(s.openai.chamadas.filter((c) => c.tipo === 'resposta')).toHaveLength(0);
    });

    it('audio transcrito com sucesso vira o texto do turno', async () => {
        s = montarSistema();
        s.axios.transcricao = 'quero uma moto pra trabalhar de aplicativo';

        await s.sistema.processarMensagem({
            chatId: CHAT,
            texto: '',
            tipo: 'audio',
            mediaBase64: Buffer.from('audio').toString('base64')
        });

        expect(s.openai.ultimoPromptDeResposta()).toContain('quero uma moto pra trabalhar de aplicativo');
    });

    it('audio que nem baixa pede texto e encerra', async () => {
        s = montarSistema();
        s.axios.falharDownload = true;

        await s.sistema.processarMensagem({
            chatId: CHAT,
            texto: '',
            tipo: 'audio',
            mediaUrl: 'https://exemplo/audio.ogg'
        });

        expect(s.axios.enviadas[0].body).toContain('não consegui abrir por aqui');
    });
});

describe('cenario 8: documento recebido', () => {
    it('acusa o recebimento e encerra o turno, sem chamar a OpenAI', async () => {
        s = montarSistema();

        await s.sistema.processarMensagem({ chatId: CHAT, texto: '', tipo: 'document' });

        expect(s.axios.enviadas).toHaveLength(1);
        expect(s.axios.enviadas[0].body).toContain('Recebi o arquivo');
        expect(s.openai.chamadas).toHaveLength(0);
        expect(s.store.leads.get(CHAT).finalizado).toBeFalsy();
    });
});

describe('cenario 8b: imagem enviada pelo cliente (RN-028)', () => {
    it('a descricao da visao entra no prompt da resposta', async () => {
        s = montarSistema();
        s.openai.descricaoImagem = 'Foto de uma moto vermelha usada, com bau traseiro.';

        await s.sistema.processarMensagem({
            chatId: CHAT,
            texto: '',
            tipo: 'image',
            mediaUrl: 'https://exemplo/foto.jpg'
        });

        const prompt = s.openai.ultimoPromptDeResposta();
        expect(prompt).toContain('ENVIOU UMA IMAGEM');
        expect(prompt).toContain('Foto de uma moto vermelha usada');
        expect(prompt).toContain('NUNCA diga que não consegue ver imagens');
    });
});

// -------------------------------------------------------------
//  9 e 10. Filtros do webhook (UC-016)
// -------------------------------------------------------------
describe('cenario 9: mensagens que nao devem ser respondidas', () => {
    it.each([
        ['eco do proprio bot', { message: { fromMe: true } }],
        ['mensagem de grupo', { ticket: { isGroup: true } }],
        ['ticket assumido por humano', { ticket: { status: 'open', userId: 42 } }],
        ['ticket encerrado', { ticket: { status: 'closed' } }]
    ])('%s nao gera resposta nem estado', async (_nome, over) => {
        s = montarSistema();

        await s.sistema.handleWebhook(requisicao(payload(over)), resposta());
        await aguardar(30);

        expect(s.axios.enviadas).toHaveLength(0);
        expect(s.store.leads.size).toBe(0);
    });

    it('contato fora da allow-list e ignorado (RN-058)', async () => {
        s = montarSistema({ env: { IA_ALLOWED_CONTACTS: '5583900000000' } });

        await s.sistema.handleWebhook(requisicao(payload()), resposta());
        await aguardar(30);

        expect(s.axios.enviadas).toHaveLength(0);
    });

    it('tipo nao suportado recebe o fallback humanizado', async () => {
        s = montarSistema();

        await s.sistema.handleWebhook(
            requisicao(payload({ message: { type: 'sticker', id: 'MSG-STK' } })),
            resposta()
        );
        await aguardarAte(() => s.axios.enviadas.length > 0);

        expect(s.axios.enviadas[0].body).toContain('Pode me mandar por texto');
    });
});

describe('cenario 10: mensagem duplicada (RN-055)', () => {
    it('o mesmo msgId e processado uma unica vez', async () => {
        s = montarSistema();

        await s.sistema.handleWebhook(requisicao(payload({ message: { id: 'MSG-DUP' } })), resposta());
        await aguardarAte(() => s.axios.enviadas.length > 0);
        await s.sistema.handleWebhook(requisicao(payload({ message: { id: 'MSG-DUP' } })), resposta());
        await aguardar(30);

        expect(s.axios.enviadas).toHaveLength(1);
    });
});

// -------------------------------------------------------------
//  11. Rate-limit (RN-053)
// -------------------------------------------------------------
describe('cenario 11: rate-limit por numero', () => {
    it('ignora as mensagens acima do limite da janela', async () => {
        s = montarSistema({ env: { RATE_LIMIT_MSGS: '3', RATE_LIMIT_JANELA_S: '60' } });

        for (let i = 1; i <= 5; i++) {
            await s.sistema.handleWebhook(requisicao(payload({ message: { id: `MSG-${i}` } })), resposta());
            await aguardar(15);
        }

        expect(s.axios.enviadas.length).toBeLessThanOrEqual(3);
        expect(s.axios.enviadas.length).toBeGreaterThan(0);
    });
});

// -------------------------------------------------------------
//  12. Blindagem anti-loop (RN-054, CA-007)
// -------------------------------------------------------------
describe('cenario 12: blindagem anti-loop', () => {
    it('CA-007: mensagem repetida tres vezes pausa as respostas', async () => {
        s = montarSistema();

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });
        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });
        const antes = s.axios.enviadas.length;
        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        expect(s.axios.enviadas.length).toBe(antes);
        expect(s.store.leads.get(CHAT).loopAvisado).toBe(true);
    });

    it('avisa a equipe uma unica vez sobre o loop', async () => {
        s = montarSistema({ env: { EQUIPE_NUMERO: '5583911112222' } });

        for (let i = 0; i < 5; i++) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });
        }

        const avisos = s.axios
            .textosEnviadosPara('5583911112222')
            .filter((t) => t.includes('Possível loop'));
        expect(avisos).toHaveLength(1);
    });

    it('excesso de turnos na janela tambem pausa', async () => {
        s = montarSistema({ env: { LOOP_MAX_TURNOS: '3', LOOP_JANELA_MIN: '3' } });

        for (let i = 1; i <= 5; i++) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto: `mensagem diferente ${i}`, tipo: 'text' });
        }

        expect(s.axios.enviadas.length).toBe(3);
        expect(s.store.leads.get(CHAT).loopAvisado).toBe(true);
    });
});

// -------------------------------------------------------------
//  13. Reset por inatividade (RN-071, CA-008)
// -------------------------------------------------------------
describe('cenario 13: reset por inatividade', () => {
    it('CA-008: apos 25h o atendimento recomeca do zero', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [{ role: 'user', content: 'conversa antiga' }],
            finalidade: 'passeio',
            transporteAtual: 'onibus',
            ultimaInteracao: TERCA_10H.getTime() - 25 * 3600 * 1000
        });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi de novo', tipo: 'text' });

        const lead = s.store.leads.get(CHAT);
        expect(lead.finalidade).toBeUndefined();
        expect(lead.transporteAtual).toBeUndefined();
        expect(lead.conversationHistory.some((h) => h.content === 'conversa antiga')).toBe(false);
    });

    it('dentro da janela de 24h o atendimento continua', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [],
            finalidade: 'passeio',
            ultimaInteracao: TERCA_10H.getTime() - 23 * 3600 * 1000
        });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'voltei', tipo: 'text' });

        expect(s.store.leads.get(CHAT).finalidade).toBe('passeio');
    });
});

// -------------------------------------------------------------
//  14. Follow-up de reativacao (RN-070)
// -------------------------------------------------------------
describe('cenario 14: follow-up de reativacao', () => {
    it('agenda a reativacao apos um turno normal', async () => {
        s = montarSistema();

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        const lead = s.store.leads.get(CHAT);
        expect(lead.followUpDueAt).toBe(TERCA_10H.getTime() + 30 * 60 * 1000);
    });

    it('o varredor dispara a mensagem vencida e nao a repete', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [],
            nome: 'Rafael',
            followUpDueAt: TERCA_10H.getTime() - 1000
        });

        await s.sistema.varrerFollowUps();
        const enviadasDepoisDaPrimeira = s.axios.enviadas.length;
        expect(enviadasDepoisDaPrimeira).toBe(1);
        expect(s.axios.enviadas[0].body).toMatch(/^Oi Rafael/);

        // Vence de novo com o mesmo estado: a mensagem seria identica, entao nao repete.
        const lead = s.store.leads.get(CHAT);
        lead.followUpDueAt = TERCA_10H.getTime() - 1000;
        s.store.leads.set(CHAT, lead);
        await s.sistema.varrerFollowUps();

        expect(s.axios.enviadas).toHaveLength(enviadasDepoisDaPrimeira);
    });

    it('nao reativa atendimento ja finalizado (RN-070)', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [],
            finalizado: true,
            followUpDueAt: TERCA_10H.getTime() - 1000
        });

        await s.sistema.varrerFollowUps();

        expect(s.axios.enviadas).toHaveLength(0);
    });

    it('uma nova mensagem do cliente cancela a reativacao pendente', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [],
            followUpDueAt: TERCA_10H.getTime() + 60 * 1000
        });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'voltei', tipo: 'text' });

        // Reagendado a partir de agora, nao o vencimento antigo.
        expect(s.store.leads.get(CHAT).followUpDueAt).toBe(TERCA_10H.getTime() + 30 * 60 * 1000);
    });
});

// -------------------------------------------------------------
//  15. Atendimento apos o transbordo (UC-010, RN-044)
// -------------------------------------------------------------
describe('cenario 15: mensagem depois do transbordo', () => {
    it('responde a duvida sem refazer o funil nem repetir o resumo', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, {
            conversationHistory: [{ role: 'assistant', content: 'Ja repassei pro consultor.' }],
            finalizado: true,
            loja: 'Malvinas'
        });
        s.openai.filaResposta.push('O consultor ja vai te chamar aqui. Ficou alguma duvida sobre a moto?');

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'quanto tempo demora?', tipo: 'text' });

        expect(s.axios.enviadas).toHaveLength(1);
        expect(s.axios.notas).toHaveLength(0);
        expect(s.store.finalizados).toHaveLength(0);
        // Usa o prompt curto de pos-transbordo, nao o SYSTEM_SDR completo.
        const system = s.openai.systemsDeResposta()[0];
        expect(system).toContain('Escrita natural, curta, registro de WhatsApp');
        expect(system).not.toContain('BLOQUEIO OBRIGATÓRIO');
    });

    it('nao executa extracao de campos apos o transbordo', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], finalizado: true });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'e a cor azul, tem?', tipo: 'text' });

        expect(s.openai.chamadas.filter((c) => c.tipo === 'extracao')).toHaveLength(0);
    });
});

// -------------------------------------------------------------
//  Extra: resiliencia do turno (RF-006)
// -------------------------------------------------------------
describe('extra: falha da OpenAI no meio do turno', () => {
    it('envia a mensagem de instabilidade e preserva o que ja foi extraido', async () => {
        s = montarSistema();
        s.openai.filaExtracao.push({ finalidade: 'trabalho' });
        s.openai.erroNaResposta = 'openai fora do ar';

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'quero uma moto pra trabalhar', tipo: 'text' });

        expect(s.axios.enviadas[0].body).toContain('instabilidade');
        expect(s.store.leads.get(CHAT).finalidade).toBe('trabalho');
    });

    it('falha na extracao nao derruba o turno', async () => {
        s = montarSistema();
        s.openai.erroNaExtracao = 'extracao fora do ar';

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        expect(s.axios.enviadas).toHaveLength(1);
    });

    it('lock de outra instancia impede o processamento duplicado (RN-056)', async () => {
        s = montarSistema();
        s.store.travarProximoLock = true;

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'oi', tipo: 'text' });

        expect(s.axios.enviadas).toHaveLength(0);
        expect(s.openai.chamadas).toHaveLength(0);
    });
});

// -------------------------------------------------------------
//  16. Lead impaciente: atalho do funil (modoAtalho)
//
//  Comportamento NOVO. Quem pede objetividade nao pode receber mais um
//  paragrafo de qualificacao: o funil inteiro e abandonado e so a LOJA importa,
//  porque sem ela o ticket nao sai da fila de entrada.
// -------------------------------------------------------------
describe('cenario 16: cliente com pressa', () => {
    it('pula o funil e pergunta SO a loja, sem passar pelo modelo', async () => {
        s = montarSistema();

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'vamos direto ao ponto', tipo: 'text' });

        const lead = s.store.leads.get(CHAT);
        expect(lead.modoAtalho).toBe(true);
        expect(lead.atalhoPerguntado).toBe(true);

        // A pergunta e FIXA: nenhuma chamada de redacao foi feita para produzi-la.
        expect(s.axios.enviadas).toHaveLength(1);
        expect(s.axios.enviadas[0].body).toContain('Matriz');
        expect(s.axios.enviadas[0].body).toContain('Malvinas');
        expect(s.axios.enviadas[0].body).toContain('Monteiro');
        expect(s.openai.chamadas.filter((c) => c.tipo === 'resposta')).toHaveLength(0);
    });

    it('com a loja ja escolhida, transfere na hora em vez de perguntar', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], loja: 'Monteiro' });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'to com pressa', tipo: 'text' });

        expect(s.store.leads.get(CHAT).finalizado).toBe(true);
        expect(s.axios.transferencias()).toEqual([{ number: CHAT, queueId: 231, fechandoTicket: false }]);
    });

    it('a etiqueta do atalho entra no resumo entregue a equipe', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { conversationHistory: [], loja: 'Malvinas' });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'sem enrolação', tipo: 'text' });

        expect(s.axios.notas[0].body).toContain('PEDIU AGILIDADE — SEM DIAGNÓSTICO');
    });
});

// -------------------------------------------------------------
//  17. Encerramento pos-handoff
//
//  Comportamento NOVO. Depois de transferir, a IA respondia para sempre e era
//  obrigada a terminar toda mensagem com pergunta: o cliente dizia "nao" e ela
//  perguntava de novo, falando por cima do consultor humano.
// -------------------------------------------------------------
describe('cenario 17: conversa apos o handoff', () => {
    const jaTransferido = () => ({ conversationHistory: [], loja: 'Malvinas', finalizado: true });

    it('sinal de fim do cliente encerra a conversa com uma despedida', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, jaTransferido());

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'ok', tipo: 'text' });

        const lead = s.store.leads.get(CHAT);
        expect(lead.conversaEncerrada).toBe(true);
        expect(s.axios.enviadas.at(-1).body).toContain('Nosso consultor assume');
    });

    it('depois de encerrada, a IA fica em SILENCIO e so registra o historico', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, { ...jaTransferido(), conversaEncerrada: true });

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'e o financiamento?', tipo: 'text' });

        expect(s.axios.enviadas).toHaveLength(0);
        expect(s.store.leads.get(CHAT).conversationHistory.at(-1)).toEqual({
            role: 'user',
            content: 'e o financiamento?'
        });
    });

    it('duvida pontual antes do teto ainda e respondida', async () => {
        s = montarSistema();
        s.store.leads.set(CHAT, jaTransferido());
        s.openai.filaResposta.push('O consultor vai te passar as condições certinho!');

        await s.sistema.processarMensagem({ chatId: CHAT, texto: 'qual a cor disponível?', tipo: 'text' });

        expect(s.axios.enviadas).toHaveLength(1);
        expect(s.store.leads.get(CHAT).conversaEncerrada).toBeFalsy();
        expect(s.store.leads.get(CHAT).respostasPosHandoff).toBe(1);
    });

    it('o teto de respostas encerra mesmo sem sinal de fim', async () => {
        s = montarSistema({ env: { MAX_RESPOSTAS_POS_HANDOFF: '2' } });
        s.store.leads.set(CHAT, jaTransferido());

        for (const texto of ['e a cor?', 'e o prazo?', 'e a garantia?']) {
            await s.sistema.processarMensagem({ chatId: CHAT, texto, tipo: 'text' });
        }

        expect(s.store.leads.get(CHAT).conversaEncerrada).toBe(true);
        expect(s.axios.enviadas.at(-1).body).toContain('Nosso consultor assume');
    });
});
