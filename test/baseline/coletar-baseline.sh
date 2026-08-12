#!/usr/bin/env bash
# =============================================================
#  COLETA DE LINHA DE BASE (SPEC 0001)
#  Sobe a aplicacao com ambiente CONTROLADO e exercita a pilha HTTP inteira,
#  registrando requisicoes, respostas e logs do servidor.
#
#  Seguranca: sem CC_PUSH_URL (nenhuma mensagem sai), sem REDIS_URL (estado em
#  memoria), OPENAI_API_KEY falsa (nenhum credito e gasto — as chamadas falham
#  de proposito e exercitam o caminho de fallback).
#
#  Uso:  bash test/baseline/coletar-baseline.sh <rotulo>
#  Saida: test/baseline/<rotulo>-requisicoes.log  (requisicoes e respostas)
#         test/baseline/<rotulo>-servidor.log     (stdout/stderr do servidor)
#  Arquivos separados de proposito: o servidor e o curl escrevendo no mesmo
#  arquivo se sobrescrevem (o redirecionamento nao e append atomico no Windows).
# =============================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

PORT=3999
ROTULO="${1:-baseline}"
SAIDA="test/baseline/${ROTULO}-requisicoes.log"
LOG_SERVIDOR="test/baseline/${ROTULO}-servidor.log"
mkdir -p test/baseline

export PORT
export OPENAI_API_KEY="sk-baseline-falsa"
export ADMIN_KEY="chave-baseline"
export CC_PUSH_URL=""
export REDIS_URL=""
export EQUIPE_NUMERO=""
export WEBHOOK_SECRET=""
export IA_ALLOWED_CONTACTS=""
export AGRUPAR_MENSAGENS_MS=200
export FERIADOS=""

echo "== linha de base — porta $PORT ==" > "$SAIDA"
node index.js > "$LOG_SERVIDOR" 2>&1 &
SERVIDOR=$!
trap 'kill $SERVIDOR 2>/dev/null' EXIT

for _ in $(seq 1 40); do
    curl -s -o /dev/null "http://localhost:$PORT/health" && break
    sleep 0.25
done

req() {
    local titulo="$1"; shift
    echo "" >> "$SAIDA"
    echo "### $titulo" >> "$SAIDA"
    echo "-> $*" >> "$SAIDA"
    echo "<- $(curl -s -w ' [HTTP %{http_code}]' "$@")" >> "$SAIDA"
    sleep 0.4
}

post() {
    local titulo="$1" corpo="$2"
    req "$titulo" -X POST "http://localhost:$PORT/webhook" -H 'Content-Type: application/json' -d "$corpo"
}

# ---------- Endpoints ----------
req "GET /health"                 "http://localhost:$PORT/health"
req "GET /diag sem chave"         "http://localhost:$PORT/diag"
req "GET /diag com chave"         "http://localhost:$PORT/diag?key=chave-baseline"
req "GET /diag chave errada"      "http://localhost:$PORT/diag?key=errada"
req "GET /leads com chave"        "http://localhost:$PORT/leads?key=chave-baseline"
req "GET /webhook (ping)"         "http://localhost:$PORT/webhook"
req "GET /webhook/<token> (ping)" "http://localhost:$PORT/webhook/qualquer"

# ---------- Payloads: formatos aceitos ----------
post "aninhado ChatClean (SenderAlt com sufixo de dispositivo)" '{
  "contact": {"id": 501, "name": "Joao Baseline"},
  "ticket": {"status": "pending", "userId": null},
  "message": {"id": "MSG-A1", "body": "quanto custa a AZ1?", "type": "chat", "fromMe": false,
    "raw": {"Info": {"SenderAlt": "558491756446:24@s.whatsapp.net", "PushName": "Joao Baseline"}}}
}'

post "aninhado sem SenderAlt (usa contact.number)" '{
  "contact": {"id": 502, "name": "Maria", "number": "5583988887777"},
  "ticket": {"status": "pending"},
  "message": {"id": "MSG-A2", "body": "oi", "type": "chat", "fromMe": false}
}'

post "WABA (numero em raw.from)" '{
  "contact": {"id": 503, "name": "Pedro"},
  "ticket": {"status": "open"},
  "message": {"id": "MSG-A3", "body": "bom dia", "type": "text", "fromMe": false, "raw": {"from": "5583977776666"}}
}'

post "formato plano" '{"number": "5583966665555", "body": "tenho interesse", "type": "text", "contactName": "Ana", "id": "MSG-B1"}'

# ---------- Payloads: descartes esperados ----------
post "fromMe (eco do proprio bot)" '{
  "contact": {"id": 504, "number": "5583955554444"},
  "message": {"id": "MSG-C1", "body": "eco", "type": "chat", "fromMe": true}
}'

post "grupo por ticket.isGroup" '{
  "contact": {"id": 505, "number": "5583944443333"},
  "ticket": {"status": "pending", "isGroup": true},
  "message": {"id": "MSG-C2", "body": "mensagem de grupo", "type": "chat", "fromMe": false}
}'

post "grupo por JID @g.us" '{
  "contact": {"id": 506, "number": "5583933332222"},
  "message": {"id": "MSG-C3", "body": "grupo jid", "type": "chat", "fromMe": false,
    "raw": {"Info": {"Chat": "120363000000000000@g.us"}}}
}'

post "ticket assumido por humano (userId)" '{
  "contact": {"id": 507, "number": "5583922221111"},
  "ticket": {"status": "open", "userId": 77},
  "message": {"id": "MSG-C4", "body": "ja tem vendedor", "type": "chat", "fromMe": false}
}'

post "ticket closed" '{
  "contact": {"id": 508, "number": "5583911110000"},
  "ticket": {"status": "closed"},
  "message": {"id": "MSG-C5", "body": "encerrado", "type": "chat", "fromMe": false}
}'

post "formato numero_cliente (disparo duplicado)" '{"numero_cliente": "5583900001111", "mensagem_cliente": "oi"}'
post "payload desconhecido" '{"foo": "bar"}'

# ---------- Comportamentos ----------
post "duplicidade de msgId (MSG-A2 de novo)" '{
  "contact": {"id": 502, "name": "Maria", "number": "5583988887777"},
  "ticket": {"status": "pending"},
  "message": {"id": "MSG-A2", "body": "oi de novo", "type": "chat", "fromMe": false}
}'

post "tipo nao suportado (sticker)" '{"number": "5583899998888", "body": "", "type": "sticker", "id": "MSG-D1"}'

# O estado do atendimento so e persistido no FIM do turno, depois das chamadas
# a OpenAI. Como aqui elas vao de verdade a rede (e voltam 401), a duracao do
# turno varia. Sem espera suficiente, /leads devolve menos atendimentos e o diff
# acusa uma regressao que nao existe. Ver docs/12-linha-de-base.md.
echo "" >> "$SAIDA"
echo "### aguardando drenagem da fila e follow-ups" >> "$SAIDA"
sleep 10

req "GET /leads apos o trafego" "http://localhost:$PORT/leads?key=chave-baseline"

# Normalizacoes para o diff comparar CONTEUDO, nao circunstancia:
#   1. a ordem dos atendimentos depende de qual turno terminou primeiro;
#   2. o campo `expediente` do /diag depende da hora em que a coleta rodou —
#      coletar as 10h da terca e as 20h da mesma terca dava diff sem regressao.
node -e '
const fs = require("fs");
const arquivo = process.argv[1];
let texto = fs.readFileSync(arquivo, "utf8");

texto = texto.replace(/\{"total":\d+,"ativos":\[.*?\]\}/g, (json) => {
    const dados = JSON.parse(json);
    dados.ativos.sort((a, b) => String(a.chatId).localeCompare(String(b.chatId)));
    return JSON.stringify(dados);
});

texto = texto.replace(/"expediente":\{[^}]*\}/g, "\"expediente\":\"(normalizado: depende da hora da coleta)\"");

fs.writeFileSync(arquivo, texto);
' "$SAIDA"

sleep 1
kill $SERVIDOR 2>/dev/null
wait $SERVIDOR 2>/dev/null
echo "" >> "$SAIDA"
echo "== servidor encerrado ==" >> "$SAIDA"
echo "baseline gravada em:"
echo "  $SAIDA"
echo "  $LOG_SERVIDOR"
