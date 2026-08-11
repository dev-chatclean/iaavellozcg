# 04 — Casos de Uso

Formato: ator, gatilho, pré-condições, fluxo principal, fluxos alternativos, pós-condições, regras.
Estes IDs (`UC-NNN`) são referenciados em specs e testes.

## Atores

| Ator | Papel |
|---|---|
| **Lead** | Pessoa interessada em comprar uma moto. Ator primário. |
| **Cliente atual** | Já comprou; procura pós-venda. |
| **Consultor humano** | Vendedor da loja que recebe o transbordo. |
| **ChatClean** | Sistema externo de transporte (webhook + push + CRM). |
| **OpenAI** | Sistema externo de inteligência (chat, visão, transcrição). |
| **Relógio** | Ator temporal — dispara reativação, reset e mudança de expediente. |
| **Administrador** | Opera e diagnostica o serviço. |

---

## UC-001 — Atender uma mensagem de texto do lead

**Ator:** Lead · **Gatilho:** `POST /webhook` com mensagem de texto

**Pré-condições:** webhook autorizado; contato na allow-list (se houver); não é grupo, não é eco,
ticket não assumido por humano; dentro do rate-limit; `msgId` não processado.

**Fluxo principal**
1. Sistema responde 200 imediatamente e enfileira a mensagem por `chatId`.
2. Aguarda a janela de agrupamento (2s) e concatena mensagens de texto consecutivas (UC-011).
3. Adquire lock local e distribuído do atendimento.
4. Carrega o atendimento; se inativo > 24h, descarta e recomeça (UC-013).
5. Registra a interação e cancela reativação pendente.
6. Verifica blindagem anti-loop (UC-015).
7. Determina o próximo campo do funil.
8. Extrai campos e sinais da mensagem via LLM (UC-002).
9. Aplica campos segundo a política de sobrescrita (RN-003) e reclassifica o perfil.
10. Avalia desvios: cliente atual (UC-007), pedido de humano (UC-006).
11. Recalcula o próximo campo.
12. Gera a resposta com persona, estado e o bloqueio de diagnóstico ativo (RN-001).
13. Envia a resposta quebrada em mensagens curtas.
14. Atualiza o histórico (podado em 100 entradas).
15. Se a qualificação fechou, executa o transbordo (UC-005); senão agenda reativação (UC-012).
16. Salva o estado e libera os locks.

**Alternativos**
- **A1 — Falha na extração:** segue o turno sem novos campos, usando só o histórico.
- **A2 — Falha na geração:** envia mensagem de instabilidade, preserva o extraído e encerra o turno.
- **A3 — Já processando o mesmo chat:** a mensagem permanece na fila e é drenada em seguida.
- **A4 — `/reset`:** apaga o estado e confirma (UC-014).

**Pós-condições:** estado persistido; resposta entregue ou falha registrada; locks liberados.

**Regras:** RN-001, RN-002, RN-003, RN-020..RN-028, RN-053..RN-057.

---

## UC-002 — Extrair informações estruturadas da mensagem

**Ator:** Sistema (LLM) · **Gatilho:** cada turno do lead

**Fluxo**
1. Sanitiza (remove `<`/`>`, trunca em 1000 chars).
2. Monta o prompt de extração com o campo esperado do funil.
3. Chama `gpt-4o-mini` (temp 0, `json_object`) com as últimas 4 entradas do histórico.
4. Faz parse do JSON e devolve campos + sinais (`objecao`, `perguntou`, `querFalarComHumano`,
   `tipoContato`, `correcao[]`).

**Alternativos**
- **A1 — JSON inválido / erro de API:** retorna `null`; o turno prossegue sem novos campos.
- **A2 — Tentativa de jailbreak ou assunto fora do domínio:** todos os campos voltam `null` (RN-025).

**Regras:** RN-003, RN-011, RN-025.

---

## UC-003 — Executar o diagnóstico consultivo

**Ator:** Lead · **Gatilho:** funil chega em `transporteAtual`

**Fluxo**
1. Pergunta como o lead se locomove hoje.
2. Pergunta quanto ele gasta por mês — **fazendo-o dizer o número em reais**.
3. Descobre a situação de moto (tem? própria, alugada, velha, manutenção cara?).
4. Com os três preenchidos, projeta o gasto no ano e apresenta a conta ("isso dá R$ X por ano…").
5. Libera a recomendação de modelo e o preço (UC-004).

**Alternativo A1 — Lead pede preço/modelo/catálogo antes da hora:** o sistema redireciona com
naturalidade para o diagnóstico, sem revelar nada de produto (**RN-001**). Este é o cenário de teste
mais importante do projeto.

**Alternativo A2 — Lead roda de aplicativo:** o gancho muda conforme o perfil (aluga / começando /
quer trocar) e o valor do aluguel semanal vira a âncora da conta.

**Pós-condições:** `transporteAtual`, `gastoMensal`, `situacaoMoto` preenchidos; perfil classificado.

**Regras:** RN-000, RN-001, RN-005.

---

## UC-004 — Recomendar modelo e informar preço

**Pré-condição:** diagnóstico completo (RN-001 satisfeita).

**Fluxo**
1. Recomenda **um** modelo que encaixa na dor declarada (RN-013).
2. Envia descrição e link da imagem, conectando ao que o lead disse.
3. Quando o lead demonstra interesse, informa o preço promocional com emplacamento — **uma vez**.
4. Avança para forma de pagamento.

**Alternativos**
- **A1 — Lead pergunta valor de parcela:** o sistema não informa e encaminha ao consultor (RN-010).
- **A2 — Lead traz objeção:** aplica a resposta consultiva mapeada e volta ao fluxo (UC-008).
- **A3 — Lead muda de modelo:** o campo é mutável, o último valor vence (RN-003).

**Regras:** RN-010, RN-011, RN-012, RN-013, RN-014, RN-015.

---

## UC-005 — Transferir o lead qualificado ao consultor

**Gatilho:** todos os campos do funil preenchidos, incluindo a loja.

**Fluxo**
1. Marca a qualificação como completa.
2. Resolve o departamento a partir da loja escolhida (RN-041).
3. Monta o resumo estruturado (diagnóstico + escolhas + dados de simulação).
4. Publica o resumo como **nota interna** no ticket do cliente.
5. Envia o resumo ao WhatsApp interno da equipe, se configurado.
6. Registra o lead no histórico append-only.
7. Marca o atendimento como finalizado e cancela a reativação.

**Alternativos**
- **A1 — Fora de expediente:** o resumo é etiquetado `FORA DE EXPEDIENTE — AGENDAR RETORNO` e ganha
  a linha "Retorno sugerido: \<próximo expediente\>" (RN-061).
- **A2 — Loja não identificada:** cai no departamento `Comercial`. *(Só deveria ocorrer via UC-006 —
  no fluxo normal a loja é obrigatória, RN-040.)*

**Pós-condições:** `finalizado = true`; equipe notificada; lead no histórico.

**Regras:** RN-040, RN-041, RN-043, RN-061.

---

## UC-006 — Transferir por pedido explícito do lead

**Gatilho:** extração retorna `querFalarComHumano = true`.

**Fluxo:** o sistema gera a mensagem de handoff pela própria IA (tom caloroso), notifica a equipe no
departamento da loja (ou `Comercial`) e finaliza — **mesmo com o funil incompleto**.
**Alternativo A1 —** falha na geração ⇒ mensagem de handoff padrão, variando por expediente.

**Regras:** RN-042, RN-041, RN-061.

---

## UC-007 — Rotear cliente atual para o Pós-venda

**Gatilho:** extração retorna `tipoContato = 'cliente'`.

**Fluxo:** responde pedindo a unidade onde comprou, notifica o departamento **Pós-venda** e finaliza
o atendimento comercial.

**Regras:** RN-041.

---

## UC-008 — Contornar uma objeção

**Gatilho:** extração retorna `objecao` (uma das nove mapeadas).

**Fluxo:** o gancho consultivo correspondente é injetado no prompt do turno; a resposta reconhece a
objeção, vira a chave e termina com pergunta. O sinal é transitório (vale só naquele turno).

**Regras:** RN-014, RN-030, RN-031, RN-032, RN-033, RN-021.

---

## UC-009 — Processar mídia enviada pelo lead

**Gatilho:** mensagem com `tipo` ≠ `text`.

| Tipo | Fluxo | Encerra o turno? |
|---|---|---|
| `image` | Visão (`gpt-4o`) descreve; a descrição entra no histórico e no prompt | Não — segue a qualificação |
| `audio` / `ptt` | Download + Whisper ⇒ vira o texto do turno | Não |
| `video` | Download + Whisper na trilha ⇒ vira o texto do turno | Não |
| `document` | Acuse humanizado, registro para o consultor | **Sim** |
| outros (sticker, localização) | Pede texto | **Sim** |

**Alternativos**
- **A1 — Falha ao transcrever áudio:** pede que escreva; encerra o turno.
- **A2 — Falha ao baixar mídia:** informa que não conseguiu abrir; encerra o turno.
- **A3 — Falha na visão:** registra "[O cliente enviou uma imagem]" sem descrição e segue.

**Regras:** RN-028.

---

## UC-010 — Atender o lead após o transbordo

**Pré-condição:** `finalizado = true`. **Gatilho:** nova mensagem do lead.

**Fluxo:** prompt curto e dedicado responde dúvidas pontuais — sem refazer o funil, sem repetir o
resumo, sem informar parcela nem prazo. Falha na geração ⇒ resposta padrão de acolhimento.

**Regras:** RN-044, RN-010, RN-032.

---

## UC-011 — Agrupar mensagens em rajada

**Gatilho:** múltiplas mensagens de texto do mesmo chat dentro da janela de 2s.
**Fluxo:** o debounce reinicia a cada chegada; ao expirar, os textos são concatenados por `\n` num
único turno, preservando o primeiro `nomeContato`, `quotedText` e `contactId` encontrados. Mídia
interrompe o agrupamento e drena imediatamente.
**Regras:** RN-057.

---

## UC-012 — Reativar lead inativo (follow-up de 30 min)

**Ator:** Relógio · **Gatilho:** varredor a cada 2 min encontra `followUpDueAt` vencido.

**Fluxo:** carrega o atendimento; se não está finalizado nem sendo processado, monta a mensagem de
reativação conforme o campo faltante, envia e limpa o vencimento.
**Alternativo A1 —** a mensagem seria idêntica à última reativação ⇒ não envia.
**Regras:** RN-070.

---

## UC-013 — Reiniciar atendimento por inatividade (24h)

**Ator:** Relógio (avaliado na próxima mensagem) · **Fluxo:** o estado antigo é apagado e a conversa
recomeça do zero, como um lead novo. **Regras:** RN-071.

---

## UC-014 — Resetar o atendimento manualmente

**Ator:** Administrador/Tester · **Gatilho:** mensagem `/reset` · **Fluxo:** apaga o estado e
confirma. Uso previsto: homologação.

---

## UC-015 — Conter loop com outro bot

**Gatilho:** mais de 15 turnos em 3 min **ou** a mesma mensagem 3×.
**Fluxo:** o sistema para de responder aquele contato, avisa a equipe uma única vez e retoma quando o
volume normaliza (≤ 2 turnos na janela). **Regras:** RN-054.

---

## UC-016 — Ignorar mensagem que não deve ser respondida

**Fluxo (curto-circuito no parse):** descarta eco próprio (`fromMe`), grupo (`@g.us` /
`ticket.isGroup`), ticket `closed`, ticket com `userId` humano atribuído, contato fora da allow-list,
`msgId` duplicado, excesso de rate-limit e o formato duplicado `numero_cliente`.
**Regras:** RN-050, RN-051, RN-052, RN-053, RN-055, RN-058.

---

## UC-017 — Diagnosticar o serviço

**Ator:** Administrador · **Fluxo:** `GET /diag` com `ADMIN_KEY` devolve expediente atual, janela de
reset, se o Redis está ativo, se o push e a equipe estão configurados e o diagnóstico do pipeline.
`GET /leads` lista atendimentos ativos. Sem `ADMIN_KEY` no servidor, ambos respondem 503 (fail-closed).

---

## UC-018 — Simular a conversa localmente

**Ator:** Desenvolvedor · **Fluxo:** `npm run chat` (REPL interativo) e `npm run sim` (roteiro
completo de 12 mensagens, com resumo e custo de tokens). Consomem crédito real da OpenAI.
**Dívida:** ambos reimplementam o turno e já divergem da produção (D-04).

---

## Matriz Caso de Uso × Regras

| UC | Regras principais |
|---|---|
| UC-001 | RN-001..003, RN-020..028, RN-053..057 |
| UC-002 | RN-003, RN-011, RN-025 |
| UC-003 | **RN-000, RN-001**, RN-005 |
| UC-004 | RN-010..015 |
| UC-005 | **RN-040**, RN-041, RN-043, RN-061 |
| UC-006 | RN-042, RN-041 |
| UC-007 | RN-041 |
| UC-008 | RN-014, RN-030..033 |
| UC-009 | RN-028 |
| UC-010 | RN-044, RN-010, RN-032 |
| UC-011 | RN-057 |
| UC-012 | RN-070 |
| UC-013 | RN-071 |
| UC-015 | RN-054 |
| UC-016 | RN-050..052, RN-055, RN-058 |
