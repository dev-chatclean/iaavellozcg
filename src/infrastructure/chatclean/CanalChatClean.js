// =============================================================
//  CANAL CHATCLEAN (SPEC 0004)
//
//  Implementa as portas CanalDeMensagem e NotificadorDeEquipe sobre a Push
//  API do ChatClean. Um único endpoint autenticado (CC_PUSH_URL) entrega as
//  mensagens; o token JWT já vem embutido na URL como ?token=.
//
//  Extraído de index.js (ccPush / enviarMensagem / parte de notificarEquipe)
//  sem alteração de comportamento: mesmos campos, mesmo timeout, mesmo
//  tratamento de erro (nunca lança — loga e devolve false).
// =============================================================

const axios = require('axios');
const crypto = require('crypto');
const { normalizarPhone } = require('../../shared/telefone');

/**
 * @param {object} deps
 * @param {string} deps.urlDePush      CC_PUSH_URL
 * @param {string} deps.numeroDaEquipe EQUIPE_NUMERO (pode ser vazio)
 * @param {number} [deps.timeoutMs]
 */
function criar({ urlDePush, numeroDaEquipe = '', timeoutMs = 30000 } = {}) {
    async function empurrar(numero, extra = {}) {
        if (!urlDePush) {
            console.warn('⚠️ CC_PUSH_URL não configurado no .env — envio ignorado');
            return false;
        }
        try {
            await axios.post(
                urlDePush,
                {
                    number: normalizarPhone(numero),
                    externalKey: crypto.randomUUID(),
                    ...extra
                },
                { headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs }
            );
            return true;
        } catch (e) {
            console.error('❌ Erro no Push ChatClean:', e.response?.data || e.message);
            return false;
        }
    }

    return {
        // --- CanalDeMensagem ---
        async enviarTexto(chatId, texto) {
            if (!texto || !String(texto).trim()) return false;
            return empurrar(chatId, { body: texto });
        },

        async enviarNotaInterna(chatId, texto) {
            return empurrar(chatId, { body: texto, onlyNote: true, note: { body: texto } });
        },

        // --- NotificadorDeEquipe ---
        async publicarNoTicket(chatId, resumo) {
            await empurrar(chatId, { body: resumo, onlyNote: true, note: { body: resumo } });
        },

        async enviarParaEquipe(resumo) {
            if (!numeroDaEquipe) return;
            await empurrar(numeroDaEquipe, { body: resumo });
        },

        temNumeroDaEquipe() {
            return !!numeroDaEquipe;
        }
    };
}

module.exports = { criar };
