// =============================================================
//  CANAL DE TERMINAL (SPEC 0010)
//
//  Implementa CanalDeMensagem e NotificadorDeEquipe imprimindo no terminal,
//  em vez de falar com o ChatClean. E o que permite `npm run chat` e
//  `npm run sim` exercitarem o MESMO caso de uso que roda em producao — antes
//  cada tester reimplementava o turno e os tres ja divergiam (D-04).
//
//  Nao envia nada para lugar nenhum: seguro para rodar sem CC_PUSH_URL.
// =============================================================

/**
 * @param {object} opcoes
 * @param {(texto: string) => void} [opcoes.escrever]  Saida (padrao: console.log).
 * @param {string} [opcoes.rotuloBot]
 */
function criar({ escrever = (t) => console.log(t), rotuloBot = 'BOT' } = {}) {
    const enviadas = [];
    const notas = [];

    return {
        // --- CanalDeMensagem ---
        async enviarTexto(chatId, texto) {
            if (!texto || !String(texto).trim()) return false;
            enviadas.push({ chatId, texto });
            escrever(`${rotuloBot}  > ${texto}`);
            return true;
        },

        async enviarNotaInterna(chatId, texto) {
            notas.push({ chatId, texto });
            escrever(`\n--- nota interna no ticket ---\n${texto}\n`);
            return true;
        },

        // --- NotificadorDeEquipe ---
        async publicarNoTicket(chatId, resumo) {
            notas.push({ chatId, texto: resumo });
            escrever(`\n======== RESUMO ENVIADO A EQUIPE ========\n${resumo}\n=========================================\n`);
        },

        async enviarParaEquipe(resumo) {
            escrever(`\n(no CRM tambem iria por WhatsApp interno para EQUIPE_NUMERO)\n`);
            notas.push({ chatId: '(equipe)', texto: resumo });
        },

        temNumeroDaEquipe() {
            return false;
        },

        // Leitura, para os testers montarem seus proprios relatorios.
        enviadas,
        notas
    };
}

module.exports = { criar };
