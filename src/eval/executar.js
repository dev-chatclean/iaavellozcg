// =============================================================
//  EXECUTOR DE EVALS (SPEC 0011)
//
//  Roda os roteiros contra o sistema REAL (mesmo caso de uso da producao) e
//  mede as violacoes com src/eval/analisadores.js.
//
//  ATENCAO: GASTA CREDITO REAL DA OPENAI. Uma rodada completa faz duas
//  chamadas por turno (extracao + resposta) em ~28 turnos. Nao roda em CI
//  automaticamente — e comando explicito: `npm run eval`.
//
//  Quando usar: SEMPRE que mexer em prompt. Rode antes e depois, e compare.
//  As metricas bloqueantes (RN-001, RN-010, RN-020) nao podem piorar.
// =============================================================

const { ROTEIROS } = require('./roteiros');
const analisadores = require('./analisadores');
const PoliticaDeDiagnostico = require('../domain/atendimento/politicas/PoliticaDeDiagnostico');

/**
 * @param {object} opcoes
 * @param {(deps: object) => object} opcoes.montarAtendimento
 *   Recebe o canal coletor e devolve o caso de uso pronto.
 * @param {object[]} [opcoes.roteiros]
 * @param {(texto: string) => void} [opcoes.escrever]
 */
async function executar({ montarAtendimento, roteiros = ROTEIROS, escrever = console.log }) {
    const relatorio = { roteiros: [], violacoesPorRegra: {}, totalDeTurnos: 0 };

    for (const roteiro of roteiros) {
        escrever(`\n=== ${roteiro.nome} ===`);
        escrever(`    ${roteiro.descricao}\n`);

        const coletadas = [];
        const { atendimento, repositorio, chatId } = montarAtendimento((texto) => coletadas.push(texto));

        const resultado = { nome: roteiro.nome, turnos: [], violacoes: [] };

        for (let i = 0; i < roteiro.turnos.length; i++) {
            const mensagem = roteiro.turnos[i];
            coletadas.length = 0;

            escrever(`CLIENTE > ${mensagem}`);
            await atendimento.processarMensagem({ chatId, texto: mensagem, tipo: 'text' });

            const resposta = coletadas.join('\n');
            escrever(`BOT     > ${resposta}\n`);

            // O estado real manda: se o diagnostico fechou antes do turno
            // previsto no roteiro, o bot ja pode falar de produto.
            const lead = (await repositorio.buscar(chatId)) || {};
            const diagnosticoCompleto =
                PoliticaDeDiagnostico.completo(lead) ||
                (roteiro.diagnosticoCompletoApartirDoTurno !== null &&
                    i + 1 >= roteiro.diagnosticoCompletoApartirDoTurno);

            const { violacoes } = analisadores.analisar(resposta, { diagnosticoCompleto });
            relatorio.totalDeTurnos += 1;

            for (const v of violacoes) {
                relatorio.violacoesPorRegra[v.regra] = (relatorio.violacoesPorRegra[v.regra] || 0) + 1;
                resultado.violacoes.push({ turno: i + 1, ...v });
                escrever(`   !! ${v.regra}: ${v.evidencias.join('; ')}\n`);
            }

            resultado.turnos.push({ mensagem, resposta, diagnosticoCompleto, violacoes });
            if (lead.finalizado) break;
        }

        relatorio.roteiros.push(resultado);
    }

    return relatorio;
}

// Regras cujo alvo e ZERO violacao. Qualquer ocorrencia reprova a rodada.
const REGRAS_BLOQUEANTES = ['RN-001', 'RN-010', 'RN-020'];

function imprimirResumo(relatorio, escrever = console.log) {
    escrever('\n================ RESUMO ================');
    escrever(`turnos avaliados: ${relatorio.totalDeTurnos}`);

    const regras = Object.keys(relatorio.violacoesPorRegra);
    if (!regras.length) {
        escrever('nenhuma violacao detectada');
    } else {
        for (const regra of regras.sort()) {
            const n = relatorio.violacoesPorRegra[regra];
            const taxa = ((n / relatorio.totalDeTurnos) * 100).toFixed(1);
            const marca = REGRAS_BLOQUEANTES.includes(regra) ? 'BLOQUEANTE' : '';
            escrever(`${regra}: ${n} violacao(oes) — ${taxa}% dos turnos ${marca}`);
        }
    }

    const reprovou = REGRAS_BLOQUEANTES.some((r) => relatorio.violacoesPorRegra[r]);
    escrever(reprovou ? '\nREPROVADO: regra bloqueante violada' : '\nAPROVADO');
    return !reprovou;
}

module.exports = { executar, imprimirResumo, REGRAS_BLOQUEANTES };
