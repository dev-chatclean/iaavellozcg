# RESULTADO 0009 — Expediente aos sábados e plantão que chega à resposta

**Status:** Implementada · **Concluída em:** 2026-08-11 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou no código

### `horario.js`
- As constantes `ABRE`/`FECHA` viraram **`EXPEDIENTE_SEMANAL`**, uma tabela por dia da semana.
  Domingo é `null` (fechado); segunda a sexta `{ abre: 9, fecha: 18 }`; sábado `{ abre: 8, fecha: 18 }`.
- `rotuloProximoExpediente` passou a usar o horário de abertura **do dia alvo**, e não uma constante
  global — por isso consegue dizer "amanhã às 8h" numa sexta à noite.
- Preposição do rótulo agora varia por gênero: "na segunda-feira", "no sábado".
- Comentários herdados do `iachatclean` ("expediente do time ChatClean", "Natal-RN") removidos.
- Exporta `horarioDoDia` e `EXPEDIENTE_SEMANAL` para teste e diagnóstico.

### `prompts.js`
- `promptResposta` finalmente **usa** o parâmetro `expediente`. Fora do horário, o turno recebe uma
  instrução explícita: não prometer atendimento imediato, informar quando o consultor retorna, e
  seguir atendendo sem encerrar a conversa (preserva RN-021 e RN-023).
- Dentro do expediente, o prompt fica byte a byte igual ao de antes.

## Comportamento verificado na aplicação

| Momento | Antes | Agora |
|---|---|---|
| Sábado 07h59 | fechado, próximo "na segunda às 9h" | fechado, próximo **"hoje às 8h"** |
| Sábado 08h–17h59 | **fechado** (fim de semana) | **ABERTO** |
| Sábado 18h | fechado | fechado, próximo "na segunda-feira às 9h" |
| Domingo 10h | fechado, "amanhã às 9h" | igual |
| Sexta 19h | próximo "na segunda-feira às 9h" | próximo **"amanhã às 8h"** |
| Natal (sexta) | próximo "na segunda-feira às 9h" | próximo **"amanhã às 8h"** |
| Terça 09h–17h59 | aberto | igual (sem regressão) |

## Critérios de aceite

Todos atendidos: CA-001 a CA-010. Cobertos por `test/unidade/horario.test.js` (32 testes) e
`test/integracao/turno.test.js` cenário 6 (5 testes).

Destaques:
- **CA-007**: fora do expediente, o prompt contém "FORA DO EXPEDIENTE", "NÃO prometa atendimento
  imediato" e o horário de retorno.
- **CA-008**: dentro do expediente, o prompt não menciona plantão.
- **CA-009**: lead qualificado no sábado transborda ao vivo, sem etiqueta e sem retorno sugerido.
- **CA-010**: dias úteis inalterados — a linha de base HTTP saiu idêntica.

## Testes invertidos (eram congelamentos de bug)

| Teste | Era | Virou |
|---|---|---|
| `horario.test.js` "CONGELA BUG D-19" | sábado é fim de semana | CA-001: sábado está aberto |
| `turno.test.js` "CONGELA BUG D-28" | prompt não menciona expediente | CA-007: prompt instrui o plantão |

Este é o ciclo previsto pela Fase 0: o teste que documentava o defeito vira o teste que garante a
correção. Nenhum dos dois foi apagado.

## Verificação

- `npm test`: **254 testes** verdes (eram 245; +9 do expediente).
- `npm run lint`: 6 avisos (eram 7 — o parâmetro não usado do D-28 saiu).
- Linha de base HTTP: **idêntica** à referência, coletada num dia útil.
- Execução direta de `estaEmExpediente` sobre 10 instantes-chave: conferida uma a uma.

## Efeito colateral encontrado durante a implementação

Com o sábado se tornando alcançável, o rótulo do próximo expediente passou a produzir
"**na** sábado". O bug estava lá desde sempre, mas era inalcançável — o sábado nunca era destino.
Corrigido junto, com teste.

## Pendências declaradas (não bloqueiam)

- Horário de **segunda a sexta** mantido em 09h–18h, como sempre esteve. Se a loja abre às 08h todos
  os dias, é mudar um número na tabela.
- **Monteiro** assumido com o mesmo horário das unidades de Campina Grande. Horário por unidade
  exigiria levar a loja para dentro do cálculo de expediente — fatia própria, se o negócio precisar.
