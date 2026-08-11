# SPEC NNNN — <Título>

| | |
|---|---|
| **Status** | Rascunho |
| **Autor** | |
| **Criada em** | AAAA-MM-DD |
| **Fase do plano** | Fase N — <nome> |
| **Dívida endereçada** | D-NN, S-N |
| **Depende de** | SPEC NNNN |

## 1. Contexto de negócio

Por que isso existe. Qual dor da operação, do vendedor ou do lead está em jogo.
Escreva para alguém que não conhece o código.

## 2. Problema

O que está errado ou faltando hoje, de forma observável. Se possível, com número
(ex.: "X% dos leads recebem preço antes do diagnóstico").

## 3. Resultado esperado

O estado do mundo depois desta spec. Uma ou duas frases.

## 4. Escopo

**Dentro**
- …

**Fora de escopo** *(explícito — evita crescimento silencioso)*
- …

## 5. Regras de negócio aplicáveis

| ID | Regra | Como esta spec a afeta |
|---|---|---|
| RN-NNN | | Preserva / implementa / altera |

> Se alguma regra **muda**, isso precisa de aprovação do negócio e de atualização em
> `docs/03-regras-de-negocio.md`.

## 6. Casos de uso afetados

| ID | Caso de uso | Impacto |
|---|---|---|
| UC-NNN | | |

## 7. Critérios de aceite

- **CA-001** — **Dado** … **Quando** … **Então** … **E** …
- **CA-002** — …

Cada CA vira pelo menos um teste automatizado.

## 8. Comportamento observável

O que muda para o lead, para o vendedor e para o operador? Se a resposta for "nada"
(refatoração pura), **escreva isso explicitamente** — é o critério mais forte de sucesso.

## 9. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|

## 10. Métricas de sucesso

Como saberemos, em produção, que deu certo.

## 11. Questões em aberto

- [ ] …
