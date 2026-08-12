# SPEC 0006 — Domínio do atendimento

| | |
|---|---|
| **Status** | Implementada |
| **Autor** | analista-specs |
| **Criada em** | 2026-08-12 |
| **Fase do plano** | Fase 3 — Domínio |
| **Dívida endereçada** | D-03 (regras espalhadas), D-07 (parcial) |
| **Depende de** | SPEC 0004 |

## 1. Contexto de negócio

O que diferencia este produto de um chatbot qualquer é a **metodologia comercial**: diagnosticar
antes de vender, mostrar a conta do que o cliente já gasta, recomendar o modelo que encaixa, e só
então entregar ao vendedor. Essa metodologia é o ativo da empresa.

Hoje ela não mora em lugar nenhum específico. Está diluída entre o texto de um prompt, uma expressão
booleana no meio de uma função de formatação, uma lista de campos num arquivo e `if`s soltos numa
função de 290 linhas.

## 2. Problema

**D-03 — a mesma regra em quatro lugares.** RN-001, a regra que sustenta a venda inteira, está
escrita no `SYSTEM_SDR` **e** implementada como `!!(transporteAtual && gastoMensal && situacaoMoto)`
dentro de `promptResposta`. Quem muda uma não sabe da outra.

**Não dá para testar uma regra isoladamente.** Verificar RN-001 exige montar o sistema inteiro com
fakes e inspecionar o prompt gerado. Uma regra de negócio deveria ser uma chamada de função.

**A ordem do funil, a política de sobrescrita e a classificação de perfil** vivem em `flow.js`
misturadas à mecânica de mutação do `leadData`.

## 3. Resultado esperado

Cada regra de negócio tem um nome, um arquivo e um teste. Mudar a metodologia comercial passa a ser
mexer no domínio, não caçar expressões booleanas espalhadas.

## 4. Escopo

**Dentro** — extrair para `src/domain/atendimento/`, sem alterar comportamento:
- `EtapaDoFunil` (RN-002), `Qualificacao` (RN-003), `Perfil` (RN-005)
- `PoliticaDeDiagnostico` (RN-001), `PoliticaDeTransbordo` (RN-040..042, RN-061)
- `MontadorDeResumo` (RN-043)
- `flow.js` vira fachada; `prompts.js` e `index.js` consultam o domínio

**Fora de escopo**
- **Corrigir o D-06.** O domínio nasce puro, mas a fachada preserva o efeito colateral: corrigi-lo
  muda comportamento observável e tem spec própria.
- O agregado `Atendimento` com máquina de estados explícita (D-09) — depende da spec 0008, quando o
  turno virar caso de uso.
- Value objects de `Cpf`, `Dinheiro`, `Telefone` (D-07 completo) — a `CalculadoraDeEconomia` e o
  mascaramento de CPF são de outras fatias.
- Mover `data.js` para `domain/catalogo`.

## 5. Regras de negócio aplicáveis

RN-001, RN-002, RN-003, RN-004, RN-005, RN-040, RN-041, RN-042, RN-043, RN-061.
**Nenhuma muda** — todas apenas ganham lugar próprio.

## 6. Critérios de aceite

- **CA-001** — Os 369 testes existentes continuam verdes **sem alteração**.
- **CA-002** — A linha de base (requisições e log) permanece idêntica.
- **CA-003** — RN-001 é verificável por chamada direta de função, sem montar o sistema.
- **CA-004** — `EtapaDoFunil.proxima()` não altera o objeto consultado, com teste que prova.
- **CA-005** — `Qualificacao.aplicar()` não muta a entrada.
- **CA-006** — O efeito colateral do D-06 continua acontecendo pela fachada, e o teste que o congela
  segue verde.
- **CA-007** — Cobertura de 100% nos módulos de domínio criados.
- **CA-008** — Nenhum módulo de domínio importa infraestrutura (verificado por lint).

## 7. Comportamento observável

**Nada muda.**

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Divergência sutil ao reescrever `montarResumo` | Média | Alto | Caracterização byte a byte já existe desde a Fase 0 |
| Perder a precedência da classificação de perfil | Média | Médio | Teste de precedência existe desde a Fase 0 |
| "Já que estamos aqui, vamos corrigir o D-06" | **Alta** | Alto | Escopo declarado; o teste que congela o defeito é o guarda |
