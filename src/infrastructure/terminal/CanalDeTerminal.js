// =============================================================
//  CANAL DE TERMINAL
//
//  Implementa a mesma porta CanalDeSaida do CanalChatClean, mas escreve na
//  tela em vez de falar com o CRM. E o que permite rodar o atendimento REAL —
//  o mesmo caso de uso, as mesmas politicas, a mesma fila — sem WhatsApp e sem
//  ChatClean.
//
//  Distingue os tres tipos de trafego pelo payload, porque no terminal eles
//  precisam parecer coisas diferentes:
//
//    mensagem       -> e o que o cliente leria
//    nota interna   -> so o vendedor veria; aqui aparece marcada
//    transferencia  -> nao e texto nenhum; e o ticket mudando de fila
//
//  Sem essa distincao, o resumo do lead apareceria no terminal como se
//  tivesse sido enviado ao cliente — que e exatamente o tipo de confusao que
//  fazia o tester antigo nao valer nada.
// =============================================================

const escreverPadrao = (linha) => console.log(linha);

/**
 * @param {object} [deps]
 * @param {(linha: string) => void} [deps.escrever]
 * @param {boolean} [deps.mostrarInterno] exibe nota e transferencia
 * @returns {import('../../application/portas').CanalDeSaida}
 */
function criar({ escrever = escreverPadrao, mostrarInterno = true } = {}) {
    /** Tudo que passou pelo canal, para os roteiros conferirem. */
    const trafego = [];

    function classificar(payload = {}) {
        if (payload.forceTicketToDepartment) return 'transferencia';
        if (payload.onlyNote) return 'nota';
        return 'mensagem';
    }

    async function enviar(numero, payload = {}) {
        const tipo = classificar(payload);
        trafego.push({ numero, tipo, body: payload.body, queueId: payload.queueId });

        if (tipo === 'mensagem') {
            escrever('bot  > ' + payload.body);
        } else if (mostrarInterno && tipo === 'nota') {
            escrever('\n  --- nota interna (o cliente NAO ve) ---');
            escrever(
                String(payload.body || '')
                    .split('\n')
                    .map((l) => '  ' + l)
                    .join('\n')
            );
            escrever('  ---------------------------------------\n');
        } else if (mostrarInterno && tipo === 'transferencia') {
            escrever(`\n  >> ticket transferido para a fila #${payload.queueId}\n`);
        }

        // O terminal sempre aceita: nao ha rede para falhar.
        return { ok: true, status: 200, data: { ok: true } };
    }

    return {
        configurado: () => true,
        enviar,
        trafego,
        mensagens: () => trafego.filter((t) => t.tipo === 'mensagem').map((t) => t.body),
        notas: () => trafego.filter((t) => t.tipo === 'nota').map((t) => t.body),
        transferencias: () => trafego.filter((t) => t.tipo === 'transferencia')
    };
}

module.exports = { criar };
