# SPEC 0009 — Expediente aos sábados e plantão que chega à resposta

| | |
|---|---|
| **Status** | Aprovada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 |
| **Fase do plano** | Correção de bug (pós-Fase 0) |
| **Dívida endereçada** | D-19, D-28 |
| **Depende de** | SPEC 0001 (rede de segurança) |

## 1. Contexto de negócio

A Avelloz Campina atende **de segunda a sábado**. O bot precisa saber quando há vendedor humano
disponível, porque isso muda duas coisas: o que ele promete ao cliente ("o consultor assume agora"
contra "ele te retorna segunda") e como o lead chega para a equipe (transferência ao vivo contra
retorno agendado).

## 2. Problema

O expediente está errado **nas duas direções**, e ambas custam venda:

**D-19 — sábado tratado como fim de semana.** `horario.js` implementa segunda a sexta. Todo lead que
chega no sábado, com a loja aberta e vendedor no balcão, é atendido em modo plantão e cai na fila da
equipe etiquetado `FORA DE EXPEDIENTE — AGENDAR RETORNO`. O vendedor vê um lead que parece não ser
para agora.

**D-28 — o plantão nunca chega à resposta.** `promptResposta` recebe o parâmetro `expediente` e
**nunca o usa**. O modelo escreve sempre como se a loja estivesse aberta. Às 23h de um domingo o bot
diz "já tô repassando pro nosso consultor, ele assume seu atendimento aqui rapidinho" — e ninguém
assume. A informação de plantão só sobrevive na etiqueta do resumo interno e numa mensagem de
fallback que só aparece quando a OpenAI falha.

Os dois foram revelados pela Fase 0: o D-19 pela decisão do negócio confrontada com o teste de
expediente; o D-28 pelo ESLint (parâmetro não usado), confirmado pelo teste dourado.

## 3. Resultado esperado

O bot sabe quando a loja está aberta — inclusive no sábado — e **fala de acordo**: promete
atendimento imediato quando há alguém, e retorno com hora marcada quando não há.

## 4. Escopo

**Dentro**
- Sábado passa a ser dia de expediente, das **08h às 18h**.
- O horário deixa de ser um par de constantes e vira uma **tabela por dia da semana**, para que
  ajustar um dia seja mudar um dado, não editar lógica.
- `promptResposta` passa a usar o expediente: fora do horário, instrui o modelo a não prometer
  atendimento imediato e a informar o próximo retorno.
- Comentários herdados do projeto `iachatclean` ("expediente do time ChatClean", "Natal-RN") saem.

**Fora de escopo**
- Horário por unidade (Matriz, Malvinas e Monteiro seguem o mesmo horário — ver §11).
- Feriados municipais de Campina Grande e Monteiro; continuam entrando por `FERIADOS`.
- Reescrever `horario.js` como bounded context de domínio — isso é a Fase 3.
- Qualquer outra mudança no texto do `SYSTEM_SDR`.

## 5. Regras de negócio aplicáveis

| ID | Regra | Como esta spec a afeta |
|---|---|---|
| RN-060 | Expediente do time | **Altera**: passa a segunda a sábado, com sábado 08h-18h |
| RN-061 | Modo plantão fora do expediente | **Implementa de verdade**: hoje só a etiqueta do resumo funciona |
| RN-062 | Feriados | Preserva: feriado continua fechando qualquer dia, inclusive sábado |
| RN-021 | Toda mensagem termina com pergunta | Preserva: a instrução de plantão não altera o fecho |
| RN-020 | Nunca revelar que é IA | Preserva |

Alteração de RN-060 aprovada pelo negócio em 2026-08-11.

## 6. Casos de uso afetados

| ID | Caso de uso | Impacto |
|---|---|---|
| UC-005 | Transferir lead qualificado | Sábado deixa de gerar etiqueta de fora de expediente |
| UC-006 | Transferir por pedido do cliente | Idem |
| UC-001 | Atender mensagem | A resposta passa a refletir o plantão |

## 7. Critérios de aceite

- **CA-001** — Dado sábado às 10h, Quando consultar o expediente, Então está **aberto**.
- **CA-002** — Dado sábado às 07h59, Quando consultar, Então está fechado com motivo
  "antes do horário" e próximo expediente "hoje às 8h".
- **CA-003** — Dado sábado às 18h, Quando consultar, Então está fechado e o próximo expediente é
  "na segunda-feira às 9h" (domingo é pulado).
- **CA-004** — Dado sexta-feira às 19h, Quando consultar, Então o próximo expediente é
  "amanhã às 8h" (sábado, e não mais segunda).
- **CA-005** — Dado domingo às 10h, Quando consultar, Então está fechado com motivo "fim de semana"
  e próximo expediente "amanhã às 9h".
- **CA-006** — Dado um sábado que também é feriado, Quando consultar, Então está fechado com motivo
  "feriado".
- **CA-007** — Dado que a loja está fechada, Quando o bot gerar uma resposta, Então o prompt contém
  a instrução de que o time está fora do expediente **e** o próximo horário de retorno.
- **CA-008** — Dado que a loja está aberta, Quando o bot gerar uma resposta, Então o prompt **não**
  contém instrução de plantão.
- **CA-009** — Dado um lead qualificado no sábado às 10h, Quando o transbordo ocorrer, Então o resumo
  **não** leva a etiqueta `FORA DE EXPEDIENTE` nem a linha de retorno sugerido.
- **CA-010** — Dado dia útil das 09h às 18h, Quando consultar, Então o comportamento é **idêntico**
  ao de hoje (nenhuma regressão de segunda a sexta).

## 8. Comportamento observável

**Muda, e é o objetivo:**
- Sábado das 08h às 18h deixa de ser plantão: transferência ao vivo e resumo sem etiqueta.
- Fora do expediente, o texto que o cliente recebe passa a informar quando o consultor retorna, em
  vez de prometer atendimento imediato.

**Não muda:** dias úteis das 09h às 18h; domingos; feriados; todo o resto do fluxo.

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| A instrução de plantão fazer o bot encerrar a conversa ("volte segunda") | Média | Alto | O texto reforça RN-021 e RN-023: mantém o atendimento vivo, termina com pergunta |
| Horário de dia útil estar errado também (08h em vez de 09h) | Média | Médio | Tabela por dia: corrigir é mudar um número. Pergunta aberta em §11 |
| Sábado ter horário diferente por unidade | Baixa | Médio | Fora de escopo declarado; a tabela já prepara o terreno |

## 10. Métricas de sucesso

- Leads que chegam no sábado deixam de ser etiquetados como fora de expediente.
- Nenhuma resposta gerada fora do expediente promete atendimento imediato.

## 11. Questões em aberto (não bloqueiam)

- [ ] O horário de **segunda a sexta** continua 09h-18h? O código sempre usou isso, e nada indicou o
      contrário — mantido como está. Se a loja abre às 08h todos os dias, é mudar um número na tabela.
- [ ] **Monteiro** tem horário próprio? Assumido igual às unidades de Campina Grande.
