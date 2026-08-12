import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const raiz = process.cwd();
const CanalDeTerminal = require('../../src/infrastructure/terminal/CanalDeTerminal');

// =============================================================
//  SPEC 0010 — guarda contra o retorno do D-04.
//
//  Historia: `index.js`, `test-chat.js` e `sim-lead.js` implementavam o mesmo
//  turno de conversa de tres jeitos diferentes, e ja divergiam entre si —
//  `test-chat` nao usava response_format json_object, `sim-lead` nao aplicava
//  tipoContato, e ambos ignoravam a reavaliacao de perfil. Os testers
//  validavam um comportamento que nao era o de producao: pior que nao ter
//  tester.
//
//  Estes testes nao verificam comportamento; verificam ESTRUTURA. Se alguem
//  reintroduzir logica de turno num tester, eles quebram.
// =============================================================

const TESTERS = ['test-chat.js', 'sim-lead.js'];

function fonte(arquivo) {
    return fs.readFileSync(path.join(raiz, arquivo), 'utf8');
}

describe.each(TESTERS)('%s nao reimplementa o turno', (arquivo) => {
    const codigo = fonte(arquivo);

    it('usa o caso de uso de producao', () => {
        expect(codigo).toContain('ProcessarMensagemRecebida');
        expect(codigo).toMatch(/atendimento\.processarMensagem\(/);
    });

    it('NAO chama a OpenAI diretamente', () => {
        expect(codigo).not.toMatch(/chat\.completions\.create/);
        expect(codigo).not.toMatch(/audio\.transcriptions/);
    });

    it('NAO monta prompts por conta propria', () => {
        expect(codigo).not.toMatch(/require\(['"]\.\/prompts['"]\)/);
        expect(codigo).not.toContain('promptResposta');
        expect(codigo).not.toContain('promptExtracao');
        expect(codigo).not.toContain('SYSTEM_SDR');
    });

    it('NAO reimplementa a maquina de estados nem o resumo', () => {
        expect(codigo).not.toContain('determinarProximoCampo');
        expect(codigo).not.toContain('aplicarCampos');
        expect(codigo).not.toContain('detectarPerfil');
        expect(codigo).not.toContain('LEAD QUALIFICADO');
    });

    it('monta as dependencias pelo container, sem duplicar a montagem', () => {
        expect(codigo).toContain("require('./src/main/container')");
        expect(codigo).toContain('container.criar(config');
    });
});

describe('CanalDeTerminal', () => {
    it('imprime a mensagem em vez de enviar, e registra o que saiu', async () => {
        const linhas = [];
        const canal = CanalDeTerminal.criar({ escrever: (t) => linhas.push(t), rotuloBot: 'bot' });

        await canal.enviarTexto('5583999998888', 'Oi! Como você se locomove hoje?');

        expect(linhas[0]).toBe('bot  > Oi! Como você se locomove hoje?');
        expect(canal.enviadas).toHaveLength(1);
    });

    it('mensagem vazia nao e enviada (mesma regra do canal real)', async () => {
        const canal = CanalDeTerminal.criar({ escrever: () => {} });
        expect(await canal.enviarTexto('x', '')).toBe(false);
        expect(await canal.enviarTexto('x', '   ')).toBe(false);
        expect(canal.enviadas).toHaveLength(0);
    });

    it('o resumo do transbordo aparece em destaque', async () => {
        const linhas = [];
        const canal = CanalDeTerminal.criar({ escrever: (t) => linhas.push(t) });

        await canal.publicarNoTicket('5583999998888', 'LEAD QUALIFICADO — Avelloz Campina');

        expect(linhas.join('\n')).toContain('RESUMO ENVIADO A EQUIPE');
        expect(canal.notas).toHaveLength(1);
    });

    it('implementa as duas portas que o caso de uso espera', () => {
        const canal = CanalDeTerminal.criar({ escrever: () => {} });
        for (const metodo of ['enviarTexto', 'enviarNotaInterna', 'publicarNoTicket', 'enviarParaEquipe']) {
            expect(typeof canal[metodo]).toBe('function');
        }
    });
});

describe('ClienteComContagem', () => {
    const { envolver } = require('../../src/infrastructure/openai/ClienteComContagem');

    it('acumula o consumo sem que o adapter perceba', async () => {
        const falso = {
            chat: {
                completions: {
                    create: async () => ({
                        choices: [{ message: { content: 'oi' } }],
                        usage: { prompt_tokens: 100, completion_tokens: 20 }
                    })
                }
            },
            audio: { transcriptions: { create: async () => ({ text: 'x' }) } }
        };

        const { cliente, contagem } = envolver(falso);
        await cliente.chat.completions.create({});
        await cliente.chat.completions.create({});

        expect(contagem.chamadas).toBe(2);
        expect(contagem.entrada).toBe(200);
        expect(contagem.saida).toBe(40);
        expect(contagem.custoEstimadoUsd()).toBeCloseTo((200 * 0.15) / 1e6 + (40 * 0.6) / 1e6, 8);
    });

    it('resposta sem usage nao quebra a contagem', async () => {
        const falso = {
            chat: { completions: { create: async () => ({ choices: [] }) } },
            audio: { transcriptions: { create: async () => ({ text: 'x' }) } }
        };
        const { cliente, contagem } = envolver(falso);
        await cliente.chat.completions.create({});
        expect(contagem.chamadas).toBe(1);
        expect(contagem.entrada).toBe(0);
    });
});
