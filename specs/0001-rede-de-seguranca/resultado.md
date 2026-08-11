# RESULTADO 0001 — Rede de segurança

**Status:** Implementada · **Concluída em:** 2026-08-11 · **Branch:** `refatoracao/arquitetura-ddd`

## Entregue

| Item | Resultado |
|---|---|
| Framework de teste | Vitest 3.2.7 |
| Lint / formatter | ESLint 9 (flat config) + Prettier |
| CI | GitHub Actions: lint, test, build da imagem |
| Testes | **245**, em **1,8s**, sem nenhuma chamada de rede |
| Cobertura | `flow.js`, `horario.js`, `data.js`, `src/shared/telefone.js`: **100%** |
| Linha de base | Roteiro executável e determinístico (`test/baseline/`) |

## Critérios de aceite

| CA | Situação | Evidência |
|---|---|---|
| CA-001 suíte < 10s, sem rede | Atendido | 1,8s; nenhuma chamada externa (fakes no `require.cache`) |
| CA-002 `SenderAlt` com `:24` | Atendido | `telefone.test.js`, `parsePayload.test.js` |
| CA-003 grupo pelos 5 sinais | Atendido | `parsePayload.test.js` |
| CA-004 ticket com `userId` | Atendido | `parsePayload.test.js`, `turno.test.js` |
| CA-005 bloqueio de diagnóstico no prompt | Atendido | `turno.test.js` cenário 1 |
| CA-006 transbordo notifica uma vez | Atendido | `turno.test.js` cenário 2 |
| CA-007 anti-loop | Atendido | `turno.test.js` cenário 12 |
| CA-008 reset 24h | Atendido | `turno.test.js` cenário 13 |
| CA-009 sábado aponta segunda | Atendido | `horario.test.js` |
| CA-010 tolerância ao 9º dígito | Atendido | `telefone.test.js` |
| CA-011 CI falha o build | Atendido | `.github/workflows/ci.yml` (execução real depende do push ao GitHub) |
| CA-012 cobertura > 70% | Superado | 100% nos módulos determinísticos |

## Distribuição dos testes

```
test/ferramental.test.js               3   sentinela do setup
test/unidade/flow.test.js             39   RN-002, RN-003, RN-005
test/unidade/horario.test.js          26   RN-060, RN-061, RN-062
test/unidade/data.test.js             29   RN-041, RN-011, RN-012, RN-014
test/unidade/telefone.test.js         19   CA-002, CA-010, RN-058
test/unidade/protecoes.test.js        22   RF-050, RN-053, RN-070
test/caracterizacao/parsePayload      50   RN-050, RN-051, RN-052, RN-055
test/caracterizacao/montarResumo      16   RN-043, RN-041, RN-004
test/integracao/turno.test.js         41   UC-001, 005, 006, 007, 009, 010, 013, 015, 016
                                     ---
                                     245
```

## Alterações em código de produção

Apenas duas, ambas mecânicas e cobertas por teste escrito antes:

1. `normalizarPhone` / `nucleoNumero` / `contatoPermitido` foram para `src/shared/telefone.js`.
   `index.js` importa de lá. A allow-list passou a ser parâmetro (o módulo não lê `process.env`).
2. O bootstrap (`app.listen`, `setInterval` do follow-up, handlers de sinal) foi para a função
   `iniciar()`, chamada apenas quando o arquivo roda direto. Um `module.exports` expõe as funções
   internas para a suíte.

`node index.js` se comporta exatamente como antes: verificado pelo diff da linha de base.

## Bugs revelados e congelados

A Fase 0 não corrige nada — cada achado virou teste que documenta o comportamento atual, marcado
com `CONGELA`, e será invertido pela spec que fizer a correção.

| ID | Achado | Como apareceu | Corrige em |
|---|---|---|---|
| **D-28** | O modo plantão nunca chega à resposta: `promptResposta` recebe `expediente` e ignora. O bot fala como se a loja estivesse sempre aberta. | ESLint (parâmetro não usado) + teste dourado | spec 0009 |
| **D-19** | Sábado tratado como fim de semana, com a loja aberta. | Decisão do negócio + `horario.test.js` | spec 0009 |
| **D-06** | `determinarProximoCampo` é consulta que muta o lead: montar um follow-up pode marcar o lead como qualificado. | `flow.test.js`, `protecoes.test.js` | spec 0006 |
| **D-29** | Log de payload desconhecido quebra com corpo `undefined` e reporta erro no lugar errado. | Caracterização | spec 0003 |
| **D-16** | Estado só é persistido no fim do turno: restart no meio apaga tudo que o cliente disse naquele turno. | Instabilidade da baseline, investigada até a causa | Fase 8 |
| **D-22** | Campo `empresa` no `/leads` é sempre `undefined`. | Linha de base | spec 0018 |
| **D-05** | `/diag` expõe "REUNIÃO MARCADA", nomenclatura de outro projeto. | Linha de base | spec 0007 |
| **S2** | CPF vai completo no resumo enviado à equipe. | `montarResumo.test.js` | spec 0016 |
| **S4** | Webhook aberto quando `WEBHOOK_SECRET` está vazio. | `protecoes.test.js` | spec 0002 |

## Observações para as próximas fatias

1. **`test/apoio/fakes.js` é dívida deliberada.** Injetar fakes pelo `require.cache` é a única forma
   de testar `processarMensagem` sem refatorar — e é a prova viva do acoplamento em D-02. Ele morre
   na spec 0004, substituído por adapters fake de verdade.
2. **O teste dourado passou de primeira**, o que dá confiança de que os fakes reproduzem o
   comportamento real. Ele é o principal contrato de equivalência da Fase 4.
3. **A linha de base pega o que o teste dourado não pega**: boot, rotas, autenticação, formato de
   resposta HTTP. Rodar as duas coisas, sempre.
4. **Nenhum teste depende de relógio real.** `vi.setSystemTime` controla as janelas de 30 min e 24 h.

## Libera

Specs 0002 (configuração e endurecimento) e 0003 (ACL do payload).
