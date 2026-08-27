import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../../src/main/config');

// =============================================================
//  Configuracao.
//
//  Estes testes congelam os PADROES. Um padrao errado aqui nao quebra nada
//  visivelmente — o sistema sobe e atende — mas muda o comportamento em
//  producao de um jeito que so aparece semanas depois, num caso raro.
//
//  O ambiente entra por parametro, entao da para testar sem tocar em
//  process.env.
// =============================================================

const vazio = () => config.carregar({});

describe('padroes quando nada e definido', () => {
    it('credenciais e destinos ficam vazios, nao inventados', () => {
        const c = vazio();
        expect(c.OPENAI_API_KEY).toBe('');
        expect(c.CC_PUSH_URL).toBe('');
        expect(c.WEBHOOK_SECRET).toBe('');
        expect(c.EQUIPE_NUMERO).toBe('');
        expect(c.ADMIN_KEY).toBe('');
    });

    it('a porta padrao e 3000', () => {
        expect(vazio().PORT).toBe(3000);
    });

    it('a allow-list vazia significa "responde a todos"', () => {
        expect(vazio().IA_ALLOWED_CONTACTS).toEqual([]);
    });

    it('grupos sao ignorados por padrao', () => {
        expect(vazio().IGNORAR_GRUPOS).toBe(true);
    });

    it('so tickets pendentes sao atendidos por padrao', () => {
        expect(vazio().IA_SO_PENDENTES).toBe(true);
    });

    it('a transferencia de departamento vem LIGADA; o fechamento do ticket, nao', () => {
        expect(vazio().TRANSFERIR_DEPARTAMENTO).toBe(true);
        expect(vazio().TRANSFERIR_FECHANDO).toBe(false);
    });

    it.each([
        ['RATE_LIMIT_MSGS', 20],
        ['LOOP_MAX_TURNOS', 15],
        ['MAX_RESPOSTAS_POS_HANDOFF', 3],
        ['AGRUPAR_MS', 2000]
    ])('%s tem padrao %i', (chave, esperado) => {
        expect(vazio()[chave]).toBe(esperado);
    });

    it('as janelas em minutos e horas viram milissegundos', () => {
        const c = vazio();
        expect(c.RATE_LIMIT_JANELA).toBe(60 * 1000); // 60s
        expect(c.LOOP_JANELA_MS).toBe(3 * 60 * 1000); // 3 min
        expect(c.RESET_INATIVIDADE).toBe(24 * 3600 * 1000); // 24h
    });
});

describe('leitura do ambiente', () => {
    it('os valores informados vencem os padroes', () => {
        const c = config.carregar({ PORT: '8080', ADMIN_KEY: 'segredo', EQUIPE_NUMERO: '5583900000000' });
        expect(c.PORT).toBe('8080');
        expect(c.ADMIN_KEY).toBe('segredo');
        expect(c.EQUIPE_NUMERO).toBe('5583900000000');
    });

    it('a allow-list e separada por virgula, com espacos e vazios descartados', () => {
        const c = config.carregar({ IA_ALLOWED_CONTACTS: ' 5583911111111 , ,5583922222222,' });
        expect(c.IA_ALLOWED_CONTACTS).toEqual(['5583911111111', '5583922222222']);
    });

    // ------------------------------------------------------------------
    //  Os interruptores nao sao simetricos, e isso e proposital: o que vem
    //  LIGADO por padrao so desliga com o texto exato "false"; o que vem
    //  DESLIGADO so liga com "true". Qualquer outro valor mantem o padrao,
    //  que e o comportamento seguro.
    // ------------------------------------------------------------------
    it.each(['false'])('IGNORAR_GRUPOS desliga com "%s"', (v) => {
        expect(config.carregar({ IGNORAR_GRUPOS: v }).IGNORAR_GRUPOS).toBe(false);
    });

    it.each(['', '0', 'nao', 'FALSE', 'no'])('IGNORAR_GRUPOS NAO desliga com "%s"', (v) => {
        expect(config.carregar({ IGNORAR_GRUPOS: v }).IGNORAR_GRUPOS).toBe(true);
    });

    it.each(['true'])('TRANSFERIR_FECHANDO liga com "%s"', (v) => {
        expect(config.carregar({ TRANSFERIR_FECHANDO: v }).TRANSFERIR_FECHANDO).toBe(true);
    });

    it.each(['1', 'sim', 'TRUE', 'yes'])('TRANSFERIR_FECHANDO NAO liga com "%s"', (v) => {
        expect(config.carregar({ TRANSFERIR_FECHANDO: v }).TRANSFERIR_FECHANDO).toBe(false);
    });

    it('rate limit em 0 desativa o limite', () => {
        expect(config.carregar({ RATE_LIMIT_MSGS: '0' }).RATE_LIMIT_MSGS).toBe(0);
    });
});

describe('CONGELA (D-35): valor invalido vira NaN em silencio', () => {
    // ------------------------------------------------------------------
    //  parseInt de texto nao numerico devolve NaN, e nada aqui reclama. O
    //  sistema sobe normalmente e so se comporta de forma estranha depois:
    //  uma janela NaN faz toda comparacao de tempo dar false.
    //
    //  Validar no boot e recusar subir e mudanca de comportamento — tem spec
    //  propria. Ate la, fica congelado.
    // ------------------------------------------------------------------
    it.each(['RATE_LIMIT_MSGS', 'LOOP_MAX_TURNOS', 'MAX_RESPOSTAS_POS_HANDOFF', 'AGRUPAR_MENSAGENS_MS'])(
        '%s com texto invalido vira NaN sem aviso',
        (chave) => {
            const c = config.carregar({ [chave]: 'vinte' });
            const valores = Object.values(c).filter((v) => typeof v === 'number');
            expect(valores.some(Number.isNaN)).toBe(true);
        }
    );

    it('uma janela NaN faz toda comparacao de tempo dar false', () => {
        const c = config.carregar({ LOOP_JANELA_MIN: 'tres' });
        expect(Number.isNaN(c.LOOP_JANELA_MS)).toBe(true);
        expect(1000 - 0 < c.LOOP_JANELA_MS).toBe(false);
    });
});

describe('o objeto de configuracao e imutavel', () => {
    it('congelado: ninguem muda a configuracao em tempo de execucao', () => {
        const c = vazio();
        expect(Object.isFrozen(c)).toBe(true);
    });

    it('duas leituras com ambientes diferentes nao se contaminam', () => {
        const a = config.carregar({ PORT: '1111' });
        const b = config.carregar({ PORT: '2222' });
        expect(a.PORT).toBe('1111');
        expect(b.PORT).toBe('2222');
    });
});
