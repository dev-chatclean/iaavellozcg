# Specs — Spec-Driven Development

Neste projeto **nenhum código é escrito sem spec aprovada**. A spec é a fonte da verdade sobre o que
o sistema deve fazer; o código é apenas a implementação atual dela.

## O ciclo

```
┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│  SPEC  │──>│  PLAN  │──>│ TASKS  │──>│  CODE  │──>│ VERIFY │
│ o quê  │   │ o como │   │ passos │   │+ testes│   │ aceite │
│ porquê │   │técnico │   │ordenad.│   │        │   │        │
└────────┘   └────────┘   └────────┘   └────────┘   └────────┘
 analista-    arquiteto-   arquiteto/  dev-node-    qa-testes +
  specs         ddd          dev       refactor    revisor-codigo
```

Nenhuma etapa avança sem a anterior aprovada. Se durante o `CODE` a spec se mostrar errada,
**volte e corrija a spec** — não improvise no código.

## Estrutura de uma spec

```
specs/
├── README.md              ← este arquivo
├── BACKLOG.md             ← todas as specs planejadas, com status
├── _templates/
│   ├── spec.md
│   ├── plan.md
│   └── tasks.md
└── NNNN-nome-em-kebab/
    ├── spec.md            ← O QUÊ e o PORQUÊ (negócio). Sem solução técnica.
    ├── plan.md            ← COMO (técnico). Arquivos, portas, riscos, rollback.
    └── tasks.md           ← passos executáveis, ordenados, com checkbox.
```

## Regras de escrita

### A spec (`spec.md`)
- Escrita em linguagem de **negócio**. Se você precisou citar `axios` ou `Map`, é `plan.md`.
- **Escopo é contrato**: o que está fora precisa estar escrito como "Fora de escopo".
- Todo critério de aceite é **testável** e usa Given/When/Then.
  - Ruim: "a IA deve responder bem"
  - Bom: "**Dado** que `gastoMensal` está vazio, **Quando** o cliente perguntar 'quanto custa a AZ1?',
    **Então** a resposta não contém valor em reais nem nome de modelo, **E** termina com uma pergunta
    sobre a locomoção atual."
- Referencie sempre os IDs existentes: `RN-NNN` ([regras](../docs/03-regras-de-negocio.md)),
  `UC-NNN` ([casos de uso](../docs/04-casos-de-uso.md)), `D-NN`/`S-N`
  ([dívida](../docs/09-divida-tecnica.md)).

### O plano (`plan.md`)
- Arquivos criados/alterados/deletados, portas envolvidas, padrões aplicados.
- **Estratégia de coexistência**: como o legado e o novo convivem, e quando o legado morre.
- **Plano de rollback** explícito. Se não há como reverter em minutos, o plano está errado.

### As tarefas (`tasks.md`)
- Cada tarefa cabe em uma sessão de trabalho e tem um resultado verificável.
- Ordenadas por dependência. Marque `[x]` ao concluir.
- A última tarefa é sempre "remover o caminho legado" ou "agendar a remoção".

## Numeração

Sequencial e estável: `0001`, `0002`, … Nunca renumere. Spec cancelada continua no diretório com
status `Cancelada` e o motivo — a decisão de não fazer também é conhecimento.

## Status

| Status | Significado |
|---|---|
| `Rascunho` | Em escrita, não revisada |
| `Em revisão` | Aguardando aprovação |
| `Aprovada` | Pronta para implementar |
| `Em progresso` | Implementação iniciada |
| `Implementada` | Código em produção, critérios de aceite verificados |
| `Bloqueada` | Depende de decisão ou de outra spec |
| `Cancelada` | Não será feita (com motivo registrado) |

## Convenções de commit

```
feat(0003): adiciona porta CanalDeMensagem
test(0001): caracterização de parsePayload — formato WABA
refactor(0004): processarMensagem delega ao caso de uso
docs(0007): decisão sobre pipeline de oportunidades
```

O número da spec no escopo do commit liga código, teste e decisão para sempre.
