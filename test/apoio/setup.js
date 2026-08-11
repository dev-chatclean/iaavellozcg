// =============================================================
//  SETUP GLOBAL DA SUITE
//  Roda antes de cada arquivo de teste (vitest.config.js).
//
//  O SDK da OpenAI e instanciado no topo do index.js e LANCA se a chave
//  nao existir. Definimos uma chave falsa para permitir importar o modulo
//  em teste — nenhuma chamada real e feita (os adapters sao falsificados).
// =============================================================

process.env.OPENAI_API_KEY = 'sk-teste-nao-usar';

// Garante que nenhum .env local vaze configuracao para a suite: os testes
// devem depender apenas do que definem explicitamente.
delete process.env.CC_PUSH_URL;
delete process.env.EQUIPE_NUMERO;
delete process.env.REDIS_URL;
delete process.env.IA_ALLOWED_CONTACTS;
delete process.env.WEBHOOK_SECRET;
delete process.env.ADMIN_KEY;
delete process.env.FERIADOS;
