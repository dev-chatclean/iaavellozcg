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
            excludeAfterRemap: true,
            thresholds: {
                // Ligados progressivamente ao longo dos PRs da Fase 0 (T34).
                lines: 70,
                functions: 70,
                statements: 70,
                branches: 60
            }
        }
    }
});
