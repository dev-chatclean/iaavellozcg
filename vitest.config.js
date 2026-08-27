import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.js'],
        setupFiles: ['test/apoio/setup.js'],
        // A suite NAO pode fazer chamada de rede nem esperar tempo real (SPEC 0001, CA-001).
        testTimeout: 5000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            all: true,
            include: ['flow.js', 'horario.js', 'data.js', 'src/**/*.js'],
            // portas/ so tem typedef JSDoc: nao ha codigo para exercitar, e
            // conta-lo como 0% falsearia o numero para baixo.
            exclude: ['src/application/portas/**'],
            excludeAfterRemap: true,
            thresholds: {
                // Ratchet: os modulos puros estao em 100% de statements e 99%
                // de ramos. O piso fica logo abaixo para dar folga ao src/ que
                // vai nascer, mas alto o bastante para barrar regressao.
                lines: 95,
                functions: 95,
                statements: 95,
                branches: 90
            }
        }
    }
});
