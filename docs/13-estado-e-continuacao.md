# 13 — Estado Atual e Continuação

**Última atualização:** 2026-08-11, fim do dia 1 · **Branch:** `refatoracao/arquitetura-ddd`
**Último commit:** `6d47eeb` · **Árvore limpa, tudo versionado.**

Este é o documento de retomada. Quem senta amanhã (pessoa ou agente) lê daqui.

---

## 1. Onde paramos, em uma frase

A rede de segurança está pronta e três fatias foram entregues: **Fase 0 completa** (testes, lint, CI,
linha de base), **Fase 1 completa** (ACL do payload) e **dois bugs de produção corrigidos**
(expediente de sábado e modo plantão). O próximo passo é a **Fase 2 — portas e adapters (spec 0004)**.

## 2. Números

| Indicador | Início (`255c13b`) | Agora | Meta |
|---|---:|---:|---:|
| Testes automatizados | 0 | **320** (1,5s) | — |
| Cobertura dos módulos puros | 0% | **100%** | > 80% |
| `index.js` | 1040 linhas | **990** | < 30 |
| Código em `src/` (arquitetura alvo) | 0 | **717 linhas, 7 arquivos** | — |
| Erros de lint | (sem lint) | **0** (6 avisos no legado) | 0 |
| Itens de dívida resolvidos | 0 | **10** | 29 |

## 3. O que já foi entregue

| Spec | Entrega | Dívida fechada |
|---|---|---|
| **0001** | Vitest, ESLint, Prettier, CI, 245 testes, linha de base executável, `src/shared/telefone.js` | D-12, D-13 |
| **0009** | Sábado 08h-18h; modo plantão chega ao prompt | D-19, D-28 |
| **0002** | `src/main/config.js` (validação no boot), webhook fail-closed, PII fora do log, `.dockerignore` | D-23, S1, S4, S5, S8 |
| **0003** | ACL do payload: `src/infrastructure/chatclean/acl/` + `src/domain/mensageria/`, 7 motivos de descarte nomeados | D-01 (parcial), D-29 |

Cada uma tem `spec.md`, `plan.md`, `tasks.md` e `resultado.md` em `specs/`.

## 4. Estrutura hoje

```
LEGADO (2056 linhas)              ARQUITETURA ALVO (717 linhas)
  index.js         990              src/main/config.js              181
  prompts.js       204              src/infrastructure/chatclean/acl/
  data.js          178                esquemas.js                   170
  sim-lead.js      140                tradutor.js                   192
  store.js         124              src/domain/mensageria/
  horario.js       120                MensagemRecebida.js            53
  test-chat.js     116                MotivoDeDescarte.js            45
  pipeline.js      111  (a deletar) src/shared/
  flow.js           73                telefone.js                    36
                                      mascarar.js                    40
```

## 5. Como retomar

```bash
git checkout refatoracao/arquitetura-ddd    # NUNCA fazer merge na main
npm install
npm test                                     # 320 testes, ~1,5s, sem rede e sem custo
npm run lint                                 # 0 erros, 6 avisos (legado, ratchet)
bash test/baseline/coletar-baseline.sh conferencia
diff test/baseline/antes-da-refatoracao-requisicoes.log test/baseline/conferencia-requisicoes.log
```

Se o `diff` vier vazio e a suíte verde, o ponto de partida está íntegro.

**Leitura obrigatória antes de codar:** [CLAUDE.md](../CLAUDE.md), este documento e a spec da fatia.

## 6. Próximo passo recomendado: SPEC 0004 (Fase 2)

**Portas e adapters.** É a maior fatia até aqui e a que destrava todo o resto — sem ela, o domínio da
Fase 3 não tem como ser testado sem mock de módulo.

Escopo, na ordem sugerida de execução:

1. `CanalDeMensagem` — extrai `ccPush`/`enviarMensagem`. Adapters: ChatClean, memória, terminal.
2. `RepositorioDeAtendimento` — `store.js` vira adapter Redis; o de memória passa a ser **escolha
   explícita**, não fallback silencioso (resolve D-18). Suíte de contrato única para os dois.
3. `ExtratorDeInformacoes` e `RedatorDeResposta` — com **validação de schema da saída do LLM**
   (extração inválida vira `Extracao.vazia()` em vez de objeto torto).
4. `TranscritorDeAudio` e `LeitorDeImagem` — Whisper passa a usar o SDK (D-26) e a `mediaUrl` ganha
   allow-list de host (S7).
5. `Relogio` e `RelogioDeExpediente` — o que permite testar reativação e reset sem tempo real.
6. `src/main/container.js` — composition root.

**Critério de saída:** nenhum `require('openai'|'axios'|'ioredis')` fora de `src/infrastructure/`, e
o teste dourado rodando **sem `vi.mock` nem `require.cache`** — injetando fakes pelo container.

Isso mata `test/apoio/fakes.js`, a dívida deliberada assumida na Fase 0 (injeção pelo `require.cache`
é a prova viva do acoplamento descrito em D-02).

### Alternativa: intercalar fatias pequenas primeiro

Se a preferência for entregar coisas rápidas antes de encarar a fatia grande:

- **Spec 0007** — deletar `pipeline.js` (111 linhas de código morto), a referência em `/diag` e as 6
  variáveis `PIPELINE_*`. Decisão de negócio já tomada. Meia hora.
- **Spec 0005** — manipuladores de mídia (Strategy) e política de quebra de mensagem (D-08, D-25).
  Isolada e de baixo risco. Depende da 0004 para ficar completa, mas a parte de Strategy pode vir antes.

**Recomendação:** fazer a **0007 primeiro** (é rápida e limpa o `/diag`, que hoje expõe "REUNIÃO
MARCADA" para o cliente Avelloz), depois encarar a **0004** com o dia inteiro pela frente.

## 7. Decisões pendentes do negócio

Nenhuma bloqueia o trabalho. Todas têm suposição declarada e são de baixo custo para corrigir.

| # | Pergunta | Suposição atual |
|---|---|---|
| 1 | Horário de segunda a sexta continua 09h-18h? | Mantido 09h-18h (é o que o código sempre fez) |
| 2 | Monteiro tem horário próprio? | Assumido igual às unidades de Campina Grande |
| 3 | O deploy define `NODE_ENV=production`? | **Precisa confirmar** — sem isso o webhook segue aberto |

O item 3 é o único com impacto operacional imediato: ver §9.

## 8. Bugs conhecidos, ainda abertos

Todos com teste que documenta o comportamento atual (marcados `CONGELA`), a serem invertidos pela
spec que corrigir cada um.

| ID | Bug | Corrige em |
|---|---|---|
| **D-06** | `determinarProximoCampo` é consulta que **muta** o lead: montar um follow-up pode marcar o lead como qualificado | spec 0006 (Fase 3) |
| **D-16** | Estado só é gravado no fim do turno: restart no meio apaga tudo que o cliente disse | Fase 8 |
| **D-15** | Dedup, rate-limit, fila e follow-up só em memória: **o sistema só é seguro com uma instância** | Fase 8 |
| **S2** | CPF vai completo no resumo enviado à equipe | spec 0016 |
| **D-04** | `test-chat.js` e `sim-lead.js` reimplementam o turno e **já divergem** da produção | spec 0010 |

## 9. Pendência operacional (ação no servidor)

A spec 0002 tornou a configuração fail-closed, **mas só com `NODE_ENV=production`**:

```bash
NODE_ENV=production pm2 start index.js --name iaavellozcg
```

Com essa variável, o servidor **se recusa a subir** sem `WEBHOOK_SECRET` (mínimo 16 caracteres) e sem
`CC_PUSH_URL`. É o comportamento correto, mas quem fizer o próximo deploy precisa saber antes — e
precisa haver um `WEBHOOK_SECRET` gerado. Sem `NODE_ENV=production`, o webhook continua aberto.

> Nada disso está em produção ainda: a branch `refatoracao/arquitetura-ddd` **nunca foi mesclada**.
> A `main` segue intocada no commit original.

## 10. Convenções que valem para quem continuar

- **Nunca fazer merge na `main`.** Todo o trabalho fica na branch de refatoração.
- **Nunca usar emojis** em documentação, código, commits ou respostas. (Exceção: o texto que o *bot*
  envia ao cliente segue RN-022, no máximo 1 emoji — isso é regra de negócio do produto.)
- **Commits concisos**: assunto convencional com o número da spec, sem corpo detalhado.
- **Executar a aplicação antes de mudar código.** A linha de base existe para isso.
- **Nenhum código sem spec aprovada.** O ciclo é spec → plan → tasks → code → verify.
- **Bug encontrado no meio de uma fatia vira teste `CONGELA` + item de dívida**, não correção de
  contrabando. A correção vem na spec própria, invertendo o teste.

## 11. O padrão que está funcionando

Vale repetir porque já se provou três vezes:

1. O teste de caracterização congela o comportamento atual, **inclusive o errado**.
2. A fatia troca a implementação; se os testes congelados passarem sem alteração, o contrato não mudou.
3. Quando a correção do defeito chega, ela **inverte** o teste que o documentava.

Foi assim que D-19 e D-28 saíram, e foi assim que o ACL substituiu 75 linhas de parse sem tocar num
único teste dos 50 que o cobriam.
