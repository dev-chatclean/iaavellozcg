const js = require('@eslint/js');
const globals = require('globals');

// Fronteiras da arquitetura alvo (docs/10-arquitetura-alvo.md).
// Hoje em 'warn' porque src/ ainda quase nao existe; viram 'error' na Fase 2,
// quando os adapters passarem a ser o unico lugar com I/O.
const INFRA_PROIBIDA = ['openai', 'axios', 'ioredis', 'express', 'form-data', 'dotenv', 'fs', 'path'];

module.exports = [
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-console': 'off',
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            'no-var': 'error'
        }
    },
    {
        // O dominio nao pode conhecer infraestrutura (DIP).
        files: ['src/domain/**/*.js', 'src/application/**/*.js'],
        rules: {
            'no-restricted-imports': ['warn', { paths: INFRA_PROIBIDA }],
            'no-restricted-globals': ['warn', 'process']
        }
    },
    {
        // RATCHET DO LEGADO (SPEC 0001).
        // A Fase 0 e zero-mudanca-de-comportamento: nao corrigimos o legado agora.
        // Estes arquivos ficam em 'warn' e SAEM desta lista conforme cada um e
        // estrangulado. A lista so encolhe — nunca adicione arquivo novo aqui.
        // Achados atuais estao catalogados em docs/09-divida-tecnica.md (D-11, D-24, D-28).
        files: [
            'index.js',
            'prompts.js',
            'data.js',
            'flow.js',
            'store.js',
            'horario.js',
            'pipeline.js',
            'test-chat.js',
            'sim-lead.js'
        ],
        rules: {
            'no-unused-vars': 'warn',
            'no-empty': 'warn'
        }
    },
    {
        files: ['test/**/*.js', 'vitest.config.js'],
        languageOptions: {
            sourceType: 'module',
            globals: { ...globals.node }
        }
    },
    {
        ignores: ['node_modules/', 'coverage/', 'prints/', 'test/baseline/*.log']
    }
];
