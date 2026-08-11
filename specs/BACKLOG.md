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
| **0007** | Decisão: pipeline de oportunidades no CRM | — | ⛔ Bloqueada (negócio) | D-05 | decisão do cliente |
| **0008** | Casos de uso e morte do `processarMensagem` | 4 | 🕓 Rascunho | D-01, D-10 | 0006 |
| **0009** | Decisão: horário de atendimento e fuso | — | ⛔ Bloqueada (negócio) | D-19 | decisão do cliente |
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

## Decisões pendentes do negócio (bloqueiam specs)

Estas duas não são técnicas — precisam de resposta do cliente e travam a modelagem.

### 0007 — Ligar ou remover o pipeline de oportunidades?
`pipeline.js` cria um card no funil comercial do CRM quando o lead é qualificado. O código existe,
está testado por engenharia reversa, e **nunca é chamado**. Ligar dá visibilidade do funil ao gerente
da loja; não ligar significa deletar 111 linhas de código morto com comentários de outro projeto.
**Pergunta ao cliente:** os vendedores usam o funil de oportunidades do ChatClean hoje?

### 0009 — Qual é o horário de atendimento real?
`horario.js` implementa **segunda a sexta, 09h–18h** (fuso `America/Recife`, comentário citando
"Natal-RN"), mas `data.js` informa ao cliente **"segunda a sábado, em horário comercial"**. As duas
coisas chegam ao lead. **Perguntas ao cliente:** a loja atende sábado? Qual o horário exato de cada
unidade? Monteiro tem horário diferente de Campina Grande?

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
