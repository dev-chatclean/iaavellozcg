import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FilaDeTurnos = require('../../src/application/fila/FilaDeTurnos');

// =============================================================
//  A fila de turnos, isolada.
//
//  Antes esse mecanismo so era observavel de dentro do teste dourado, com
//  temporizadores reais e o turno inteiro rodando. Aqui da para verificar o
//  que ele promete — nada e descartado, texto agrupa, midia nao espera — com
//  relogio falso e em milissegundos.
// =============================================================

const CHAT = '5583999998888';
const texto = (t, extra = {}) => ({ chatId: CHAT, tipo: 'text', texto: t, msgId: t, ...extra });
const midia = (tipo = 'image') => ({ chatId: CHAT, tipo, texto: '', msgId: tipo, mediaUrl: 'https://x/m' });

describe('proximaUnidade: agrupamento', () => {
    it('junta textos consecutivos numa mensagem so, separados por quebra de linha', () => {
        const fila = [texto('oi'), texto('queria uma moto'), texto('pra trabalhar')];
        const turno = FilaDeTurnos.proximaUnidade(fila);

        expect(turno.texto).toBe('oi\nqueria uma moto\npra trabalhar');
        expect(fila).toHaveLength(0);
    });

    it('para de agrupar quando encontra midia', () => {
        const fila = [texto('olha isso'), midia('image'), texto('viu?')];
        const turno = FilaDeTurnos.proximaUnidade(fila);

        expect(turno.texto).toBe('olha isso');
        expect(fila).toHaveLength(2);
        expect(fila[0].tipo).toBe('image');
    });

    it('midia no inicio sai sozinha, sem agrupar nada', () => {
        const fila = [midia('audio'), texto('era isso')];
        const turno = FilaDeTurnos.proximaUnidade(fila);

        expect(turno.tipo).toBe('audio');
        expect(fila).toHaveLength(1);
    });

    it('os msgId agrupados sao preservados, separados por virgula', () => {
        const turno = FilaDeTurnos.proximaUnidade([texto('a'), texto('b')]);
        expect(turno.msgId).toBe('a,b');
    });

    it('mensagem vazia nao entra no texto, mas o id continua contando', () => {
        const fila = [texto('', { msgId: 'M1' }), texto('oi', { msgId: 'M2' })];
        const turno = FilaDeTurnos.proximaUnidade(fila);

        expect(turno.texto).toBe('oi');
        expect(turno.msgId).toBe('M1,M2');
    });

    it('vence o PRIMEIRO valor nao vazio de nome, citacao e contactId', () => {
        const fila = [
            texto('oi', { nomeContato: '', contactId: null }),
            texto('sou o Rafael', { nomeContato: 'Rafael', contactId: 501, quotedText: 'citada' }),
            texto('mais', { nomeContato: 'Outro', contactId: 999, quotedText: 'outra' })
        ];
        const turno = FilaDeTurnos.proximaUnidade(fila);

        expect(turno.nomeContato).toBe('Rafael');
        expect(turno.contactId).toBe(501);
        expect(turno.quotedText).toBe('citada');
    });

    it('o turno agrupado nao carrega midia', () => {
        const turno = FilaDeTurnos.proximaUnidade([texto('a')]);
        expect(turno.mediaUrl).toBeNull();
        expect(turno.mediaBase64).toBeNull();
        expect(turno.mediaMimetype).toBeNull();
    });
});

describe('fila: agrupamento por janela', () => {
    let processados;
    let fila;

    beforeEach(() => {
        vi.useFakeTimers();
        processados = [];
        fila = FilaDeTurnos.criar({
            processarTurno: async (t) => {
                processados.push(t);
            },
            estaProcessando: () => false,
            janelaDeAgrupamentoMs: 2000
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('texto espera a janela antes de virar turno', async () => {
        fila.enfileirar(texto('oi'));
        expect(processados).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(2000);
        expect(processados).toHaveLength(1);
    });

    it('cada texto novo REINICIA a janela: tres mensagens rapidas viram um turno', async () => {
        fila.enfileirar(texto('oi'));
        await vi.advanceTimersByTimeAsync(1500);
        fila.enfileirar(texto('queria uma moto'));
        await vi.advanceTimersByTimeAsync(1500);
        fila.enfileirar(texto('pra trabalhar'));

        expect(processados).toHaveLength(0); // ainda esperando
        await vi.advanceTimersByTimeAsync(2000);

        expect(processados).toHaveLength(1);
        expect(processados[0].texto).toBe('oi\nqueria uma moto\npra trabalhar');
    });

    it('midia NAO espera a janela — mas tambem NAO fura a fila', async () => {
        fila.enfileirar(texto('olha'));
        fila.enfileirar(midia('image'));

        // Sem avancar o relogio: a midia disparou a drenagem, e a drenagem
        // processa a fila INTEIRA em ordem. O texto que estava esperando sai
        // primeiro; a midia logo depois.
        await vi.advanceTimersByTimeAsync(0);

        expect(processados.map((p) => p.tipo)).toEqual(['text', 'image']);
        expect(processados[0].texto).toBe('olha');
    });

    it('a janela cancelada pela midia nao dispara um turno vazio depois', async () => {
        fila.enfileirar(texto('olha'));
        fila.enfileirar(midia('image'));
        await vi.advanceTimersByTimeAsync(0);
        const antes = processados.length;

        await vi.advanceTimersByTimeAsync(10000);
        expect(processados).toHaveLength(antes);
    });

    it('o chatId e preenchido no turno entregue', async () => {
        fila.enfileirar(texto('oi'));
        await vi.advanceTimersByTimeAsync(2000);
        expect(processados[0].chatId).toBe(CHAT);
    });
});

describe('fila: nada e descartado', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('mensagem que chega DURANTE o processamento e drenada em seguida', async () => {
        const processados = [];
        let ocupado = false;
        const fila = FilaDeTurnos.criar({
            estaProcessando: () => ocupado,
            janelaDeAgrupamentoMs: 10,
            processarTurno: async (t) => {
                ocupado = true;
                processados.push(t);
                // Chega mensagem nova no meio do turno.
                if (processados.length === 1) fila.enfileirar(midia('audio'));
                ocupado = false;
            }
        });

        fila.enfileirar(midia('image'));
        await vi.advanceTimersByTimeAsync(50);

        expect(processados.map((p) => p.tipo)).toEqual(['image', 'audio']);
        expect(fila.pendentes(CHAT)).toBe(0);
    });

    it('com o lock tomado, a mensagem FICA na fila em vez de sumir', async () => {
        const processados = [];
        const fila = FilaDeTurnos.criar({
            processarTurno: async (t) => processados.push(t),
            estaProcessando: () => true, // sempre ocupado
            janelaDeAgrupamentoMs: 10
        });

        fila.enfileirar(midia('image'));
        await vi.advanceTimersByTimeAsync(50);

        expect(processados).toHaveLength(0);
        expect(fila.pendentes(CHAT)).toBe(1);
    });

    it('falha ao processar NAO trava a fila: o proximo turno segue', async () => {
        const processados = [];
        const falhas = [];
        const fila = FilaDeTurnos.criar({
            estaProcessando: () => false,
            janelaDeAgrupamentoMs: 10,
            aoFalhar: (e, chatId) => falhas.push({ mensagem: e.message, chatId }),
            processarTurno: async (t) => {
                processados.push(t);
                if (processados.length === 1) throw new Error('openai fora do ar');
            }
        });

        fila.enfileirar(midia('image'));
        await vi.advanceTimersByTimeAsync(20);
        fila.enfileirar(midia('audio'));
        await vi.advanceTimersByTimeAsync(20);

        expect(falhas).toEqual([{ mensagem: 'openai fora do ar', chatId: CHAT }]);
        expect(processados).toHaveLength(2);
    });

    it('clientes diferentes tem filas independentes', async () => {
        const processados = [];
        const fila = FilaDeTurnos.criar({
            processarTurno: async (t) => processados.push(t.chatId),
            estaProcessando: () => false,
            janelaDeAgrupamentoMs: 10
        });

        fila.enfileirar({ chatId: 'A', tipo: 'image', mediaUrl: 'u' });
        fila.enfileirar({ chatId: 'B', tipo: 'image', mediaUrl: 'u' });
        await vi.advanceTimersByTimeAsync(20);

        expect(processados.sort()).toEqual(['A', 'B']);
    });

    it('drenar fila vazia nao lanca', async () => {
        const fila = FilaDeTurnos.criar({
            processarTurno: async () => {},
            estaProcessando: () => false
        });
        await expect(fila.drenar('ninguem')).resolves.not.toThrow();
    });
});

describe('fila: padroes', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sem aoFalhar, a falha e engolida em silencio e a fila continua', async () => {
        const processados = [];
        const fila = FilaDeTurnos.criar({
            estaProcessando: () => false,
            janelaDeAgrupamentoMs: 10,
            processarTurno: async (t) => {
                processados.push(t);
                if (processados.length === 1) throw new Error('sem tratador');
            }
        });

        fila.enfileirar(midia('image'));
        await vi.advanceTimersByTimeAsync(20);
        fila.enfileirar(midia('audio'));
        await vi.advanceTimersByTimeAsync(20);

        expect(processados).toHaveLength(2);
    });

    it('sem janela informada, usa o padrao de 2s', async () => {
        const processados = [];
        const fila = FilaDeTurnos.criar({
            processarTurno: async (t) => processados.push(t),
            estaProcessando: () => false
        });

        fila.enfileirar(texto('oi'));
        await vi.advanceTimersByTimeAsync(FilaDeTurnos.JANELA_PADRAO_MS - 1);
        expect(processados).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(processados).toHaveLength(1);
    });
});
