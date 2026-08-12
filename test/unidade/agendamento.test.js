import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(process.cwd());

// =============================================================
//  REGRESSAO — o varredor de follow-up deve ser agendado UMA VEZ.
//
//  Historia deste teste: ao tornar o index.js importavel (SPEC 0001, PR4), o
//  bootstrap foi movido para iniciar() — mas o `setInterval` do varredor ficou
//  TAMBEM no nivel do modulo. Resultado: rodando `node index.js`, o varredor
//  era agendado duas vezes, e dois timers podiam disparar o mesmo follow-up
//  em corrida, mandando a mensagem de reativacao duplicada ao cliente.
//
//  Nenhum teste pegou porque o teste dourado chama varrerFollowUps()
//  diretamente, sem depender do timer, e a linha de base nao espera 2 minutos.
//  Corrigido na SPEC 0008; este teste existe para nao voltar.
// =============================================================

describe('agendamento do varredor de follow-up', () => {
    let setIntervalOriginal;
    let agendamentos;

    beforeEach(() => {
        agendamentos = [];
        setIntervalOriginal = globalThis.setInterval;
        globalThis.setInterval = (fn, ms, ...args) => {
            agendamentos.push({ ms, nome: fn?.name || '(anonima)' });
            const id = setIntervalOriginal(fn, ms, ...args);
            if (id && typeof id.unref === 'function') id.unref();
            clearInterval(id);
            return id;
        };
        process.env.OPENAI_API_KEY = 'sk-teste';
        delete require.cache[require.resolve(path.join(raiz, 'index.js'))];
    });

    afterEach(() => {
        globalThis.setInterval = setIntervalOriginal;
        delete require.cache[require.resolve(path.join(raiz, 'index.js'))];
    });

    it('importar o modulo NAO agenda nenhum timer', () => {
        require(path.join(raiz, 'index.js'));
        expect(agendamentos).toEqual([]);
    });

    it('o codigo-fonte agenda o varredor em um unico lugar', () => {
        const fs = require('fs');
        const fonte = fs.readFileSync(path.join(raiz, 'index.js'), 'utf8');
        const ocorrencias = fonte.match(/setInterval\(varrerFollowUps/g) || [];
        expect(ocorrencias).toHaveLength(1);
    });
});
