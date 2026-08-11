# Backlog de Specs

Todas as specs planejadas da refatoração. Ordem de execução recomendada de cima para baixo.
Ver [docs/11-plano-refatoracao-strangler.md](../docs/11-plano-refatoracao-strangler.md).

| # | Spec | Fase | Status | Dívida | Depende de |
|---|---|---|---|---|---|
| **0001** | [Rede de segurança: testes, lint e CI](0001-rede-de-seguranca/spec.md) | 0 | 📝 Aprovada | D-12, D-13 | — |
| **0002** | Configuração validada e endurecimento mínimo | 0 | 🕓 Rascunho | D-23, S1, S4, S5, S8 | — |
| **0003** | ACL do payload de entrada | 1 | 🕓 Rascunho | D-01(parcial) | 0001 |
| **0004** | Portas e adapters: canal, repositório, LLM | 2 | 🕓 Rascunho | D-02, D-18, D-26, S7 | 0001, 0002 |
| **0005** | Manipuladores de mídia e política de envio | 5 | 🕓 Rascunho | D-08, D-25 | 0004 |
| **0006** | Domínio: `Atendimento`, VOs e políticas | 3 | 🕓 Rascunho | D-03, D-06, D-07, D-09 | 0004 |
| **0007** | Remoção do pipeline de oportunidades (código morto) | 10 | 📝 Decidida — remover | D-05 | 0001 |
| **0008** | Casos de uso e morte do `processarMensagem` | 4 | 🕓 Rascunho | D-01, D-10 | 0006 |
| **0009** | Expediente incluindo sábado (correção de RN-060) | 0+ | 📝 Decidida — implementar | D-19 | 0001 |
| **0010** | Unificação dos testers locais | 6 | 🕓 Rascunho | **D-04** | 0008 |
| **0011** | Prompts versionados e suíte de evals | 7 | 🕓 Rascunho | D-03 | 0010 |
| **0012** | Estado compartilhado no Redis (multi-instância) | 8 | 🕓 Rascunho | D-15 | 0004 |
| **0013** | Resiliência: retry, backoff, circuit breaker | 8 | 🕓 Rascunho | D-17, D-27 | 0004 |
| **0014** | Graceful shutdown | 8 | 🕓 Rascunho | D-16 | 0012 |
| **0015** | Observabilidade: log estruturado e métricas | 8 | 🕓 Rascunho | D-20, D-24, S1 | 0002 |
| **0016** | LGPD: mascaramento, retenção e expurgo | 8 | 🕓 Rascunho | S2, S3, S9, S10, RN-092 | 0006, 0015 |
| **0017** | Tipagem incremental (JSDoc → TypeScript) | 9 | 💤 Adiada | D-14 | 0010 |
| **0018** | Remoção final do legado | 10 | 🕓 Rascunho | D-01, D-21, D-22 | 0008, 0010 |

**Legenda:** 📝 Aprovada · 🕓 Rascunho · ⏳ Em progresso · ✅ Implementada · ⛔ Bloqueada · 💤 Adiada

---

## Decisões de negócio tomadas

### 0007 — Pipeline de oportunidades: **REMOVER** *(decidido em 2026-08-11)*
Os vendedores **não usam** o funil de Oportunidades do ChatClean. O `pipeline.js` (111 linhas, nunca
chamado, com comentários herdados do projeto `iachatclean`) será **deletado**, junto com a referência
em `/diag` e as 6 variáveis `PIPELINE_*` do `.env.example`.
Executado na spec 0007, após a Fase 0. Não é urgente — código morto não causa incidente — mas envenena
a leitura de quem chega ao projeto.

### 0009 — Expediente: **inclui sábado, horário comercial** *(decidido em 2026-08-11)*
A loja atende de **segunda a sábado, em horário comercial**. O `horario.js` está errado ao tratar
sábado como fim de semana — hoje um lead que chega no sábado recebe modo plantão e o transbordo é
etiquetado "FORA DE EXPEDIENTE", quando a loja está aberta. O texto do `data.js` (que chega ao cliente
pelo prompt) já está correto.

**Impacto:** RN-060 e RN-061 mudam. `EMPRESA_INFO.horarioSuporte` passa a ser a fonte da verdade.

**Pendente de confirmação para implementar** (não bloqueia a Fase 0):
- [ ] Horário exato de segunda a sexta — o código usa 09h–18h. Confirmar.
- [ ] Horário do **sábado** — presumido 08h–12h (padrão do comércio de rua em Campina Grande).
      Se for diferente, corrigir antes de implementar.
- [ ] Monteiro tem horário diferente das unidades de Campina Grande?

> ⚠️ Esta correção **não entra na Fase 0**, que é explicitamente zero-mudança-de-comportamento. Os
> testes de caracterização vão congelar o comportamento atual (sábado = fechado) com a marca
> `// CONGELA BUG D-19`, e a spec 0009 muda deliberadamente, com teste novo. Essa é a ordem correta:
> primeiro a rede, depois a mudança.

---

## Sugestões de melhoria de produto (fora da refatoração)

Levantadas durante a análise. Não são dívida — são oportunidades. Viram spec quando o negócio quiser.

| # | Ideia | Valor |
|---|---|---|
| P1 | **`CalculadoraDeEconomia` no domínio** — hoje a projeção anual do gasto é feita pelo LLM, que erra aritmética. É o argumento central da venda. | 🔴 Alto |
| P2 | **Painel de leads** — `/leads` lista atendimentos ativos, mas o histórico (`avellozcg:leads`) não é lido por ninguém. Uma tela simples daria visibilidade real do funil. | 🟡 Médio |
| P3 | **Envio das imagens dos modelos** — hoje o bot manda um link do Instagram no texto. Enviar a imagem pelo próprio Push aumenta conversão. | 🟡 Médio |
| P4 | **Reativação em mais de um tempo** (30 min → 4 h → 24 h) em vez de um único follow-up. | 🟡 Médio |
| P5 | **Métrica de vazamento de RN-001 em produção** — verificação pós-resposta que detecta preço liberado cedo. Defesa em profundidade + número para acompanhar. | 🔴 Alto |
| P6 | **Handoff com contexto para o vendedor** — além do resumo, sugerir a próxima ação ("ele reclamou de juros; ancore no aluguel de R$ 250/semana"). | 🟡 Médio |
| P7 | **A/B de prompt** com métrica de conversão por variante, sustentado pela suíte de evals. | 🟢 Depois |
