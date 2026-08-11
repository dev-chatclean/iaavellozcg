# SPEC 0003 — Anti-Corruption Layer do payload de entrada

| | |
|---|---|
| **Status** | Aprovada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-11 |
| **Fase do plano** | Fase 1 — ACL da borda |
| **Dívida endereçada** | D-01 (parcial), D-29 |
| **Depende de** | SPEC 0001, SPEC 0002 |

## 1. Contexto de negócio

Toda conversa entra no sistema por um único ponto: o webhook do ChatClean. Se esse ponto interpretar
mal um payload, o lead simplesmente não é atendido — e ninguém percebe, porque o webhook responde
`200` de qualquer jeito.

O formato do payload não é nosso: é do ChatClean, e varia conforme o canal (WhatsApp Web, WhatsApp
Oficial/WABA, integrações simples). Hoje esse formato alheio está espalhado pelo código.

## 2. Problema

`parsePayload` tem 75 linhas que fazem, ao mesmo tempo: reconhecer três formatos diferentes, aplicar
quatro filtros de negócio, extrair dez campos por cadeias de fallback, e logar. É a maior
concentração de conhecimento sobre um sistema externo dentro do nosso código.

**Todos os descartes devolvem o mesmo `null`.** Grupo, eco do próprio bot, ticket já assumido por um
vendedor, formato desconhecido e payload sem telefone são situações completamente diferentes — para
o chamador, são idênticas. Não dá para medir, alertar nem diagnosticar. Quando um lead não é
atendido, não há como saber por quê sem ler o log linha a linha.

**Nada é validado.** Um campo ausente vira `undefined` silencioso e segue adiante. O
[D-29](../../docs/09-divida-tecnica.md) é sintoma disso: com corpo `undefined`, a própria linha de log
do erro quebra e reporta um problema no lugar errado.

## 3. Resultado esperado

O formato do ChatClean fica confinado numa camada de tradução. O resto do sistema passa a receber uma
mensagem no **nosso** formato, e cada descarte passa a ter um motivo nomeado, contável e alertável.

## 4. Escopo

**Dentro**
- Esquemas declarativos dos três formatos aceitos, servindo como contrato documentado.
- Tradutor que converte payload externo em `MensagemRecebida` (nosso formato) ou devolve um
  `MotivoDeDescarte` nomeado.
- `parsePayload` vira uma casca fina que delega ao tradutor.
- Log de descarte passa a citar o motivo.

**Fora de escopo**
- **Rejeitar** payload que não case com o esquema. O tradutor é tolerante: valida para documentar e
  medir, não para barrar. Barrar um formato novo do ChatClean deixaria leads sem atendimento — é
  exatamente o risco que um ACL existe para evitar.
- Fila, deduplicação, rate-limit e o resto do `handleWebhook` — Fase 8.
- `ChatId` como value object com validação forte — Fase 3.
- Qualquer mudança no processamento da mensagem depois do parse.

## 5. Regras de negócio aplicáveis

| ID | Regra | Como esta spec a afeta |
|---|---|---|
| RN-050 | Não responder em grupos | **Preserva**, com motivo nomeado |
| RN-051 | Não responder ao próprio eco | **Preserva**, com motivo nomeado |
| RN-052 | Bot de fila (não responde ticket assumido) | **Preserva**, distinguindo "assumido" de "encerrado" |
| RN-055 | Mensagem duplicada é ignorada | Preserva (continua fora do tradutor) |

Nenhuma regra muda.

## 6. Casos de uso afetados

| ID | Caso de uso | Impacto |
|---|---|---|
| UC-001 | Atender mensagem de texto | Mesmo comportamento, outro caminho de código |
| UC-016 | Ignorar mensagem que não deve ser respondida | Motivo do descarte passa a ser explícito |

## 7. Critérios de aceite

- **CA-001** — Dados os 50 testes de caracterização do `parsePayload` escritos na Fase 0, Quando
  rodarem contra a nova implementação, Então passam **sem nenhuma alteração**. Este é o critério
  central: o contrato não mudou.
- **CA-002** — Dado um payload de grupo, Quando traduzido, Então o motivo do descarte é `grupo`.
- **CA-003** — Dado um payload com `fromMe`, Então o motivo é `eco`.
- **CA-004** — Dado um ticket com `userId` humano, Então o motivo é `ticket-assumido`; dado um ticket
  `closed`, o motivo é `ticket-encerrado` (situações distintas, motivos distintos).
- **CA-005** — Dado um payload sem telefone identificável, Então o motivo é `sem-telefone`.
- **CA-006** — Dado o formato `numero_cliente`, Então o motivo é `formato-duplicado`.
- **CA-007** — Dado um payload irreconhecível, Então o motivo é `formato-desconhecido`.
- **CA-008** — Dado `undefined` como corpo, Quando traduzido, Então devolve `formato-desconhecido`
  **sem lançar exceção interna** (corrige D-29).
- **CA-009** — Dado um payload aceito, Quando traduzido, Então o resultado é congelado e traz
  exatamente os campos de `MensagemRecebida`.
- **CA-010** — Dado um payload que não casa com nenhum esquema mas tem telefone e conteúdo, Então é
  **aceito** e a divergência é registrada — o tradutor não barra formato novo.
- **CA-011** — Dado qualquer descarte, Quando o log for escrito, Então cita o motivo nomeado.
- **CA-012** — Dada a linha de base, Quando comparada, Então as rotas HTTP permanecem idênticas.

## 8. Comportamento observável

**Não muda nada** para o lead, para o vendedor nem para as rotas. Muda o texto de algumas linhas de
log, que passam a citar o motivo do descarte.

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Um formato real de produção deixar de ser reconhecido e o lead ficar sem resposta | Média | **Alto** | Tradutor tolerante por princípio (CA-010): esquema documenta e mede, não barra. Mais os 50 testes de caracterização como contrato |
| Perder um fallback sutil de extração de telefone | Média | Alto | A cadeia de precedência está coberta teste a teste desde a Fase 0 |
| ACL virar mais uma camada sem valor | Baixa | Médio | O valor é concreto: motivo de descarte contável e um único lugar para o formato externo |

## 10. Métricas de sucesso

- Descartes contáveis por motivo (insumo direto para as métricas da spec 0015).
- Nenhuma alteração nos 50 testes de caracterização.
- Todo o conhecimento do formato ChatClean concentrado em um diretório.
