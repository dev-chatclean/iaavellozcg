# PLAN 0003 — Anti-Corruption Layer do payload de entrada

Plano técnico da [SPEC 0003](spec.md). **Aprovado por:** arquiteto-ddd.

## 1. Abordagem

Três peças, cada uma com uma responsabilidade:

- **`esquemas.js`** (infraestrutura) — declara o contrato dos formatos conhecidos e classifica o
  corpo recebido. Tolerante por decisão de projeto: campos opcionais e `passthrough`.
- **`tradutor.js`** (infraestrutura) — o ACL propriamente dito. Aplica os filtros de negócio e
  converte o payload externo no nosso formato. Sem I/O e sem `process.env`: as políticas chegam por
  parâmetro.
- **`MensagemRecebida` e `MotivoDeDescarte`** (domínio) — o vocabulário do nosso lado da fronteira.

`parsePayload` vira uma casca que injeta as políticas vindas da configuração, adapta o resultado ao
formato que o legado espera e faz o log.

**Decisão central: os nomes dos campos de `MensagemRecebida` são os mesmos que o legado já usava.**
Isso permite trocar o parse sem tocar em `processarMensagem` e faz os 50 testes de caracterização
valerem como prova de equivalência. Renomear para uma linguagem ubíqua melhor é tentador, mas
misturaria duas mudanças num passo só — fica para a Fase 3, quando o domínio for modelado.

## 2. Arquivos

**Criados**
| Arquivo | Responsabilidade |
|---|---|
| `src/infrastructure/chatclean/acl/esquemas.js` | Contrato dos 3 formatos; classificação |
| `src/infrastructure/chatclean/acl/tradutor.js` | Tradução, filtros de negócio, motivos |
| `src/domain/mensageria/MensagemRecebida.js` | Nosso formato de mensagem (congelado) |
| `src/domain/mensageria/MotivoDeDescarte.js` | 7 motivos nomeados + descrições |
| `test/unidade/tradutor-payload.test.js` | O que a ACL trouxe de novo |

**Alterados**
| Arquivo | Alteração |
|---|---|
| `index.js` | `parsePayload` delega; `ehGrupo`/`ticketStatus`/`deveResponderTicket` viram cascas; `drenarFila` não muta objeto congelado |

**Removidos** — as 75 linhas do `parsePayload` legado e as três funções auxiliares que viviam no
`index.js`.

## 3. Portas e contratos

```js
traduzir(corpo, { ignorarGrupos, apenasPendentes })
  -> MensagemRecebida  { aceita: true,  chatId, contactId, msgId, texto, tipo, media*, quotedText, nomeContato }
  -> MotivoDeDescarte  { aceita: false, motivo, detalhe, descricao }
```

O discriminador `aceita` permite ao chamador tratar os dois casos sem `null`. Ainda não é uma porta
com adapters — é o ACL de um canal específico. A porta `CanalDeMensagem` (entrada) nasce na Fase 2.

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|
| Anti-Corruption Layer | `acl/` | O formato do ChatClean não contamina o resto |
| Value Object | `MensagemRecebida` | Congelado, com campos garantidos |
| Resultado discriminado | `{ aceita: true \| false }` | Descarte deixa de ser `null` mudo |
| Tolerant Reader | Esquemas com `passthrough` e campos opcionais | Mudança do fornecedor não derruba o atendimento |
| Injeção de política | `ignorarGrupos`, `apenasPendentes` | Infraestrutura sem `process.env` |

## 5. Estratégia de coexistência

Não há coexistência: a troca é atômica e protegida pelos 50 testes de caracterização. Manter os dois
parses em paralelo exigiria comparar resultados em produção — esforço que só se justifica quando o
teste não consegue provar equivalência. Aqui consegue.

## 6. Feature toggle

Nenhuma. Rollback é `git revert`, e o critério de sucesso (CA-001) é verificável antes do merge.

## 7. Migração de dados

Nenhuma.

## 8. Estratégia de teste

| Nível | O que cobre | Arquivo |
|---|---|---|
| Caracterização | Equivalência com o legado — **critério central** | `parsePayload.test.js` (sem alteração) |
| Unidade | Motivos nomeados, classificação, políticas, tolerância | `tradutor-payload.test.js` |
| Integração | Turno completo continua funcionando | `turno.test.js` |
| Linha de base | Rotas HTTP e log | `test/baseline/` |

**Como provamos que não quebrou:** se os 50 testes de caracterização precisarem de qualquer ajuste,
o contrato mudou e a fatia está errada.

## 9. Plano de rollback

`git revert`. Menos de 2 minutos, sem estado a desfazer.

## 10. Impacto em performance e custo

Uma validação zod por webhook recebido, sobre um objeto pequeno. Irrelevante frente às duas chamadas
de LLM do turno.

## 11. Sequência de PRs

Um só: as peças não fazem sentido separadas, e o critério de aceite só é verificável com tudo ligado.
