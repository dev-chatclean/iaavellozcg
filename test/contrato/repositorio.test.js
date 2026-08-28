import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RepositorioMemoria = require('../../src/infrastructure/memoria/RepositorioMemoria');
const RepositorioRedis = require('../../src/infrastructure/redis/RepositorioRedis');

// =============================================================
//  TESTE DE CONTRATO DO REPOSITORIO
//
//  A MESMA bateria roda contra os dois adapters. E isso que autoriza trocar um
//  pelo outro: se ambos passam, a aplicacao nao consegue distinguir qual esta
//  montado — que e a promessa inteira de uma porta.
//
//  Onde o comportamento DIVERGE, o teste diz isso em voz alta, em vez de
//  esconder atras de uma media.
// =============================================================

/** Redis falso, em cima de um Map. Cobre so os comandos que o adapter usa. */
function redisFake() {
    const dados = new Map();
    const listas = new Map();
    return {
        dados,
        listas,
        get: vi.fn(async (k) => (dados.has(k) ? dados.get(k) : null)),
        set: vi.fn(async (k, v, ...args) => {
            if (args.includes('NX') && dados.has(k)) return null;
            dados.set(k, v);
            return 'OK';
        }),
        del: vi.fn(async (k) => {
            dados.delete(k);
            return 1;
        }),
        rpush: vi.fn(async (k, v) => {
            if (!listas.has(k)) listas.set(k, []);
            listas.get(k).push(v);
            return listas.get(k).length;
        }),
        scan: vi.fn(async (_cursor, _m, padrao) => {
            const re = new RegExp('^' + padrao.replace('*', '.*') + '$');
            return ['0', [...dados.keys()].filter((k) => re.test(k))];
        })
    };
}

const CHAT = '5583999998888';
const LEAD = { nome: 'Rafael', loja: 'Malvinas', conversationHistory: [] };

const implementacoes = [
    ['memoria', () => RepositorioMemoria.criar()],
    [
        'redis',
        () =>
            RepositorioRedis.criar({
                redis: redisFake(),
                fallback: RepositorioMemoria.criar(),
                prefixo: 'teste'
            })
    ]
];

describe.each(implementacoes)('contrato do repositorio: %s', (_nome, montar) => {
    let repo;
    beforeEach(() => {
        repo = montar();
    });

    it('lead inexistente devolve null, nao lanca', async () => {
        expect(await repo.getLead('nao-existe')).toBeNull();
    });

    it('grava e le de volta', async () => {
        await repo.saveLead(CHAT, LEAD);
        expect(await repo.getLead(CHAT)).toEqual(LEAD);
    });

    it('sobrescreve o lead ja gravado', async () => {
        await repo.saveLead(CHAT, LEAD);
        await repo.saveLead(CHAT, { ...LEAD, loja: 'Monteiro' });
        expect((await repo.getLead(CHAT)).loja).toBe('Monteiro');
    });

    it('apaga', async () => {
        await repo.saveLead(CHAT, LEAD);
        await repo.deleteLead(CHAT);
        expect(await repo.getLead(CHAT)).toBeNull();
    });

    it('apagar o que nao existe nao lanca', async () => {
        await expect(repo.deleteLead('nao-existe')).resolves.not.toThrow();
    });

    it('lista os chatIds ativos', async () => {
        await repo.saveLead('5583911111111', LEAD);
        await repo.saveLead('5583922222222', LEAD);
        expect((await repo.scanLeadIds()).sort()).toEqual(['5583911111111', '5583922222222']);
    });

    it('a lista comeca vazia', async () => {
        expect(await repo.scanLeadIds()).toEqual([]);
    });

    it('o chatId volta da varredura sem o prefixo das chaves', async () => {
        await repo.saveLead(CHAT, LEAD);
        expect(await repo.scanLeadIds()).toEqual([CHAT]);
    });

    it('registra lead finalizado sem lancar', async () => {
        await expect(repo.appendLeadFinalizado({ chatId: CHAT, loja: 'Malvinas' })).resolves.not.toThrow();
    });

    it('concede o lock e libera', async () => {
        expect(await repo.acquireLock(CHAT)).toBe(true);
        await expect(repo.releaseLock(CHAT)).resolves.not.toThrow();
    });

    it('liberar lock que nao existe nao lanca', async () => {
        await expect(repo.releaseLock('nao-existe')).resolves.not.toThrow();
    });
});

// -------------------------------------------------------------
//  Onde os dois DIVERGEM — declarado, nao escondido.
// -------------------------------------------------------------
describe('contrato: divergencias conhecidas entre os adapters', () => {
    it('CONGELA (D-33): memoria devolve a REFERENCIA; Redis devolve copia', async () => {
        const memoria = RepositorioMemoria.criar();
        await memoria.saveLead(CHAT, { ...LEAD });
        const lido = await memoria.getLead(CHAT);
        lido.loja = 'mutado sem salvar';
        expect((await memoria.getLead(CHAT)).loja).toBe('mutado sem salvar');

        const redis = RepositorioRedis.criar({
            redis: redisFake(),
            fallback: RepositorioMemoria.criar(),
            prefixo: 'teste'
        });
        await redis.saveLead(CHAT, { ...LEAD });
        const lidoRedis = await redis.getLead(CHAT);
        lidoRedis.loja = 'mutado sem salvar';
        expect((await redis.getLead(CHAT)).loja).toBe('Malvinas');
    });

    it('so o Redis oferece lock cross-instancia; a memoria sempre concede', async () => {
        const memoria = RepositorioMemoria.criar();
        expect(await memoria.acquireLock(CHAT)).toBe(true);
        expect(await memoria.acquireLock(CHAT)).toBe(true); // concede de novo

        const redis = RepositorioRedis.criar({
            redis: redisFake(),
            fallback: RepositorioMemoria.criar(),
            prefixo: 'teste'
        });
        expect(await redis.acquireLock(CHAT)).toBe(true);
        expect(await redis.acquireLock(CHAT)).toBe(false); // ja tomado
    });

    it('isRedis distingue os dois', async () => {
        expect(RepositorioMemoria.criar().isRedis()).toBe(false);
        expect(
            RepositorioRedis.criar({
                redis: redisFake(),
                fallback: RepositorioMemoria.criar()
            }).isRedis()
        ).toBe(true);
    });
});

// -------------------------------------------------------------
//  O fallback do Redis, que antes era invisivel.
// -------------------------------------------------------------
describe('RepositorioRedis: fallback para memoria quando o Redis falha', () => {
    const quebrado = () => {
        const r = redisFake();
        const explode = async () => {
            throw new Error('ECONNREFUSED');
        };
        return { ...r, get: explode, set: explode, del: explode, rpush: explode, scan: explode };
    };

    let memoria;
    let repo;
    beforeEach(() => {
        memoria = RepositorioMemoria.criar();
        repo = RepositorioRedis.criar({ redis: quebrado(), fallback: memoria, prefixo: 'teste' });
    });

    it('saveLead cai na memoria em vez de perder o estado', async () => {
        await repo.saveLead(CHAT, LEAD);
        expect(await memoria.getLead(CHAT)).toEqual(LEAD);
    });

    it('getLead le da memoria', async () => {
        await memoria.saveLead(CHAT, LEAD);
        expect(await repo.getLead(CHAT)).toEqual(LEAD);
    });

    it('scanLeadIds cai na memoria', async () => {
        await memoria.saveLead(CHAT, LEAD);
        expect(await repo.scanLeadIds()).toEqual([CHAT]);
    });

    it('deleteLead e appendLeadFinalizado nao lancam', async () => {
        await expect(repo.deleteLead(CHAT)).resolves.not.toThrow();
        await expect(repo.appendLeadFinalizado({ chatId: CHAT })).resolves.not.toThrow();
    });

    it('o lock e FAIL-OPEN: Redis quebrado nao impede o atendimento', async () => {
        expect(await repo.acquireLock(CHAT)).toBe(true);
        await expect(repo.releaseLock(CHAT)).resolves.not.toThrow();
    });
});

// -------------------------------------------------------------
//  Detalhes do adapter de Redis que so ele tem.
// -------------------------------------------------------------
describe('RepositorioRedis: chaves e TTL', () => {
    it('usa o prefixo configurado nas chaves de lead, lista e lock', async () => {
        const redis = redisFake();
        const repo = RepositorioRedis.criar({ redis, fallback: RepositorioMemoria.criar(), prefixo: 'avellozcg' });

        await repo.saveLead(CHAT, LEAD);
        await repo.acquireLock(CHAT);
        await repo.appendLeadFinalizado({ chatId: CHAT });

        expect([...redis.dados.keys()]).toEqual([`avellozcg:lead:${CHAT}`, `avellozcg:lock:${CHAT}`]);
        expect([...redis.listas.keys()]).toEqual(['avellozcg:leads']);
    });

    it('grava o lead com TTL de 30 dias — conversa parada expira sozinha', async () => {
        const redis = redisFake();
        const repo = RepositorioRedis.criar({ redis, fallback: RepositorioMemoria.criar() });
        await repo.saveLead(CHAT, LEAD);

        expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60 * 60 * 24 * 30);
        expect(RepositorioRedis.TTL_PADRAO_SEG).toBe(2592000);
    });

    it('o lock usa SET NX PX com o TTL informado', async () => {
        const redis = redisFake();
        const repo = RepositorioRedis.criar({ redis, fallback: RepositorioMemoria.criar() });
        await repo.acquireLock(CHAT, 15000);

        expect(redis.set).toHaveBeenCalledWith(expect.any(String), '1', 'PX', 15000, 'NX');
    });
});
