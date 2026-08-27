// =============================================================
//  BAIXADOR DE MIDIA
//
//  O cliente manda audio, video e imagem de duas formas: base64 embutido no
//  payload ou URL para baixar. Este adapter cuida da segunda.
//
//  O timeout entra por chamada de proposito: video e maior que audio, e
//  esperar 60s por um audio de 3 segundos seguraria o turno a toa.
//
//  Nao trata erro: quem chama decide se pede texto ao cliente ou desiste.
// =============================================================

const TIMEOUT_PADRAO_MS = 30000;

/**
 * @param {object} deps
 * @param {import('../../application/portas').ClienteHttp} deps.http
 */
function criar({ http }) {
    /**
     * @param {string} url
     * @param {{timeoutMs?: number}} [opcoes]
     * @returns {Promise<Buffer>}
     * @throws se o download falhar ou estourar o timeout
     */
    async function baixar(url, { timeoutMs = TIMEOUT_PADRAO_MS } = {}) {
        const resp = await http.get(url, { responseType: 'arraybuffer', timeout: timeoutMs });
        return Buffer.from(resp.data);
    }

    return { baixar };
}

module.exports = { criar, TIMEOUT_PADRAO_MS };
