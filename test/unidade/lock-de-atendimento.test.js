import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const LockDeAtendimento = require('../../src/application/atendimento/LockDeAtendimento');
const RepositorioMemoria = require('../../src/infrastructure/memoria/RepositorioMemoria');

// =============================================================
//  O lock de atendimento, isolado.
//
//  Dois niveis com regras diferentes, que antes eram 20 linhas soltas na
//  abertura do turno: um Map, um setTimeout de 60s e uma chamada ao Redis,
//  com tres pontos de saida.
// =============================================================

const CHAT = '5583999998888';

/** Repositorio com lock controlavel, para simular a outra instancia. */
function repositorioCom({ concede = true } = {}) {
    const base = RepositorioMemoria.criar();
    const liberados = [];
    return {
        ...base,
        liberados,
        acquireLock: vi.fn(async () => concede),
        releaseLock: vi.fn(async (chatId) => {
            liberados.push(chatId);
        })
    };
}

describe('lock: nivel local', () => {
    it('concede na primeira vez e marca como ocupado', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom() });

        expect(lock.ocupado(CHAT)).toBe(false);
        const trava = await lock.adquirir(CHAT);

        expect(trava.ok).toBe(true);
        expect(lock.ocupado(CHAT)).toBe(true);
    });

    it('RECUSA enquanto o mesmo cliente estiver sendo processado', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom() });
        await lock.adquirir(CHAT);

        const segunda = await lock.adquirir(CHAT);
        expect(segunda).toMatchObject({ ok: false, motivo: 'em_processamento' });
    });

    it('liberar a trava recusada por "em processamento" e inofensivo', async () => {
        // Importante: quem foi recusado NAO pode soltar o lock de quem esta
        // atendendo. As liberacoes desta trava sao no-op de proposito.
        const repo = repositorioCom();
        const lock = LockDeAtendimento.criar({ repositorio: repo });
        await lock.adquirir(CHAT);

        const recusada = await lock.adquirir(CHAT);
        recusada.liberarLocal();
        await recusada.liberarRemoto();

        expect(lock.ocupado(CHAT)).toBe(true); // o dono continua com o lock
        expect(repo.releaseLock).not.toHaveBeenCalled();
    });

    it('clientes diferentes nao se bloqueiam', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom() });
        expect((await lock.adquirir('A')).ok).toBe(true);
        expect((await lock.adquirir('B')).ok).toBe(true);
    });

    it('depois de liberado, concede de novo', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom() });
        const trava = await lock.adquirir(CHAT);
        trava.liberarLocal();

        expect(lock.ocupado(CHAT)).toBe(false);
        expect((await lock.adquirir(CHAT)).ok).toBe(true);
    });
});

describe('lock: nivel remoto (outra instancia)', () => {
    it('RECUSA quando o cluster ja concedeu a outra instancia', async () => {
        const repo = repositorioCom({ concede: false });
        const lock = LockDeAtendimento.criar({ repositorio: repo });

        const trava = await lock.adquirir(CHAT);
        expect(trava).toMatchObject({ ok: false, motivo: 'outra_instancia' });
    });

    it('a recusa remota SOLTA o lock local — senao o cliente ficaria mudo', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom({ concede: false }) });
        await lock.adquirir(CHAT);

        expect(lock.ocupado(CHAT)).toBe(false);
    });

    it('pede o lock remoto com o mesmo TTL do local', async () => {
        const repo = repositorioCom();
        const lock = LockDeAtendimento.criar({ repositorio: repo, ttlMs: 15000 });
        await lock.adquirir(CHAT);

        expect(repo.acquireLock).toHaveBeenCalledWith(CHAT, 15000);
    });

    it('liberarRemoto devolve o lock ao cluster', async () => {
        const repo = repositorioCom();
        const lock = LockDeAtendimento.criar({ repositorio: repo });
        const trava = await lock.adquirir(CHAT);

        await trava.liberarRemoto();
        expect(repo.liberados).toEqual([CHAT]);
    });

    it('as duas liberacoes sao independentes: local sai antes, remoto depois', async () => {
        const repo = repositorioCom();
        const lock = LockDeAtendimento.criar({ repositorio: repo });
        const trava = await lock.adquirir(CHAT);

        trava.liberarLocal();
        expect(lock.ocupado(CHAT)).toBe(false);
        expect(repo.releaseLock).not.toHaveBeenCalled();

        await trava.liberarRemoto();
        expect(repo.releaseLock).toHaveBeenCalled();
    });

    it('liberar uma trava RECUSADA nao faz nada nem lanca', async () => {
        const repo = repositorioCom({ concede: false });
        const lock = LockDeAtendimento.criar({ repositorio: repo });
        const trava = await lock.adquirir(CHAT);

        expect(() => trava.liberarLocal()).not.toThrow();
        await expect(trava.liberarRemoto()).resolves.not.toThrow();
        expect(repo.releaseLock).not.toHaveBeenCalled();
    });
});

describe('lock: temporizador de seguranca', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('um turno travado solta o lock sozinho, em vez de silenciar o cliente', async () => {
        const expirados = [];
        const lock = LockDeAtendimento.criar({
            repositorio: repositorioCom(),
            ttlMs: 60000,
            aoExpirar: (chatId) => expirados.push(chatId)
        });

        await lock.adquirir(CHAT);
        expect(lock.ocupado(CHAT)).toBe(true);

        await vi.advanceTimersByTimeAsync(60000);

        expect(lock.ocupado(CHAT)).toBe(false);
        expect(expirados).toEqual([CHAT]);
    });

    it('turno que termina no prazo NAO dispara o aviso de expiracao', async () => {
        const expirados = [];
        const lock = LockDeAtendimento.criar({
            repositorio: repositorioCom(),
            ttlMs: 60000,
            aoExpirar: (chatId) => expirados.push(chatId)
        });

        const trava = await lock.adquirir(CHAT);
        await vi.advanceTimersByTimeAsync(30000);
        trava.liberarLocal();

        await vi.advanceTimersByTimeAsync(60000);
        expect(expirados).toEqual([]);
    });

    it('antes do prazo o lock continua valendo', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: repositorioCom(), ttlMs: 60000 });
        await lock.adquirir(CHAT);

        await vi.advanceTimersByTimeAsync(59999);
        expect(lock.ocupado(CHAT)).toBe(true);
    });
});

describe('lock: integracao com o repositorio real', () => {
    it('com repositorio em memoria, o lock remoto sempre concede', async () => {
        const lock = LockDeAtendimento.criar({ repositorio: RepositorioMemoria.criar() });
        expect((await lock.adquirir(CHAT)).ok).toBe(true);
    });

    it('CONGELA (D-15): so o lock LOCAL protege quando nao ha Redis', async () => {
        // Duas instancias, cada uma com seu proprio lock local e um repositorio
        // em memoria que sempre concede: as duas processam o mesmo lead.
        const a = LockDeAtendimento.criar({ repositorio: RepositorioMemoria.criar() });
        const b = LockDeAtendimento.criar({ repositorio: RepositorioMemoria.criar() });

        expect((await a.adquirir(CHAT)).ok).toBe(true);
        expect((await b.adquirir(CHAT)).ok).toBe(true);
    });
});
