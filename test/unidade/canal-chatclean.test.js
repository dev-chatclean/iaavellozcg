import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const CanalChatClean = require('../../src/infrastructure/chatclean/CanalChatClean');

// =============================================================
//  O adapter do canal, testado em ISOLAMENTO.
//
//  Nao ha require.cache manipulado, nao ha index.js carregado, nao ha axios.
//  O cliente HTTP entra por parametro — que e o ponto inteiro de existir uma
//  porta. Compare com test/apoio/fakes.js, que precisa pre-popular o cache do
//  Node para conseguir a mesma coisa no codigo legado.
// =============================================================

const PUSH_URL = 'https://fake.chatclean/v1/api/external/uuid/?token=JWT';

function httpFake({ resposta = { status: 200, data: { ok: true } }, erro = null } = {}) {
    const posts = [];
    return {
        posts,
        post: vi.fn(async (url, corpo, config) => {
            posts.push({ url, corpo, config });
            if (erro) throw erro;
            return resposta;
        })
    };
}

const canalCom = (http, extra = {}) =>
    CanalChatClean.criar({ http, pushUrl: PUSH_URL, gerarChave: () => 'chave-fixa', ...extra });

describe('CanalChatClean: envio bem-sucedido', () => {
    it('devolve ok com o status e o corpo crus do CRM', async () => {
        const http = httpFake({ resposta: { status: 201, data: { id: 9 } } });
        const r = await canalCom(http).enviar('5583999998888', { body: 'oi' });

        expect(r).toEqual({ ok: true, status: 201, data: { id: 9 } });
    });

    it('normaliza o telefone e acrescenta a chave de idempotencia', async () => {
        const http = httpFake();
        await canalCom(http).enviar('558491756446:24@s.whatsapp.net', { body: 'oi' });

        expect(http.posts[0].corpo).toEqual({
            number: '558491756446',
            externalKey: 'chave-fixa',
            body: 'oi'
        });
    });

    it('o payload extra passa inteiro — inclusive os campos de transferencia', async () => {
        const http = httpFake();
        await canalCom(http).enviar('5583999998888', {
            body: 'nota',
            onlyNote: true,
            forceTicketToDepartment: true,
            queueId: 230
        });

        expect(http.posts[0].corpo).toMatchObject({
            onlyNote: true,
            forceTicketToDepartment: true,
            queueId: 230
        });
    });

    it('posta na URL configurada, com timeout e content-type', async () => {
        const http = httpFake();
        await canalCom(http).enviar('5583999998888', { body: 'oi' });

        expect(http.posts[0].url).toBe(PUSH_URL);
        expect(http.posts[0].config.timeout).toBe(30000);
        expect(http.posts[0].config.headers['Content-Type']).toBe('application/json');
    });

    it('cada envio gera uma chave nova quando nao ha gerador fixo', async () => {
        const http = httpFake();
        const canal = CanalChatClean.criar({ http, pushUrl: PUSH_URL });
        await canal.enviar('5583999998888', { body: 'a' });
        await canal.enviar('5583999998888', { body: 'b' });

        expect(http.posts[0].corpo.externalKey).not.toBe(http.posts[1].corpo.externalKey);
    });
});

describe('CanalChatClean: sem credencial', () => {
    const semUrl = (http) => CanalChatClean.criar({ http, pushUrl: '' });

    it('configurado() responde false', () => {
        expect(semUrl(httpFake()).configurado()).toBe(false);
        expect(canalCom(httpFake()).configurado()).toBe(true);
    });

    it('nao chega a chamar o transporte', async () => {
        const http = httpFake();
        await semUrl(http).enviar('5583999998888', { body: 'oi' });
        expect(http.post).not.toHaveBeenCalled();
    });

    it('devolve o motivo, sem lancar', async () => {
        const r = await semUrl(httpFake()).enviar('5583999998888', { body: 'oi' });
        expect(r).toEqual({ ok: false, erro: 'CC_PUSH_URL ausente' });
    });
});

describe('CanalChatClean: falha do transporte', () => {
    it('erro de rede vira ok:false com a mensagem, sem lancar', async () => {
        const http = httpFake({ erro: new Error('socket hang up') });
        const r = await canalCom(http).enviar('5583999998888', { body: 'oi' });

        expect(r.ok).toBe(false);
        expect(r.erro).toBe('socket hang up');
    });

    it('resposta de erro do CRM preserva status e corpo, para diagnostico', async () => {
        const erro = new Error('Request failed');
        erro.response = { status: 422, data: { erro: 'queueId inválido' } };
        const r = await canalCom(httpFake({ erro })).enviar('5583999998888', { queueId: 999 });

        expect(r).toEqual({
            ok: false,
            status: 422,
            data: { erro: 'queueId inválido' },
            erro: 'Request failed'
        });
    });
});
