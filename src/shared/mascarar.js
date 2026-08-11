// =============================================================
//  MASCARAMENTO DE DADOS PESSOAIS PARA LOG (SPEC 0002, risco S1)
//
//  O log precisa ser útil para investigar um atendimento sem virar um
//  vazamento de dados pessoais. A regra: preservar o suficiente para
//  correlacionar (DDD e os últimos dígitos) e esconder o resto.
//
//  Módulo puro: sem I/O, sem process.env.
// =============================================================

// 5583999998888 -> 5583*****8888
function telefone(valor) {
    const digitos = String(valor ?? '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
    if (!digitos) return '(sem número)';
    if (digitos.length <= 8) return digitos.slice(0, 2) + '*'.repeat(Math.max(0, digitos.length - 2));
    const inicio = digitos.slice(0, 4); // país + DDD
    const fim = digitos.slice(-4);
    return `${inicio}${'*'.repeat(digitos.length - 8)}${fim}`;
}

// 12345678900 -> ***.***.789-00
function cpf(valor) {
    const digitos = String(valor ?? '').replace(/\D/g, '');
    if (digitos.length !== 11) return valor ? '(cpf inválido)' : '';
    return `***.***.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

// Conteúdo de mensagem: só o tamanho e as primeiras palavras não bastam —
// o texto pode conter CPF ditado pelo cliente. Para log, guardamos apenas o
// tamanho e o tipo.
function conteudo(texto) {
    const s = String(texto ?? '');
    if (!s) return '(vazio)';
    return `(${s.length} caracteres)`;
}

module.exports = { telefone, cpf, conteudo };
