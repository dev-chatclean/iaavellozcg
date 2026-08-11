# RESULTADO 0003 — Anti-Corruption Layer do payload de entrada

**Status:** Implementada · **Concluída em:** 2026-08-11 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

```
ANTES                              DEPOIS
index.js                           index.js
  parsePayload (75 linhas)           parsePayload (casca de 30 linhas: políticas + log)
    3 formatos                          |
    4 filtros                           v
    10 cadeias de fallback         src/infrastructure/chatclean/acl/
    log                              esquemas.js   contrato dos 3 formatos (zod)
    tudo -> null                     tradutor.js   traduz ou devolve motivo nomeado
                                          |
                                          v
                                   src/domain/mensageria/
                                     MensagemRecebida.js   nosso formato, congelado
                                     MotivoDeDescarte.js   7 motivos nomeados
```

### Motivos de descarte, antes e depois

| Situação | Antes | Depois |
|---|---|---|
| Eco do próprio bot | `null` | `eco` |
| Mensagem de grupo | `null` | `grupo` |
| Vendedor aceitou o ticket | `null` | `ticket-assumido` |
| Ticket encerrado | `null` | `ticket-encerrado` |
| Disparo duplicado | `null` | `formato-duplicado` |
| Sem telefone utilizável | `null` | `sem-telefone` |
| Formato irreconhecível | `null` | `formato-desconhecido` |

Sete situações que eram indistinguíveis agora têm nome. Isso vira métrica direta na spec 0015: "por
que este lead não foi atendido" passa a ter resposta sem ler o log linha a linha.

## O critério que importava

**CA-001: os 50 testes de caracterização do `parsePayload` passaram sem uma única alteração.**

Eles foram escritos na Fase 0 contra a implementação antiga, congelando o comportamento — inclusive
os detalhes sutis: cadeia de precedência do telefone (`contact.number` antes de `SenderAlt`, que vem
antes de `raw.from`), corte do sufixo de dispositivo (`:24@s.whatsapp.net`), os cinco sinais que
identificam grupo, `ticket.contactId` como terceira opção de `contactId`, normalização de `chat` para
`text`. Todo esse conhecimento sobreviveu à troca porque estava capturado em teste.

Foi exatamente para isso que a Fase 0 existiu.

## Tolerância deliberada (CA-010)

O esquema **não barra**. Um payload com `contact.name` chegando como número — que um esquema rígido
rejeitaria — é processado normalmente, e a divergência é registrada:

```
ATENÇÃO: Payload fora do esquema conhecido (processado mesmo assim): contact.name: expected string
```

O formato é do ChatClean, não nosso, e muda por canal. Um ACL que rejeita formato novo transforma
uma mudança do fornecedor em lead sem atendimento — o oposto do que ele existe para fazer. O esquema
serve para **documentar e medir**, não para barrar.

## D-29 corrigido

`parsePayload(undefined)` lançava internamente (`JSON.stringify(undefined).slice` na própria linha de
log) e reportava "Erro ao fazer parse do payload", apontando para o lugar errado. Agora devolve
`formato-desconhecido` limpo. Coberto para `undefined`, `null`, string, número e array.

## Ganho colateral de segurança

A linha de payload irreconhecível **despejava o corpo inteiro no log** — mais um vazamento de PII, no
mesmo espírito do S1. Agora registra só o motivo:

```
ANTES:  Payload não reconhecido: { ...corpo inteiro... }
DEPOIS: Payload não reconhecido [formato-desconhecido] — não casa com nenhum formato conhecido
```

## Verificação

- **320 testes** (eram 294): 26 novos em `tradutor-payload.test.js`, cobrindo motivos nomeados,
  classificação de formato, políticas injetadas e tolerância.
- **Os 50 de caracterização**, sem alteração.
- **Linha de base HTTP: idêntica.** No log do servidor, única mudança é a linha de payload
  irreconhecível, agora com motivo nomeado — mudança intencional, referência atualizada.
- `index.js`: **1040 para 990 linhas**.
- Lint: 6 avisos, nenhum erro.

## Detalhe que a mudança revelou

`MensagemRecebida` é congelada, e `drenarFila` fazia `unidade.chatId = chatId` no objeto vindo do
parse. Em CommonJS não-estrito isso falharia **em silêncio** — o valor já estava correto, então
ninguém notaria, mas é o tipo de dependência acidental que quebra numa migração para ESM ou
TypeScript. Trocado por cópia explícita quando o `chatId` falta (caso do agrupamento de textos).

## Pendências declaradas

- `ehGrupo` e `ticketStatus` continuam exportados por `index.js` só para os testes de caracterização.
  Somem quando esses testes forem substituídos pelos do caso de uso (spec 0008).
- Fila, deduplicação e rate-limit continuam no `handleWebhook` — Fase 8.
