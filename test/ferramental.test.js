import { describe, it, expect } from 'vitest';

// Teste trivial: prova que a suite roda (SPEC 0001, PR1).
// Mantido como sentinela do setup — se ele falhar, o problema e o ferramental,
// nao o codigo de producao.
describe('ferramental da suite', () => {
    it('executa testes', () => {
        expect(true).toBe(true);
    });

    it('carrega o setup global (chave falsa da OpenAI definida)', () => {
        expect(process.env.OPENAI_API_KEY).toBe('sk-teste-nao-usar');
    });

    it('nao herda configuracao do .env local', () => {
        expect(process.env.CC_PUSH_URL).toBeUndefined();
        expect(process.env.REDIS_URL).toBeUndefined();
    });
});
