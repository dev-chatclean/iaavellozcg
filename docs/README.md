# Documentação — IA Avelloz Campina

> **Chegou agora no projeto?** Comece por
> [14 — Handoff da refatoração](14-handoff-refatoracao.md): contexto, o que mudou, o que não mudou,
> e as decisões que dependem de você.
>
> **Retomando o trabalho?** [13 — Estado atual e continuação](13-estado-e-continuacao.md).

## Ordem de leitura recomendada

**Para entender o produto** (30 min)
1. [00 — Visão geral](00-visao-geral.md) — o negócio, o funil, o catálogo
2. [02 — Funcionalidades](02-funcionalidades.md) — o que o bot faz (RF-NNN)
3. [08 — Glossário](08-glossario.md) — a linguagem ubíqua

**Para entender as regras** (45 min)
4. [03 — Regras de negócio](03-regras-de-negocio.md) — RN-NNN, com criticidade e origem
5. [04 — Casos de uso](04-casos-de-uso.md) — UC-NNN, com fluxos alternativos

**Para mexer no código** (1 h)
6. [01 — Arquitetura atual](01-arquitetura-atual.md) — como funciona hoje
7. [07 — Estado e persistência](07-estado-e-persistencia.md) — o `leadData` e o Redis
8. [06 — Integrações](06-integracoes.md) — ChatClean, OpenAI, Redis
9. [09 — Dívida técnica](09-divida-tecnica.md) — D-NN e S-N

**Para refatorar** (obrigatório antes da primeira linha)
10. [05 — Modelo de domínio](05-modelo-de-dominio.md) — bounded contexts, agregado, portas
11. [10 — Arquitetura alvo](10-arquitetura-alvo.md) — destino
12. [11 — Plano Strangler Fig](11-plano-refatoracao-strangler.md) — **o caminho**
13. [specs/](../specs/README.md) — o processo de trabalho


## Onde cada coisa vive hoje

Os documentos de funcionalidades, casos de uso, domínio e persistência foram escritos durante o
levantamento e citam os arquivos **como eles eram**. As regras, os IDs e os fluxos continuam
válidos — só o endereço mudou. Esta tabela traduz:

| Citado nos docs | Onde vive hoje |
|---|---|
| `index.js: processarMensagem` e afins | `src/application/casos-de-uso/ProcessarMensagemRecebida.js` |
| `index.js: parsePayload` | `src/infrastructure/chatclean/acl/` + `src/infrastructure/http/traduzirPayload.js` |
| `index.js: handleWebhook`, rotas, proteções | `src/infrastructure/http/servidor.js` e `protecoes.js` |
| `index.js: fila, debounce` | `src/application/fila/FilaDeTurnos.js` |
| `index.js: montarResumo` | `src/domain/atendimento/MontadorDeResumo.js` |
| `index.js: ccPush`, envio | `src/infrastructure/chatclean/CanalChatClean.js` |
| `index.js`: chamadas OpenAI | `src/infrastructure/openai/` |
| `index.js`: blocos de mídia | `src/application/midia/manipuladores.js` |
| `data.js` | `src/domain/catalogo/Catalogo.js` |
| `flow.js` | `src/domain/atendimento/` (`Funil`, `EtapaDoFunil`, `Qualificacao`, `Perfil`) |
| `horario.js` | `src/domain/expediente/Expediente.js` |
| `prompts.js` | `src/infrastructure/openai/prompts/` (versionado) |
| `store.js` | `src/infrastructure/redis/RepositorioRedis.js` e `memoria/RepositorioMemoria.js` |
| `pipeline.js` | **removido** (spec 0007) |
| Variáveis de ambiente soltas | `src/main/config.js` (validadas) |

O `index.js` de hoje tem 95 linhas e só monta as peças.

## Sistema de identificadores

| Prefixo | Significado | Onde |
|---|---|---|
| `RF-NNN` | Requisito funcional | [02](02-funcionalidades.md) |
| `RN-NNN` | Regra de negócio | [03](03-regras-de-negocio.md) |
| `UC-NNN` | Caso de uso | [04](04-casos-de-uso.md) |
| `D-NN` | Dívida técnica | [09](09-divida-tecnica.md) |
| `S-N` | Risco de segurança/LGPD | [09](09-divida-tecnica.md) |
| `CA-NNN` | Critério de aceite | dentro de cada spec |
| `ADR-NNNN` | Decisão de arquitetura | [adr/](adr/) |
| `P-N` | Sugestão de produto | [specs/BACKLOG.md](../specs/BACKLOG.md) |

Estes IDs aparecem em specs, testes e comentários de código. **Nunca renumere.**

## Manutenção

Esta documentação é **viva**. Regra: se uma spec muda o comportamento, o documento correspondente é
atualizado no mesmo PR. Documentação desatualizada é pior que documentação ausente — a segunda você
desconfia, a primeira você acredita.

Levantada em 2026-08-11 a partir do commit `255c13b`, por análise completa do código.
