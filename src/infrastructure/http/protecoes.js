// =============================================================
//  PROTECOES DA BORDA HTTP (SPEC 0018)
//
//  Autenticacao do webhook, controle de vazao e deduplicacao — extraidos do
//  index.js. Recebem a configuracao por parametro: nenhum le process.env.
//
//  ATENCAO: vazao e idempotencia vivem em MEMORIA, por instancia. Com duas
//  instancias, o limite e multiplicado e a deduplicacao nao funciona (D-15).
//  Mover para o Redis e a spec 0012.
// =============================================================

const crypto = require('crypto');

// -------------------------------------------------------------
//  Autenticacao do webhook (RF-050)
//  Aceita o token no header (x-webhook-token / Authorization: Bearer), na
//  query (?token=) ou no path (/webhook/<token>).
//
//  A comparacao usa digests SHA-256: tamanho fixo, sem truncar segredo longo
//  e sem comparar comprimento em texto claro (risco S5, spec 0002).
// -------------------------------------------------------------
function criarAutenticacao(segredo) {
    return function autorizado(req) {
        if (!segredo) return true; // fora de producao; em producao o boot exige
        const bruto =
            req.headers?.['x-webhook-token'] || req.headers?.['authorization'] || req.query?.token || req.params?.token || '';
        const token = String(bruto).replace(/^Bearer\s+/i, '');
        const a = crypto.createHash('sha256').update(token, 'utf8').digest();
        const b = crypto.createHash('sha256').update(segredo, 'utf8').digest();
        return crypto.timingSafeEqual(a, b);
    };
}

// -------------------------------------------------------------
//  Controle de vazao por numero (RN-053)
//  Janela deslizante em memoria. Limite 0 desativa.
// -------------------------------------------------------------
function criarControleDeVazao({ limite, janelaMs, tetoDeChaves = 5000 }) {
    const registros = new Map(); // chatId -> [instantes]

    return function dentroDoLimite(chatId) {
        if (!limite) return true;
        const agora = Date.now();
        const marcas = (registros.get(chatId) || []).filter((t) => agora - t < janelaMs);
        marcas.push(agora);
        registros.set(chatId, marcas);

        if (registros.size > tetoDeChaves) {
            // Poda defensiva: sem isso o Map cresce sem limite.
            for (const [chave, valores] of registros) {
                if (!valores.length || agora - valores[valores.length - 1] > janelaMs) registros.delete(chave);
            }
        }
        return marcas.length <= limite;
    };
}

// -------------------------------------------------------------
//  Deduplicacao por msgId (RN-055)
//  Guarda os ultimos N ids vistos.
// -------------------------------------------------------------
function criarControleDeIdempotencia({ capacidade = 500, descarte = 200 } = {}) {
    const vistos = new Set();

    return {
        /** @returns {boolean} true quando a mensagem ja foi processada. */
        jaProcessada(msgId) {
            if (!msgId) return false;
            if (vistos.has(msgId)) return true;
            vistos.add(msgId);
            if (vistos.size > capacidade) {
                [...vistos].slice(0, descarte).forEach((id) => vistos.delete(id));
            }
            return false;
        },
        tamanho: () => vistos.size
    };
}

// -------------------------------------------------------------
//  Guarda dos endpoints administrativos (/diag, /leads)
//  FAIL-CLOSED: sem ADMIN_KEY configurada, responde 503 — nunca deixa aberto
//  por omissao.
// -------------------------------------------------------------
function criarGuardaAdministrativa(chaveAdmin) {
    return function checarAdmin(req, res) {
        if (!chaveAdmin) {
            res.status(503).json({ erro: 'ADMIN_KEY não configurada no servidor' });
            return false;
        }
        const bruto = req.query?.key || req.headers?.['x-admin-key'] || req.headers?.['authorization'] || '';
        const chave = String(bruto).replace(/^Bearer\s+/i, '');
        if (chave !== chaveAdmin) {
            res.status(401).json({ erro: 'não autorizado' });
            return false;
        }
        return true;
    };
}

module.exports = {
    criarAutenticacao,
    criarControleDeVazao,
    criarControleDeIdempotencia,
    criarGuardaAdministrativa
};
