import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// =============================================================
//  OS TESTERS NAO PODEM TER A PROPRIA COPIA DO ATENDIMENTO
//
//  Ate esta fatia, test-chat.js e sim-lead.js reimplementavam o turno:
//  montavam o proprio cliente da OpenAI, o proprio prompt e o proprio loop.
//  As duas implementacoes divergiram em silencio — a copia dos testers nao
//  passava o expediente ao prompt e citava um departamento que nao existe
//  mais.
//
//  O efeito e pior do que codigo duplicado: `npm run chat` passou a validar
//  OUTRO sistema. Quem conferisse uma mudanca de prompt por ali estaria
//  conferindo algo que nao roda em producao.
//
//  Estes testes existem para isso nao voltar. Sao de FONTE, nao de execucao:
//  rodar os testers de verdade gastaria credito da OpenAI.
// =============================================================

const TESTERS = ['test-chat.js', 'sim-lead.js'];

const fonte = (arquivo) => readFileSync(new URL('../../' + arquivo, import.meta.url), 'utf8');

/** Linhas de codigo, sem comentarios — para nao acusar mencao em comentario. */
const codigo = (arquivo) =>
    fonte(arquivo)
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

describe.each(TESTERS)('%s usa o atendimento de producao', (arquivo) => {
    it('monta o caso de uso pelo composition root', () => {
        expect(codigo(arquivo)).toContain("require('./src/main/container')");
    });

    it('NAO instancia o proprio cliente da OpenAI', () => {
        expect(codigo(arquivo)).not.toMatch(/new OpenAI\s*\(/);
        expect(codigo(arquivo)).not.toMatch(/require\(['"]openai['"]\)/);
    });

    it('NAO monta prompt por conta propria', () => {
        expect(codigo(arquivo)).not.toMatch(/promptResposta|promptExtracao|SYSTEM_SDR/);
    });

    it('NAO reimplementa o funil', () => {
        expect(codigo(arquivo)).not.toMatch(/determinarProximoCampo|aplicarCampos|detectarPerfil/);
    });

    it('NAO decide transbordo por conta propria', () => {
        expect(codigo(arquivo)).not.toMatch(/lojaParaDepartamento|DEPARTAMENTOS\./);
    });

    it('troca APENAS o canal de saida', () => {
        const c = codigo(arquivo);
        expect(c).toContain('CanalDeTerminal');
        expect(c).toMatch(/criar\(config,\s*\{\s*canal\s*\}\)/);
    });

    it('nao deixa nada sair para o mundo: sem push e sem Redis', () => {
        const c = codigo(arquivo);
        expect(c).toMatch(/CC_PUSH_URL:\s*''/);
        expect(c).toMatch(/REDIS_URL:\s*''/);
    });
});

describe('o container aceita a troca de canal', () => {
    it('sobrescrever o canal nao exige mexer em nada mais', () => {
        const container = require('../../src/main/container');
        const config = require('../../src/main/config').carregar({ OPENAI_API_KEY: 'sk-teste' });
        const canalFalso = { configurado: () => true, enviar: async () => ({ ok: true }) };

        const montado = container.criar(config, { canal: canalFalso });

        expect(typeof montado.processarMensagem).toBe('function');
        expect(typeof montado.enviarMensagem).toBe('function');
    });

    it('sem sobrescrita, o canal padrao continua sendo o do ChatClean', async () => {
        const container = require('../../src/main/container');
        const config = require('../../src/main/config').carregar({ OPENAI_API_KEY: 'sk-teste' });

        const montado = container.criar(config);
        // Sem CC_PUSH_URL, o canal real recusa e diz por que.
        expect(await montado.enviarMensagem('5583999998888', 'oi')).toBe(false);
    });
});

describe('CanalDeTerminal distingue os tres tipos de trafego', () => {
    const CanalDeTerminal = require('../../src/infrastructure/terminal/CanalDeTerminal');

    it('mensagem ao cliente, nota interna e transferencia nao se confundem', async () => {
        const linhas = [];
        const canal = CanalDeTerminal.criar({ escrever: (l) => linhas.push(l) });

        await canal.enviar('5583999998888', { body: 'oi, tudo bem?' });
        await canal.enviar('5583999998888', { body: 'RESUMO DO LEAD', onlyNote: true });
        await canal.enviar('5583999998888', { body: 'nota', onlyNote: true, forceTicketToDepartment: true, queueId: 230 });

        expect(canal.mensagens()).toEqual(['oi, tudo bem?']);
        expect(canal.notas()).toEqual(['RESUMO DO LEAD']);
        expect(canal.transferencias()).toEqual([
            { numero: '5583999998888', tipo: 'transferencia', body: 'nota', queueId: 230 }
        ]);
    });

    it('a nota interna sai MARCADA, para nao parecer mensagem ao cliente', async () => {
        const linhas = [];
        const canal = CanalDeTerminal.criar({ escrever: (l) => linhas.push(l) });
        await canal.enviar('5583999998888', { body: 'RESUMO', onlyNote: true });

        expect(linhas.join('\n')).toContain('o cliente NAO ve');
    });

    it('mostrarInterno=false esconde nota e transferencia da tela, mas registra', async () => {
        const linhas = [];
        const canal = CanalDeTerminal.criar({ escrever: (l) => linhas.push(l), mostrarInterno: false });

        await canal.enviar('5583999998888', { body: 'RESUMO', onlyNote: true });
        expect(linhas).toEqual([]);
        expect(canal.notas()).toEqual(['RESUMO']);
    });

    it('o terminal sempre aceita: nao ha rede para falhar', async () => {
        const canal = CanalDeTerminal.criar({ escrever: () => {} });
        expect(await canal.enviar('5583999998888', { body: 'oi' })).toMatchObject({ ok: true });
        expect(canal.configurado()).toBe(true);
    });
});
