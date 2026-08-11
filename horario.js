// =============================================================
//  HORÁRIO — expediente da Avelloz Campina
//  Atendimento humano: segunda a sábado, exceto feriados.
//  Fora disso (noite, domingo e feriado) o bot entra em MODO PLANTÃO:
//  não promete atendimento imediato e informa o próximo dia útil.
//
//  estaEmExpediente(date?) → { aberto, motivo, proximoExpediente }
//  Aceita uma data (para testes); por padrão usa a hora atual.
//
//  Feriados: nacionais fixos embutidos + extras via env FERIADOS
//  (lista separada por vírgula, "YYYY-MM-DD" ou "MM-DD"). Feriados
//  MÓVEIS (Carnaval, Sexta-feira Santa, Corpus Christi) mudam a cada
//  ano — coloque-os no FERIADOS do ano corrente.
// =============================================================

const TZ = 'America/Recife'; // Campina Grande e Monteiro/PB — UTC-3, sem horário de verão

// Expediente por dia da semana (0 = domingo). null = fechado o dia inteiro.
// Atende enquanto hora >= abre e hora < fecha.
// SPEC 0009: o sábado passou a ser dia de atendimento (08h-18h). Ajustar um dia
// é mudar um número aqui — não há mais constante global de abertura.
const EXPEDIENTE_SEMANAL = {
    0: null,                    // domingo — fechado
    1: { abre: 9, fecha: 18 },  // segunda
    2: { abre: 9, fecha: 18 },  // terça
    3: { abre: 9, fecha: 18 },  // quarta
    4: { abre: 9, fecha: 18 },  // quinta
    5: { abre: 9, fecha: 18 },  // sexta
    6: { abre: 8, fecha: 18 }   // sábado
};

// Feriados nacionais de data fixa (MM-DD). Consciência Negra (11-20) é
// feriado nacional desde 2024.
const FERIADOS_FIXOS = new Set([
    '01-01', // Confraternização Universal
    '04-21', // Tiradentes
    '05-01', // Dia do Trabalho
    '09-07', // Independência
    '10-12', // Nossa Senhora Aparecida
    '11-02', // Finados
    '11-15', // Proclamação da República
    '11-20', // Consciência Negra
    '12-25'  // Natal
]);
// Extras/móveis por env (YYYY-MM-DD para um ano específico, ou MM-DD recorrente).
const FERIADOS_EXTRA = new Set(
    (process.env.FERIADOS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
// "na segunda-feira" (feminino) mas "no sábado" / "no domingo" (masculino).
// Antes da SPEC 0009 o sábado nunca era alcançável, então o "na" fixo passava.
const PREPOSICAO_DIA = ['no', 'na', 'na', 'na', 'na', 'na', 'no'];

// Instante → objeto Date na hora LOCAL de Campina Grande/PB.
function paraLocal(date) {
    return new Date(date.toLocaleString('en-US', { timeZone: TZ }));
}
function ymd(local) {
    const y = local.getFullYear();
    const m = String(local.getMonth() + 1).padStart(2, '0');
    const d = String(local.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function ehFeriado(local) {
    const iso = ymd(local);
    const md = iso.slice(5);
    return FERIADOS_FIXOS.has(md) || FERIADOS_EXTRA.has(iso) || FERIADOS_EXTRA.has(md);
}

// Horário de atendimento daquele dia, ou null se a loja não abre (domingo/feriado).
function horarioDoDia(local) {
    if (ehFeriado(local)) return null;
    return EXPEDIENTE_SEMANAL[local.getDay()] || null;
}
function ehDiaDeExpediente(local) {
    return horarioDoDia(local) !== null;
}

// Rótulo amigável do próximo momento em que o time abre, pulando domingos e
// feriados e respeitando o horário de abertura de cada dia.
function rotuloProximoExpediente(local) {
    const alvo = new Date(local);
    const hojeAbre = horarioDoDia(local);
    // Se hoje é dia de expediente e ainda não abriu, o próximo é hoje.
    if (!(hojeAbre && local.getHours() < hojeAbre.abre)) {
        do { alvo.setDate(alvo.getDate() + 1); } while (!ehDiaDeExpediente(alvo));
    }
    const abre = horarioDoDia(alvo).abre;
    alvo.setHours(abre, 0, 0, 0);

    // Diferença em dias de calendário (comparando só a data).
    const d0 = new Date(local); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(alvo);  d1.setHours(0, 0, 0, 0);
    const difDias = Math.round((d1 - d0) / 86400000);

    if (difDias === 0) return `hoje às ${abre}h`;
    if (difDias === 1) return `amanhã às ${abre}h`;
    return `${PREPOSICAO_DIA[alvo.getDay()]} ${DIAS_SEMANA[alvo.getDay()]} às ${abre}h`;
}

function estaEmExpediente(date = new Date()) {
    const local = paraLocal(date);
    const hora = local.getHours();
    const feriado = ehFeriado(local);
    const horario = EXPEDIENTE_SEMANAL[local.getDay()] || null;
    const diaFechado = horario === null;
    const comercial = !!horario && hora >= horario.abre && hora < horario.fecha;
    const aberto = !feriado && !diaFechado && comercial;

    let motivo = null;
    if (feriado) motivo = 'feriado';
    else if (diaFechado) motivo = 'fim de semana';
    else if (hora < horario.abre) motivo = 'antes do horário';
    else if (hora >= horario.fecha) motivo = 'fora do horário (noite)';

    return { aberto, motivo, proximoExpediente: aberto ? null : rotuloProximoExpediente(local) };
}

module.exports = { estaEmExpediente, ehFeriado, horarioDoDia, EXPEDIENTE_SEMANAL, TZ };
