# RESULTADO 0008 — Caso de uso do turno

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

O turno de conversa inteiro saiu do `index.js` para
`src/application/casos-de-uso/ProcessarMensagemRecebida.js`, um módulo que recebe as dependências
por construtor:

```js
const atendimento = ProcessarMensagemRecebida.criar(deps, config);
```

Ele não conhece Express, não lê `process.env` e não instancia nada. Cobre UC-001, UC-005, UC-006,
UC-007, UC-009, UC-010, UC-012, UC-013 e UC-015.

O `index.js` ficou com o que é de fato responsabilidade dele: servidor HTTP, autenticação do webhook,
deduplicação, rate-limit, fila com agrupamento, endpoints administrativos e bootstrap.

## Sobre o shadow mode

O plano original previa rodar o caminho novo em paralelo ao antigo em produção por uma semana antes
de virar a chave. **Não foi feito, e por um motivo:** aquele plano foi escrito quando o projeto tinha
zero testes, e o shadow mode era a única forma de provar equivalência.

Hoje a prova é outra: 412 testes, dos quais 44 exercitam o turno completo com fakes, mais uma linha
de base que sobe o servidor de verdade. Além disso, a branch **não está em produção** — não há onde
rodar sombra. Se houver deploy futuro, a comparação continua possível.

## Verificação

| | |
|---|---|
| Testes | **412**, sem alteração em nenhum |
| Linha de base | Requisições **e** log do servidor idênticos |
| Lint | 0 erros, 1 aviso |
| `index.js` | 812 para **437 linhas** |

## Uma regressão minha, encontrada no caminho

Ao preparar a extração, notei dois `setInterval(varrerFollowUps, ...)` no `index.js`. Rastreei com
`git`: **eu introduzi no commit `ef22f4b`** (spec 0001, PR4), ao mover o bootstrap para `iniciar()`
sem remover o agendamento do nível do módulo.

Efeito em produção: o varredor de follow-up rodaria **duas vezes**, e dois timers poderiam disparar
o mesmo follow-up em corrida — mensagem de reativação duplicada para o cliente.

Nenhum teste pegou porque o teste dourado chama `varrerFollowUps()` diretamente, sem depender do
timer, e a linha de base não espera dois minutos. Corrigido em commit próprio, com
`test/unidade/agendamento.test.js` guardando as duas propriedades: importar o módulo não agenda
timer, e o código-fonte agenda o varredor num lugar só.

## Os `catch` mudos ganharam explicação

Três blocos `catch (_) {}` vieram junto na mudança. Como o arquivo novo não está no ratchet do lint,
eles viraram erro — e a correção certa não era silenciar a regra, era escrever por que o erro é
ignorado:

```js
catch (_) { /* pior caso: a proxima varredura reavalia o estado */ }
catch (_) { /* avisar a equipe e best-effort: nao pode atrapalhar o corte do loop */ }
```

Comportamento idêntico; agora quem lê sabe que o silêncio é deliberado. Parte do D-24 fechada por
consequência.

## O que ficou pendente

- **`usarDependencias` ainda existe**, mas encolheu: agora só remonta o caso de uso com outras
  dependências. Sai quando o `index.js` virar bootstrap puro (spec 0018) e os testes montarem o
  container diretamente.
- **A fila, o debounce e o rate-limit continuam em memória no `index.js`** (D-15) — Fase 8.
- O caso de uso ainda expõe funções internas (`enviarMensagem`, `montarResumo`, `notificarEquipe`)
  porque o `index.js` e os testes as usam. Elas deixam de ser públicas quando o legado sair.
