// =============================================================
//  BAIXADOR DE MÍDIA (SPEC 0004)
//
//  Implementa a porta BaixadorDeMidia. Extraído dos blocos de áudio e vídeo
//  do index.js, preservando os timeouts diferentes que o legado usava:
//  30s para áudio e 60s para vídeo.
//
//  Nota: não há validação do endereço de origem. Isso é o risco S7, e a
//  correção foi deixada de fora desta fatia de propósito — ela mudaria
//  comportamento. Ver spec 0019.
// =============================================================

const axios = require('axios');

function criar() {
    return {
        async baixar(url, timeoutMs = 30000) {
            const resposta = await axios.get(url, { responseType: 'arraybuffer', timeout: timeoutMs });
            return Buffer.from(resposta.data);
        }
    };
}

module.exports = { criar };
