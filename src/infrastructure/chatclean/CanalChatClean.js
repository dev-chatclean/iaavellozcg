// =============================================================
//  CANAL CHATCLEAN — Push API
//
//  Um unico endpoint autenticado (CC_PUSH_URL) entrega tudo: mensagem ao
//  cliente, nota interna e transferencia de ticket. O token JWT ja vem
//  embutido na URL como ?token=..., sem header.
//
//  Este adapter cuida SO do transporte. Quem monta o payload — e quem decide
//  se aquilo e mensagem, nota ou transferencia — e a camada de cima.
//
//  Implementa a porta CanalDeSaida (src/application/portas).
// =============================================================

const crypto = require('crypto');

const { normalizarPhone } = require('../../shared/telefone');

const TIMEOUT_MS = 30000;

/**
 * @param {object} deps
 * @param {import('../../application/portas').ClienteHttp} deps.http
 * @param {string} deps.pushUrl
 * @param {() => string} [deps.gerarChave] chave de idempotencia (externalKey)
 * @returns {import('../../application/portas').CanalDeSaida}
 */
function criar({ http, pushUrl, gerarChave = () => crypto.randomUUID() }) {
    function configurado() {
        return !!pushUrl;
    }

    async function enviar(numero, payloadExtra = {}) {
        if (!pushUrl) {
            console.warn('\u{26A0}\u{FE0F} CC_PUSH_URL não configurado no .env — envio ignorado');
            return { ok: false, erro: 'CC_PUSH_URL ausente' };
        }
        try {
            const resp = await http.post(
                pushUrl,
                {
                    number: normalizarPhone(numero),
                    externalKey: gerarChave(),
                    ...payloadExtra
                },
                { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
            );
            return { ok: true, status: resp.status, data: resp.data };
        } catch (e) {
            console.error('\u{274C} Erro no Push ChatClean:', e.response?.data || e.message);
            return { ok: false, status: e.response?.status, data: e.response?.data, erro: e.message };
        }
    }

    return { configurado, enviar };
}

module.exports = { criar };
