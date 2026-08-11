# PLAN NNNN — <Título>

Plano técnico da [SPEC NNNN](spec.md). **Aprovado por:** arquiteto-ddd.

## 1. Abordagem

Como a fatia será implementada, em 3–5 frases. Qual padrão, qual porta, qual camada.

## 2. Arquivos

**Criados**
| Arquivo | Responsabilidade |
|---|---|

**Alterados**
| Arquivo | Alteração |
|---|---|

**Removidos** *(nesta fatia ou em fatia futura — diga qual)*
| Arquivo | Quando |
|---|---|

## 3. Portas e contratos

```js
// Assinaturas das interfaces envolvidas
```

Adapters: real e fake. Ambos entram no mesmo PR (regra do projeto).

## 4. Padrões aplicados

| Padrão | Onde | Por quê |
|---|---|---|

## 5. Estratégia de coexistência (Strangler Fig)

1. O que nasce ao lado do legado.
2. Como o legado passa a delegar.
3. **Quando e como o legado morre** (nesta fatia, ou em qual spec futura).

## 6. Feature toggle

| Flag | Padrão | Efeito |
|---|---|---|

Necessária? Se não, justifique (ex.: "refatoração coberta por caracterização, reversível por revert").

## 7. Migração de dados

O estado já gravado no Redis continua legível? Precisa de `schemaVersion` / migração na leitura?

## 8. Estratégia de teste

| Nível | O que cobre | Arquivo |
|---|---|---|
| Unidade | | |
| Caracterização | | |
| Contrato | | |
| Integração | | |
| Eval | | |

**Como provamos que não quebrou:** …

## 9. Plano de rollback

Passo a passo, em minutos. Se não couber em minutos, o plano está errado.

## 10. Impacto em performance e custo

Chamadas de LLM a mais/menos? Escritas no Redis? Latência do turno?

## 11. Sequência de PRs

1. PR 1 — …
2. PR 2 — …
