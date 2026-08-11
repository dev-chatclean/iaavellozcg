# ADR-0001 — Arquitetura hexagonal migrada por Strangler Fig

**Status:** Aceita · **Data:** 2026-08-11 · **Decisores:** arquiteto-ddd

## Contexto

A IA Avelloz Campina é um monólito procedural Node.js de ~1.500 linhas, com `index.js` concentrando
oito responsabilidades, zero testes automatizados e regras de negócio distribuídas entre código,
dados e texto de prompt. Está **em produção atendendo leads reais** — é a porta de entrada comercial
da concessionária.

A empresa quer evoluir o produto (novas lojas, novos modelos, integração com o funil do CRM,
melhorias de conversão) e hoje cada mudança é uma aposta: não há como verificar que algo não quebrou.

Restrições:
- Não pode haver janela de indisponibilidade.
- A equipe é pequena; a refatoração acontece **em paralelo** a pedidos de negócio.
- O comportamento conversacional é não determinístico (LLM), o que torna "provar que não mudou" mais
  difícil que num CRUD.

## Decisão

Adotar **Arquitetura Hexagonal (Ports & Adapters) com modelagem DDD tática**, migrando o legado
**incrementalmente pela técnica Strangler Fig**, em 11 fases, com **rede de testes construída antes**
de qualquer alteração estrutural.

Elementos da decisão:

1. **Core domain isolado**: `Atendimento` como agregado raiz, com as políticas de negócio (bloqueio
   de diagnóstico, transbordo, sobrescrita, reativação) como objetos de domínio testáveis.
2. **Toda dependência externa atrás de porta**: OpenAI, ChatClean, Redis, relógio.
3. **Anti-Corruption Layer** na borda de entrada — os três formatos de payload do ChatClean não
   entram no domínio.
4. **Fatias pequenas com feature toggle** e, na fase de maior risco (casos de uso), **shadow mode**
   em produção antes de virar a chave.
5. **Regras de fronteira verificadas por lint** (`no-restricted-imports`), para que a arquitetura não
   apodreça depois.
6. **Composition root manual**, sem container de DI.

## Consequências

**Positivas**
- Testes de domínio rodam em milissegundos, sem rede e sem custo de OpenAI.
- Regras de negócio ganham nome, ID e teste — deixam de viver apenas dentro de um prompt.
- Trocar de provedor de LLM ou de canal de mensageria deixa de ser reescrita.
- O sistema passa a poder escalar horizontalmente (Fase 8).
- Os testers locais deixam de mentir (hoje divergem da produção).

**Negativas**
- Mais arquivos e mais indireção. Para uma base de 1.500 linhas, é overhead real — justificado pela
  expectativa de evolução contínua e pelo custo de erro em produção.
- A refatoração completa é longa (11 fases). Exige disciplina para não abandonar no meio, com metade
  do sistema em cada mundo.
- Coexistência temporária de dois caminhos aumenta a superfície de bug durante a transição.

**Neutras**
- CommonJS mantido; migração para ESM/TypeScript é decisão separada (Fase 9, opcional).
- Redis permanece como único armazenamento; nenhum banco relacional é introduzido.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Reescrever do zero** | Perderia conhecimento tácito embutido em detalhes não óbvios (parse de `SenderAlt`, tolerância ao 9º dígito, blindagem anti-loop, filtro de ticket assumido). Sem testes, não haveria como saber o que foi perdido — só reclamação de cliente. |
| **Refatoração cosmética** (só quebrar `index.js` em arquivos menores) | Não resolveria o acoplamento a OpenAI/ChatClean/Redis; continuaria impossível testar sem rede. Ganho estético, dívida intacta. |
| **Clean Architecture com 4 camadas formais** (entities/usecases/adapters/frameworks) | Mesma essência, mais cerimônia. Hexagonal com três camadas comunica melhor a intenção central deste sistema: **um núcleo de metodologia de venda cercado de integrações**. |
| **Microsserviços** (separar IA, mensageria, CRM) | O volume não justifica. Adicionaria latência, complexidade operacional e modos de falha distribuída para resolver um problema que é de organização de código, não de escala. |
| **Migrar direto para TypeScript** | Tipar três implementações divergentes do mesmo fluxo é tipar a bagunça. A tipagem entra depois da unificação (Fase 9). |
| **Big-bang com feature flag global** | Rollback de tudo ou nada; um bug em qualquer parte derruba a migração inteira. Fatias pequenas isolam o risco. |

## Referências

- [docs/10-arquitetura-alvo.md](../10-arquitetura-alvo.md)
- [docs/11-plano-refatoracao-strangler.md](../11-plano-refatoracao-strangler.md)
- [docs/05-modelo-de-dominio.md](../05-modelo-de-dominio.md)
