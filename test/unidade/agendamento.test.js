import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

// =============================================================
//  GUARDA DA COSTURA DE INICIALIZACAO
//
//  Importar o index.js NAO pode ter efeito colateral no processo: sem abrir
//  porta, sem agendar timer. Tudo isso vive em iniciar(), chamada so quando o
//  arquivo roda direto.
//
//  O segundo teste existe por causa de um defeito REAL cometido na primeira
//  refatoracao deste projeto: ao mover o varredor de follow-up para dentro de
//  iniciar(), a chamada antiga ficou no lugar. Em producao o varredor rodava
//  DUAS vezes, e o cliente podia receber a mensagem de reativacao em dobro.
//  Passou despercebido porque nada quebra — so duplica.
// =============================================================

describe('inicializacao: importar o modulo nao tem efeito colateral', () => {
    it('nao sobe servidor nem agenda timer ao ser importado', () => {
        require('../../index.js');

        const ativos = process._getActiveHandles();
        expect(ativos.filter((h) => h.constructor.name === 'Server')).toHaveLength(0);
        expect(ativos.filter((h) => h.constructor.name === 'Timeout')).toHaveLength(0);
    });

    it('exporta iniciar() e o handler do webhook para a suite', () => {
        const modulo = require('../../index.js');
        expect(typeof modulo.iniciar).toBe('function');
        expect(typeof modulo.handleWebhook).toBe('function');
        expect(typeof modulo.processarMensagem).toBe('function');
        expect(modulo.app).toBeTruthy();
    });
});

describe('inicializacao: o varredor de follow-up e agendado UMA unica vez', () => {
    const fonte = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');

    it('existe exatamente uma chamada de setInterval para varrerFollowUps', () => {
        const chamadas = fonte.match(/setInterval\(\s*varrerFollowUps/g) || [];
        expect(chamadas).toHaveLength(1);
    });

    it('essa chamada esta dentro de iniciar(), nao no escopo do modulo', () => {
        const posInterval = fonte.indexOf('setInterval(varrerFollowUps');
        const posIniciar = fonte.indexOf('function iniciar()');
        expect(posIniciar).toBeGreaterThan(-1);
        expect(posInterval).toBeGreaterThan(posIniciar);
    });
});
