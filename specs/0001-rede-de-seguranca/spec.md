# SPEC 0001 — Rede de segurança: testes, lint e CI

| | |
|---|---|
| **Status** | Aprovada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 |
| **Fase do plano** | Fase 0 — Rede de segurança |
| **Dívida endereçada** | D-12 (zero testes), D-13 (sem lint/CI) |
| **Depende de** | — |

## 1. Contexto de negócio

A IA Avelloz Campina está em produção atendendo leads reais e é a primeira porta de entrada comercial
da loja. Cada conversa mal conduzida é uma venda perdida. O código foi escrito por um desenvolvedor
que não está mais no projeto, tem 1.500 linhas, **nenhum teste automatizado** e concentra 8
responsabilidades num único arquivo.

A empresa quer refatorar para conseguir evoluir o produto com segurança. Mas refatorar código sem
teste é reescrever às cegas: qualquer mudança pode quebrar silenciosamente o bloqueio de diagnóstico
(RN-001), o roteamento por loja (RN-041) ou a proteção anti-loop (RN-054) — e ninguém vai saber até
um cliente reclamar.

## 2. Problema

Não existe forma de verificar que uma mudança no código preservou o comportamento do bot. Hoje a única
verificação é rodar `npm run chat` e conversar manualmente — o que **gasta crédito da OpenAI**, é não
determinístico e cobre um caminho por vez.

Consequência prática: **nenhuma das outras 17 specs da refatoração pode começar.**

## 3. Resultado esperado

Existe uma suíte automatizada que roda em segundos, sem rede e sem custo, e que **falha** se o
comportamento observável do bot mudar. A partir dela, refatorar deixa de ser aposta.

## 4. Escopo

**Dentro**
- Framework de teste, lint e formatter configurados; scripts no `package.json`.
- Testes unitários da lógica determinística: fluxo de qualificação, expediente/feriados, roteamento
  de departamento, normalização de telefone, autorização de webhook, rate-limit.
- Testes de caracterização do `parsePayload`, `montarResumo` e `determinarProximoCampo`.
- Teste de integração ("teste dourado") do turno completo com OpenAI, Push e Redis falsos.
- Pipeline de CI executando lint e testes a cada push.

**Fora de escopo**
- Qualquer alteração de comportamento do bot. **Zero.**
- Extração de módulos ou reorganização de diretórios — exceto os utilitários de telefone (§8).
- Correção dos bugs que os testes revelarem (viram issues; o teste congela o comportamento atual).
- Evals de conversa com LLM (spec 0011).
- Validação de configuração e endurecimento de segurança (spec 0002).

## 5. Regras de negócio aplicáveis

| ID | Regra | Como esta spec a afeta |
|---|---|---|
| RN-001 | Bloqueio de diagnóstico | **Preserva** — cenário obrigatório do teste dourado |
| RN-002 | Ordem do funil | **Preserva** — caracterização de `determinarProximoCampo` |
| RN-003 | Política de sobrescrita | **Preserva** — unitário de `aplicarCampos` |
| RN-005 | Perfil de dor | **Preserva** — unitário de `detectarPerfil`, incluindo precedência |
| RN-040/041 | Loja obrigatória e roteamento | **Preserva** — unitário de `lojaParaDepartamento` |
| RN-050..058 | Proteções operacionais | **Preserva** — caracterização de `parsePayload` e do rate-limit |
| RN-060..062 | Expediente e feriados | **Preserva** — unitário de `horario.js` |
| RN-070/071 | Reativação e reset | **Preserva** — teste dourado com relógio controlado |

Nenhuma regra é alterada por esta spec.

## 6. Casos de uso afetados

Nenhum é alterado. São **cobertos** por teste: UC-001, UC-002, UC-005, UC-006, UC-007, UC-009,
UC-010, UC-011, UC-012, UC-013, UC-015, UC-016.

## 7. Critérios de aceite

- **CA-001** — **Dado** o repositório limpo, **Quando** rodar `npm test`, **Então** a suíte executa em
  menos de 10 segundos, **E** não realiza nenhuma chamada de rede.
- **CA-002** — **Dado** um payload no formato aninhado do ChatClean com o telefone apenas em
  `message.raw.Info.SenderAlt` como `"558491756446:24@s.whatsapp.net"`, **Quando** for interpretado,
  **Então** o `chatId` resultante é `"558491756446"` (sem o sufixo de dispositivo).
- **CA-003** — **Dado** um payload marcado como grupo por qualquer um dos cinco sinais suportados
  (`ticket.isGroup`, `ticket.status='group'`, `raw.Info.IsGroup`, `body.isGroup`, JID com `@g.us`),
  **Quando** for interpretado, **Então** é descartado.
- **CA-004** — **Dado** um ticket com `userId` humano atribuído, **Quando** chegar uma mensagem,
  **Então** o bot não responde (RN-052).
- **CA-005** — **Dado** um lead sem `gastoMensal`, **Quando** enviar "quanto custa a AZ1?" no teste
  dourado, **Então** o prompt entregue ao redator contém a instrução de bloqueio de diagnóstico
  (RN-001). *(A verificação da resposta gerada é da spec 0011.)*
- **CA-006** — **Dado** um lead com todos os campos do funil preenchidos, **Quando** o turno terminar,
  **Então** a equipe é notificada uma única vez, com o departamento correspondente à loja escolhida,
  **E** o atendimento fica `finalizado`.
- **CA-007** — **Dado** um lead que enviou a mesma mensagem três vezes, **Quando** chegar a terceira,
  **Então** nenhuma resposta é enviada ao cliente **E** a equipe é avisada uma única vez (RN-054).
- **CA-008** — **Dado** um atendimento com `ultimaInteracao` de 25 horas atrás, **Quando** chegar uma
  mensagem, **Então** o estado anterior é descartado e a conversa recomeça (RN-071).
- **CA-009** — **Dado** um sábado às 10h, **Quando** consultar o expediente, **Então** o resultado é
  fechado com motivo "fim de semana" e o próximo expediente é "na segunda-feira às 9h".
- **CA-010** — **Dado** o número `5584994610845` na allow-list, **Quando** chegar mensagem de
  `558494610845`, **Então** o contato é permitido (tolerância ao 9º dígito).
- **CA-011** — **Dado** qualquer push para o `main`, **Quando** o CI rodar, **Então** lint e testes
  executam e falham o build em caso de erro.
- **CA-012** — **Dado** a suíte completa, **Quando** medir cobertura, **Então** `flow.js`,
  `horario.js`, `data.js` e os utilitários de telefone estão acima de 70%.

## 8. Comportamento observável

**Nada muda para o lead, para o vendedor ou para o operador.** Esta spec adiciona apenas arquivos de
teste e configuração.

Única exceção autorizada: as funções `normalizarPhone`, `nucleoNumero` e `contatoPermitido` podem ser
movidas de `index.js` para `src/shared/telefone.js`, com `index.js` importando de lá. É uma extração
mecânica, sem alteração de lógica, coberta pelos testes criados na mesma tarefa.

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Os testes de caracterização congelam um bug como se fosse regra | Alta | Médio | É intencional. Cada bug encontrado vira issue com o teste marcado `// CONGELA BUG #N` |
| Fixtures de payload inventadas não refletem a produção | Média | Alto | Coletar payloads reais anonimizados do log antes de escrever os testes |
| A suíte fica lenta e a equipe para de rodá-la | Média | Alto | Meta dura de < 10s; nenhuma chamada de rede; sem `setTimeout` real |
| Extração dos utilitários de telefone quebra a allow-list | Baixa | Alto | Testes escritos **antes** da extração; CA-002 e CA-010 cobrem |

## 10. Métricas de sucesso

- Cobertura global > 40% e > 70% nos módulos determinísticos.
- Tempo da suíte < 10s.
- ≥ 12 casos de caracterização em `parsePayload`.
- 15 cenários do teste dourado verdes.
- CI verde no `main` por 7 dias consecutivos.

## 11. Questões em aberto

- [ ] Há payloads reais de produção disponíveis no log do servidor para virar fixture? *(sem eles, os
      testes de `parsePayload` cobrem menos do que deveriam)*
- [ ] O CI roda em GitHub Actions ou em outro provedor? *(a Hostinger não hospeda o CI)*
