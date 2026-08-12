# RESULTADO 0007 — Remoção do pipeline de oportunidades

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## Contexto

`pipeline.js` criava uma oportunidade no funil comercial do ChatClean quando o lead era qualificado.
O código existia, tinha o contrato mapeado por engenharia reversa e **nunca era chamado**: só
`diag()` aparecia, no endpoint `/diag`.

**Decisão do negócio (2026-08-11):** os vendedores não usam o funil de Oportunidades do ChatClean.
Remover.

## O que saiu

| Item | Tamanho |
|---|---|
| `pipeline.js` | 111 linhas |
| `require` e campo `pipeline` no `/diag` do `index.js` | 2 linhas |
| Bloco `PIPELINE_*` do `.env.example` (6 variáveis) | 18 linhas |
| Entrada no ratchet do lint | 1 arquivo |

## Por que valia a pena

Não era só código morto ocupando espaço. O `/diag` — endpoint administrativo do cliente Avelloz —
expunha nomenclatura de **outro projeto**:

```json
"pipeline": { "stepNome": "REUNIÃO MARCADA", "oppNome": "REUNIÃO MARCADA", ... }
```

"REUNIÃO MARCADA" é etapa do funil do `iachatclean`. Os comentários do arquivo ainda citavam o
responsável "Roni". Quem abrisse o `/diag` da Avelloz veria a configuração de um produto que não é o
dele, para uma integração que não existe.

## Verificação

- 348 testes verdes, sem alteração.
- Lint: 0 erros, 4 avisos.
- Linha de base: **a única diferença é o desaparecimento do bloco `pipeline` no `/diag`** — a mudança
  pretendida. Todo o resto idêntico.

## Mudança de comportamento declarada

O `/diag` deixou de trazer o campo `pipeline`. É o objetivo da spec, aprovado pelo negócio. Nenhum
outro comportamento muda: a função nunca era chamada no fluxo de atendimento.

## Números

| | Antes | Depois |
|---|---:|---:|
| Arquivos legados na raiz | 8 | **7** |
| Variáveis de ambiente | 21 | **15** |
| Ratchet do lint | 8 arquivos | **7** |
