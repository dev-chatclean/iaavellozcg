# PLAN 0009 — Expediente aos sábados e plantão que chega à resposta

Plano técnico da [SPEC 0009](spec.md). **Aprovado por:** arquiteto-ddd.

## 1. Abordagem

Duas correções pequenas e independentes, no mesmo escopo de negócio (expediente).

O horário deixa de ser um par de constantes globais (`ABRE`/`FECHA`) e vira uma **tabela por dia da
semana**. Isso não é sofisticação gratuita: com constantes globais, "sábado abre às 8h" exigiria um
`if` no meio do cálculo; com tabela, é um dado. E deixa o caminho pronto para horário por unidade,
se o negócio pedir.

A segunda correção é de uma linha de valor: `promptResposta` já recebia `expediente` e o descartava.
Passa a montar uma instrução de plantão quando `aberto === false`.

Nenhuma porta, nenhuma camada nova — isto é correção de bug, não fatia de estrangulação. O
`horario.js` continua onde está e será levado para `domain/expediente` na Fase 3.

## 2. Arquivos

**Alterados**
| Arquivo | Alteração |
|---|---|
| `horario.js` | `EXPEDIENTE_SEMANAL` por dia; `horarioDoDia`; rótulo usa a abertura do dia alvo; preposição por gênero; comentários herdados removidos |
| `prompts.js` | `promptResposta` monta `linhaPlantao` e a injeta no rodapé dinâmico |
| `test/unidade/horario.test.js` | Congelamento de D-19 invertido; casos de sábado, sexta à noite e feriado atualizados |
| `test/integracao/turno.test.js` | Congelamento de D-28 invertido; cenário 6 passa a cobrir sábado aberto e domingo em plantão |

**Criados / Removidos** — nenhum.

## 3. Portas e contratos

Nenhuma. `estaEmExpediente(date?)` mantém a assinatura e o formato de retorno
(`{ aberto, motivo, proximoExpediente }`), então `index.js` e `sim-lead.js` não mudam.
`horarioDoDia` e `EXPEDIENTE_SEMANAL` passam a ser exportados para teste e diagnóstico.

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|
| Tabela de dados no lugar de condicional | `EXPEDIENTE_SEMANAL` | Mudar um dia é mudar um dado (OCP) |
| Teste invertido | Congelamentos de D-19 e D-28 | O teste que documentava o defeito passa a garantir a correção |

## 5. Estratégia de coexistência

Não se aplica. Correção de bug em módulo pequeno e coberto por teste; não há caminho legado a
estrangular. Rollback é `git revert`.

## 6. Feature toggle

Nenhuma. A mudança é desejada imediatamente em produção e reversível por revert. Uma flag aqui só
adicionaria um caminho de código para manter.

## 7. Migração de dados

Nenhuma. O expediente é calculado a cada consulta; nada é persistido.

## 8. Estratégia de teste

| Nível | O que cobre | Arquivo |
|---|---|---|
| Unidade | Tabela por dia, limites de hora, feriados, rótulos, virada de ano | `test/unidade/horario.test.js` |
| Integração | Plantão no prompt, transbordo no sábado, ausência de plantão em dia útil | `test/integracao/turno.test.js` |
| Execução real | `estaEmExpediente` sobre 10 instantes-chave | verificação manual registrada no resultado |
| Linha de base | Rotas HTTP inalteradas em dia útil | `test/baseline/` |

**Como provamos que não quebrou:** CA-010 exige comportamento idêntico de segunda a sexta. A linha
de base foi coletada num dia útil e saiu igual à referência.

## 9. Plano de rollback

`git revert` do commit. O expediente volta a segunda a sexta e o prompt volta a ignorar o plantão.
Tempo: menos de 2 minutos, sem migração e sem estado a desfazer.

## 10. Impacto em performance e custo

Nenhum. Mesma quantidade de chamadas de LLM. A instrução de plantão acrescenta cerca de 60 tokens ao
turno, **apenas fora do expediente** — e no rodapé dinâmico, sem afetar o cache do `SYSTEM_SDR`.

## 11. Sequência de PRs

Um só. As duas correções são pequenas, pertencem ao mesmo assunto de negócio e compartilham os
mesmos testes de cenário.
