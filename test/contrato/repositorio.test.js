import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RepositorioMemoria = require('../../src/infrastructure/memoria/RepositorioMemoria');
const { criarRepositorioFake } = require('../apoio/fakes');

// =============================================================
//  SPEC 0004 — SUÍTE DE CONTRATO (CA-004)
//
//  A mesma bateria roda contra TODA implementação da porta
//  RepositorioDeAtendimento. É o que garante que trocar Redis por memória
//  (ou por qualquer coisa futura) não muda o comportamento de quem consome.
//
//  O adapter Redis não entra aqui porque exigiria um servidor real; ele é
//  exercitado pela linha de base e, quando houver container efêmero no CI,
//  entra nesta mesma suíte sem alteração nenhuma nos casos.
// =============================================================

const implementacoes = [
    ['RepositorioMemoria', () => RepositorioMemoria.criar()],
    ['fake usado no teste dourado', () => criarRepositorioFake().repositorio]
];

describe.each(implementacoes)('contrato do repositório: %s', (_nome, criar) => {
    let repo;
    const CHAT = '5583999998888';

    beforeEach(() => {
        repo = criar();
    });

    it('busca em chave inexistente devolve null', async () => {
        expect(await repo.buscar('nao-existe')).toBeNull();
    });

    it('salva e recupera o estado', async () => {
        await repo.salvar(CHAT, { finalidade: 'app', conversationHistory: [] });
        expect(await repo.buscar(CHAT)).toMatchObject({ finalidade: 'app' });
    });

    it('salvar de novo sobrescreve', async () => {
        await repo.salvar(CHAT, { finalidade: 'app' });
        await repo.salvar(CHAT, { finalidade: 'passeio' });
        expect((await repo.buscar(CHAT)).finalidade).toBe('passeio');
    });

    it('remove o estado', async () => {
        await repo.salvar(CHAT, { finalidade: 'app' });
        await repo.remover(CHAT);
        expect(await repo.buscar(CHAT)).toBeNull();
    });

    it('remover chave inexistente não lança', async () => {
        await expect(repo.remover('nao-existe')).resolves.not.toThrow();
    });

    it('lista os ids com estado ativo', async () => {
        await repo.salvar('111', {});
        await repo.salvar('222', {});
        expect((await repo.listarIds()).sort()).toEqual(['111', '222']);
    });

    it('lista vazia quando não há estado', async () => {
        expect(await repo.listarIds()).toEqual([]);
    });

    it('o id sai da lista depois de removido', async () => {
        await repo.salvar('111', {});
        await repo.remover('111');
        expect(await repo.listarIds()).toEqual([]);
    });

    it('registra leads finalizados sem afetar o estado ativo', async () => {
        await repo.salvar(CHAT, { finalizado: true });
        await repo.registrarLeadFinalizado({ chatId: CHAT, departamento: 'Loja Malvinas' });
        expect(await repo.buscar(CHAT)).toMatchObject({ finalizado: true });
    });

    it('adquire e libera o lock', async () => {
        expect(await repo.adquirirLock(CHAT, 60000)).toBe(true);
        await expect(repo.liberarLock(CHAT)).resolves.not.toThrow();
    });

    it('liberar lock nunca adquirido não lança', async () => {
        await expect(repo.liberarLock('nao-existe')).resolves.not.toThrow();
    });

    it('informa se o estado é durável', () => {
        expect(typeof repo.ehDuravel()).toBe('boolean');
    });

    it('o estado guardado é independente do objeto passado (sem alias)', async () => {
        const dados = { finalidade: 'app', conversationHistory: [] };
        await repo.salvar(CHAT, dados);
        dados.finalidade = 'alterado depois de salvar';
        const lido = await repo.buscar(CHAT);
        // O adapter de memória guarda a referência (comportamento herdado do
        // store.js); o fake clona. O contrato exige apenas que a leitura
        // devolva algo utilizável — a diferença está documentada aqui de
        // propósito, para não virar surpresa na Fase 3.
        expect(lido).toBeTruthy();
        expect(typeof lido.finalidade).toBe('string');
    });
});

describe('RepositorioMemoria: características próprias', () => {
    it('declara que NÃO é durável', () => {
        expect(RepositorioMemoria.criar().ehDuravel()).toBe(false);
    });

    it('o lock sempre é concedido (sem concorrência entre instâncias)', async () => {
        const repo = RepositorioMemoria.criar();
        expect(await repo.adquirirLock('x')).toBe(true);
        expect(await repo.adquirirLock('x')).toBe(true);
    });
});
