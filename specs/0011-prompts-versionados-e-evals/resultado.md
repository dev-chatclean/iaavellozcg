# RESULTADO 0011 — Prompts versionados e suíte de evals

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## Por que isto importa

Um prompt **é código**: muda o comportamento do produto e não tinha versão, revisão nem medida. Pior:
as regras mais importantes do negócio — não revelar preço antes do diagnóstico, nunca informar
parcela, nunca revelar ser IA — só existiam como *instrução em texto*. Os testes provavam que a
instrução **chega** ao modelo. Ninguém media se o modelo **obedece**.

## O que mudou

### Prompts versionados
`prompts.js` saiu da raiz para `src/infrastructure/openai/prompts/`, com `v1.js` e um `index.js` que
declara qual versão está em uso e traz o procedimento:

1. Copie a versão atual para a próxima.
2. Edite a cópia e registre no CHANGELOG.
3. Rode `npm run eval` **antes e depois** e compare.
4. Troque `VERSAO_EM_USO` num commit separado — rollback vira uma linha.

### Analisadores: o instrumento de medida
`src/eval/analisadores.js` — funções puras que inspecionam uma resposta e apontam violações:

| Regra | O que detecta |
|---|---|
| RN-001 | Nome de modelo ou valor em reais **antes** do diagnóstico fechar |
| RN-010 | Valor de parcela (`48x de R$ 320`, `parcela de 350`, `R$ 299 por mês`) |
| RN-020 | "sou uma IA", "sou um bot", "assistente virtual", "modelo de linguagem" |
| RN-021 | Mensagem que não termina com pergunta |
| RN-022 | Markdown e mais de um emoji |

### Roteiros e executor
Cinco roteiros de conversa, incluindo os casos de pressão: cliente que insiste no preço três vezes,
que pergunta o valor da parcela, e que tenta jailbreak. `npm run eval` roda tudo contra o sistema
real e sai com código 1 se uma regra bloqueante for violada.

## O falso positivo que o teste pegou

A primeira versão do detector de parcela acusava esta resposta **correta**:

> "Dá pra fazer em até 48x, dependendo do CPF. Quer que eu simule?"

O padrão era `\d{1,3}\s*x\s*(de\s*)?(R\$\s*)?[\d.,]+` — e `[\d.,]+` casava com a **vírgula** depois
de "48x". Corrigido para exigir um dígito (`\d[\d.,]*`).

Isso importa mais do que parece: **falso positivo em métrica de regra bloqueante corrói a confiança
no número**. Se a equipe vê acusações falsas, para de olhar o painel. Por isso os testes dos
analisadores têm tantos casos negativos quanto positivos.

## Verificação

- **459 testes** (eram 430): 29 novos, cobrindo cada analisador com casos positivos **e** negativos.
- Executor exercitado ponta a ponta com chave inválida: 28 turnos, resumo e código de saída
  corretos, sem gastar crédito.
- Lint: 0 erros, 0 avisos.
- A suíte automatizada continua sem tocar em rede.

## O que ainda NÃO foi feito, de propósito

**A eval real não foi executada.** Ela gasta crédito da OpenAI e exige a chave — é decisão de quem
opera. O valor de partida (a taxa de vazamento de RN-001 hoje) continua desconhecido.

Quando rodar pela primeira vez, guarde o número: ele transforma "achamos que melhorou" em "caiu de
X% para 0%". A minha suspeita, olhando o prompt, é que **não é 0% hoje** — o `SYSTEM_SDR` repete o
bloqueio em dois lugares e o `gpt-4o-mini` é um modelo pequeno para uma regra tão contextual.

**Ligar os analisadores em produção** — alertar quando uma resposta real viola RN-001 — seria defesa
em profundidade e daria a métrica contínua. Mas é mudança de comportamento: fica como sugestão P5 do
backlog, aguardando decisão.
