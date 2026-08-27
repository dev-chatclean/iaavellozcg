// =============================================================
//  TELEFONE — normalizacao e comparacao de numeros brasileiros
//
//  Modulo puro: nao le ambiente, nao faz I/O. A allow-list entra por
//  parametro, porque quem sabe da configuracao e o composition root, nao a
//  regra.
//
//  Tres armadilhas do WhatsApp moram aqui, todas encontradas em producao:
//    1. o JID traz o ID do dispositivo e o servidor ("...:24@s.whatsapp.net");
//    2. o 9o digito de celular aparece ou nao, dependendo da origem;
//    3. as vezes o ID do dispositivo chega GRUDADO, sem os dois-pontos.
// =============================================================

/**
 * Numero limpo, so digitos, a partir de qualquer formato do WhatsApp.
 *
 * Corta os sufixos de JID ANTES de limpar: "558491756446:24@s.whatsapp.net"
 * tem o ID do dispositivo (:24) e o servidor (@...). Sem cortar, o :24
 * grudaria no numero (...6446 + 24).
 *
 * @param {string|number} phone
 * @returns {string} so digitos
 */
function normalizarPhone(phone) {
    return String(phone).split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * Nucleo canonico de um numero BR para COMPARACAO: ignora o 9o digito de
 * celular. Ex.: 5584994610845 (13) e 558494610845 (12) viram o mesmo nucleo.
 *
 * @param {string|number} n
 * @returns {string}
 */
function nucleoNumero(n) {
    let d = normalizarPhone(n);
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
        d = d.slice(0, 4) + d.slice(5); // remove o 9 logo apos o DDD
    }
    return d;
}

/**
 * true se o numero esta na allow-list.
 *
 * Tolerante ao 9o digito e ao ID de dispositivo grudado no fim: o JID
 * "558494610845:59" as vezes chega com os dois-pontos ja removidos, virando
 * "55849461084559" — e ai o numero da lista continua sendo o COMECO do que
 * veio. O ID de dispositivo tem 1 ou 2 digitos, entao a sobra e limitada a 2
 * para nao casar numero de outra pessoa por prefixo.
 *
 * Lista vazia libera todos.
 *
 * @param {string|number} numero
 * @param {string[]} permitidos
 * @returns {boolean}
 */
function contatoPermitido(numero, permitidos = []) {
    if (!permitidos.length) return true;
    const alvo = nucleoNumero(numero);
    return permitidos.some((a) => {
        const permitido = nucleoNumero(a);
        if (!permitido) return false;
        if (permitido === alvo) return true;
        const sobra = alvo.length - permitido.length;
        return sobra > 0 && sobra <= 2 && alvo.startsWith(permitido);
    });
}

module.exports = { normalizarPhone, nucleoNumero, contatoPermitido };
