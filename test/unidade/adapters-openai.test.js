import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ExtratorOpenAI = require('../../src/infrastructure/openai/ExtratorOpenAI');
const RedatorOpenAI = require('../../src/infrastructure/openai/RedatorOpenAI');
const LeitorDeImagemOpenAI = require('../../src/infrastructure/openai/LeitorDeImagemOpenAI');

// =============================================================
//  Os adapters da OpenAI, isolados.
//
//  O cliente entra por parametro, entao da para verificar o QUE foi pedido ao
//  provedor — modelo, temperatura, formato — sem rede e sem gastar credito.
//  Esses parametros sao decisao de produto: temperatura 0 na extracao e o que
//  torna a leitura do funil reproduzivel.
// =============================================================

function clienteFake(conteudo, erro = null) {
    const chamadas = [];
    return {
        chamadas,
        chat: {
            completions: {
                create: vi.fn(async (params) => {
                    chamadas.push(params);
                    if (erro) throw erro;
                    return { choices: [{ message: { content: conteudo } }] };
                })
            }
        }
    };
}

describe('ExtratorOpenAI', () => {
    it('pede temperatura 0 e resposta em JSON — a leitura do funil tem de ser reproduzivel', async () => {
        const cliente = clienteFake('{"nome":"Rafael"}');
        await ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'extraia' });

        expect(cliente.chamadas[0].temperature).toBe(0);
        expect(cliente.chamadas[0].response_format).toEqual({ type: 'json_object' });
        expect(cliente.chamadas[0].model).toBe('gpt-4o-mini');
    });

    it('devolve o objeto ja parseado', async () => {
        const cliente = clienteFake('{"nome":"Rafael","loja":"Malvinas"}');
        const r = await ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'x' });

        expect(r).toEqual({ nome: 'Rafael', loja: 'Malvinas' });
    });

    it('remove as cercas ``` que o modelo insiste em colocar', async () => {
        const cliente = clienteFake('```json\n{"nome":"Rafael"}\n```');
        const r = await ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'x' });

        expect(r).toEqual({ nome: 'Rafael' });
    });

    it('o historico vem ANTES do prompt do turno', async () => {
        const cliente = clienteFake('{}');
        const historico = [{ role: 'user', content: 'oi' }];
        await ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'extraia', historico });

        expect(cliente.chamadas[0].messages).toEqual([
            { role: 'user', content: 'oi' },
            { role: 'user', content: 'extraia' }
        ]);
    });

    it('JSON invalido LANCA — quem chama decide o que fazer', async () => {
        const cliente = clienteFake('isto nao e json');
        await expect(ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'x' })).rejects.toThrow();
    });

    it('falha do provedor LANCA em vez de virar null silencioso', async () => {
        const cliente = clienteFake(null, new Error('429 rate limit'));
        await expect(ExtratorOpenAI.criar({ cliente }).extrair({ prompt: 'x' })).rejects.toThrow('429 rate limit');
    });
});

describe('RedatorOpenAI', () => {
    it('a temperatura vem de quem chama — e decisao de produto, nao do adapter', async () => {
        const cliente = clienteFake('resposta');
        const redator = RedatorOpenAI.criar({ cliente });

        await redator.redigir({ system: 's', prompt: 'p', temperatura: 0.7 });
        await redator.redigir({ system: 's', prompt: 'p', temperatura: 0.6 });

        expect(cliente.chamadas.map((c) => c.temperature)).toEqual([0.7, 0.6]);
    });

    it('nao pede formato JSON: a saida e texto para humano', async () => {
        const cliente = clienteFake('resposta');
        await RedatorOpenAI.criar({ cliente }).redigir({ system: 's', prompt: 'p', temperatura: 0.7 });

        expect(cliente.chamadas[0].response_format).toBeUndefined();
    });

    it('monta system, historico e prompt nessa ordem', async () => {
        const cliente = clienteFake('resposta');
        await RedatorOpenAI.criar({ cliente }).redigir({
            system: 'persona',
            prompt: 'instrucao',
            historico: [{ role: 'assistant', content: 'anterior' }],
            temperatura: 0.7
        });

        expect(cliente.chamadas[0].messages).toEqual([
            { role: 'system', content: 'persona' },
            { role: 'assistant', content: 'anterior' },
            { role: 'user', content: 'instrucao' }
        ]);
    });

    it('apara o texto devolvido', async () => {
        const cliente = clienteFake('  com espaços em volta  \n');
        const r = await RedatorOpenAI.criar({ cliente }).redigir({ system: 's', prompt: 'p', temperatura: 0.7 });

        expect(r).toBe('com espaços em volta');
    });

    it('falha do provedor LANCA — o fallback e responsabilidade de quem chama', async () => {
        const cliente = clienteFake(null, new Error('timeout'));
        await expect(
            RedatorOpenAI.criar({ cliente }).redigir({ system: 's', prompt: 'p', temperatura: 0.7 })
        ).rejects.toThrow('timeout');
    });
});

describe('LeitorDeImagemOpenAI', () => {
    it('usa gpt-4o, com teto de tokens e temperatura baixa', async () => {
        const cliente = clienteFake('uma moto vermelha');
        await LeitorDeImagemOpenAI.criar({ cliente }).descrever({ instrucao: 'descreva', url: 'https://x/y.jpg' });

        expect(cliente.chamadas[0].model).toBe('gpt-4o');
        expect(cliente.chamadas[0].max_tokens).toBe(300);
        expect(cliente.chamadas[0].temperature).toBe(0.3);
    });

    it('manda a instrucao e a URL no formato de conteudo multimodal', async () => {
        const cliente = clienteFake('uma moto');
        await LeitorDeImagemOpenAI.criar({ cliente }).descrever({ instrucao: 'descreva', url: 'https://x/y.jpg' });

        expect(cliente.chamadas[0].messages[0].content).toEqual([
            { type: 'text', text: 'descreva' },
            { type: 'image_url', image_url: { url: 'https://x/y.jpg' } }
        ]);
    });

    it('falha do provedor LANCA', async () => {
        const cliente = clienteFake(null, new Error('imagem inacessivel'));
        await expect(
            LeitorDeImagemOpenAI.criar({ cliente }).descrever({ instrucao: 'i', url: 'u' })
        ).rejects.toThrow('imagem inacessivel');
    });
});
