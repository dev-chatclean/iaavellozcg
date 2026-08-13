# Backlog de Specs

Todas as specs planejadas da refatoração. Ordem de execução recomendada de cima para baixo.
Ver [docs/11-plano-refatoracao-strangler.md](../docs/11-plano-refatoracao-strangler.md).

| # | Spec | Fase | Status | Dívida | Depende de |
|---|---|---|---|---|---|
| **0001** | [Rede de segurança: testes, lint e CI](0001-rede-de-seguranca/spec.md) | 0 | **Implementada** | D-12, D-13 | — |
| **0002** | [Configuração validada e endurecimento mínimo](0002-configuracao-e-endurecimento/spec.md) | 0 | **Implementada** | D-23, S1, S4, S5, S8 | — |
| **0003** | [ACL do payload de entrada](0003-acl-payload-de-entrada/spec.md) | 1 | **Implementada** | D-01(parcial), D-29 | 0001 |
| **0004** | [Portas e adapters: canal, repositório, LLM](0004-portas-e-adapters/spec.md) | 2 | **Implementada** | D-02, D-26 | 0003 |
| **0005** | [Manipuladores de mídia (Strategy)](0005-manipuladores-de-midia/resultado.md) | 5 | **Implementada** | (estrutural) | 0004 |
| **0006** | [Domínio do atendimento: políticas e regras](0006-dominio-atendimento/spec.md) | 3 | **Implementada** | D-03, D-07(parcial) | 0004 |
| **0007** | [Remoção do pipeline de oportunidades](0007-remover-pipeline-oportunidades/resultado.md) | 10 | **Implementada** | D-05 | 0001 |
| **0008** | [Caso de uso do turno](0008-caso-de-uso-do-turno/resultado.md) | 4 | **Implementada** | D-01, D-24(parcial) | 0006 |
| **0009** | [Expediente: sábado e plantão na resposta](0009-expediente-sabado-e-plantao/spec.md) | 0+ | **Implementada** | D-19, D-28 | 0001 |
| **0010** | [Unificação dos testers locais](0010-unificacao-dos-testers/resultado.md) | 6 | **Implementada** | D-04 | 0008 |
| **0011** | [Prompts versionados e suíte de evals](0011-prompts-versionados-e-evals/resultado.md) | 7 | **Implementada** | D-03 | 0010 |
| **0012** | Estado compartilhado no Redis (multi-instância) | 8 | Rascunho | D-15 | 0004 |
| **0013** | Resiliência: retry, backoff, circuit breaker | 8 | Rascunho | D-17, D-27 | 0004 |
| **0014** | Graceful shutdown | 8 | Rascunho | D-16 | 0012 |
| **0015** | Observabilidade: log estruturado e métricas | 8 | Rascunho | D-20, D-24, S1 | 0002 |
| **0016** | LGPD: mascaramento, retenção e expurgo | 8 | Rascunho | S2, S3, S9, S10, RN-092 | 0006, 0015 |
| **0017** | [Verificação de tipos com JSDoc](0017-verificacao-de-tipos/resultado.md) | 9 | **Implementada** | D-14 (parcial) | 0010 |
| **0018** | [`index.js` como bootstrap](0018-index-como-bootstrap/resultado.md) | 10 | **Implementada** | D-01, D-22 | 0008, 0010 |
| **0019** | Endurecimento operacional: alarme de Redis e origem da mídia | — | Rascunho | D-18, S7 | 0004 |
| **0020** | Política de envio: quebra de mensagem e atraso fora do lock | — | Rascunho | D-08, D-25 | 0005 |
| **0021** | Correção do D-06: consulta do funil sem efeito colateral | — | Rascunho | D-06 | 0006 |
| **0022** | [Catálogo, expediente e funil no domínio](0022-catalogo-e-expediente-no-dominio/resultado.md) | 3 | **Implementada** | (estrutural) | 0006 |


---

## Decisões de negócio tomadas

### 0007 — Pipeline de oportunidades: **REMOVER** *(decidido em 2026-08-11)*
Os vendedores **não usam** o funil de Oportunidades do ChatClean. O `pipeline.js` (111 linhas, nunca
chamado, com comentários herdados do projeto `iachatclean`) será **deletado**, junto com a referência
em `/diag` e as 6 variáveis `PIPELINE_*` do `.env.example`.
Executado na spec 0007, após a Fase 0. Não é urgente — código morto não causa incidente — mas envenena
a leitura de quem chega ao projeto.

### 0009 — Expediente: sábado 08h-18h — IMPLEMENTADA (2026-08-11)
A loja atende de **segunda a sábado**. Sábado das **08h às 18h**, confirmado pelo negócio; dias úteis
mantidos em 09h-18h. O horário virou tabela por dia (`horario.js: EXPEDIENTE_SEMANAL`).

Junto foi corrigido o **D-28**: o modo plantão agora chega ao prompt da resposta, em vez de existir só
na etiqueta do resumo interno. O bot deixa de prometer atendimento imediato de madrugada.

Ver [resultado](0009-expediente-sabado-e-plantao/resultado.md).

O ciclo funcionou como planejado: os testes da Fase 0 congelaram os dois defeitos com a marca
`CONGELA`, e esta spec os **inverteu** — o mesmo teste que documentava o bug agora garante a correção.

Pendências declaradas, ambas de um número na tabela:
- [ ] Horário de segunda a sexta (mantido 09h-18h, como sempre esteve).
- [ ] Monteiro tem horário próprio? (assumido igual às unidades de Campina Grande).

---

## Sugestões de melhoria de produto (fora da refatoração)

Levantadas durante a análise. Não são dívida — são oportunidades. Viram spec quando o negócio quiser.

| # | Ideia | Valor |
|---|---|---|
| P1 | **`CalculadoraDeEconomia` no domínio** — hoje a projeção anual do gasto é feita pelo LLM, que erra aritmética. É o argumento central da venda. | Alto |
| P2 | **Painel de leads** — `/leads` lista atendimentos ativos, mas o histórico (`avellozcg:leads`) não é lido por ninguém. Uma tela simples daria visibilidade real do funil. | Médio |
| P3 | **Envio das imagens dos modelos** — hoje o bot manda um link do Instagram no texto. Enviar a imagem pelo próprio Push aumenta conversão. | Médio |
| P4 | **Reativação em mais de um tempo** (30 min → 4 h → 24 h) em vez de um único follow-up. | Médio |
| P5 | **Métrica de vazamento de RN-001 em produção** — verificação pós-resposta que detecta preço liberado cedo. Defesa em profundidade + número para acompanhar. | Alto |
| P6 | **Handoff com contexto para o vendedor** — além do resumo, sugerir a próxima ação ("ele reclamou de juros; ancore no aluguel de R$ 250/semana"). | Médio |
| P7 | **A/B de prompt** com métrica de conversão por variante, sustentado pela suíte de evals. | Depois |
