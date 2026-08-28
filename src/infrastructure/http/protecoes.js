// =============================================================
//  PROTECOES DA BORDA HTTP
//
//  Duas barreiras, com propositos diferentes:
//
//    AUTENTICACAO do webhook — impede que qualquer um POSTe conversas no
//    endpoint e queime credito da OpenAI. A comparacao e em TEMPO CONSTANTE
//    (timingSafeEqual): comparar segredo com === vaza o tamanho do prefixo
//    correto pelo tempo de resposta.
//
//    RATE LIMIT por numero — janela deslizante em memoria. Protege contra
//    loop e spam. Sendo em memoria, vale POR INSTANCIA: com dois containers
//    o limite efetivo dobra (D-15).
//
//  NOTA DE LEITURA: os corpos foram movidos verbatim do index.js.
// =============================================================

const crypto = require('crypto');

/**
 * @param {object} config
 * @param {string} config.WEBHOOK_SECRET
 * @param {number} config.RATE_LIMIT_MSGS  0 desativa
 * @param {number} config.RATE_LIMIT_JANELA em milissegundos
 */
function criar({ WEBHOOK_SECRET, RATE_LIMIT_MSGS, RATE_LIMIT_JANELA }) {

// Valida o token do webhook contra WEBHOOK_SECRET. Aceita no header
// (x-webhook-token / Authorization: Bearer), na query (?token=) ou no path
// (/webhook/<token>). Se WEBHOOK_SECRET estiver vazio, o webhook fica aberto
// (compat) — CONFIGURE-O antes do go-live e aponte a URL do ChatClean para
// https://.../webhook/<secret> (ou .../webhook?token=<secret>).
function webhookAutorizado(req) {
    if (!WEBHOOK_SECRET) return true;
    const raw = req.headers['x-webhook-token'] || req.headers['authorization'] || req.query.token || req.params.token || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    if (token.length !== WEBHOOK_SECRET.length) return false;
    const a = Buffer.from(token.padEnd(128).slice(0, 128));
    const b = Buffer.from(WEBHOOK_SECRET.padEnd(128).slice(0, 128));
    return crypto.timingSafeEqual(a, b);
}

// Rate-limit por número (janela deslizante em memória, por instância).
const rateHits = new Map(); // chatId -> [timestamps]
function dentroDoLimite(chatId) {
    if (!RATE_LIMIT_MSGS) return true; // desativado
    const agora = Date.now();
    const hits = (rateHits.get(chatId) || []).filter(t => agora - t < RATE_LIMIT_JANELA);
    hits.push(agora);
    rateHits.set(chatId, hits);
    if (rateHits.size > 5000) { // poda defensiva
        for (const [k, v] of rateHits) {
            if (!v.length || agora - v[v.length - 1] > RATE_LIMIT_JANELA) rateHits.delete(k);
        }
    }
    return hits.length <= RATE_LIMIT_MSGS;
}

return { webhookAutorizado, dentroDoLimite };
}

module.exports = { criar };
