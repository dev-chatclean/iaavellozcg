# 16 — Guia de revisão da `refatoracao/v2`

Como revisar 31 commits sem ler 6.700 linhas de diff, e o que procurar em cada um.

**Branch:** `refatoracao/v2`, saída de `develop` · **Alvo:** `develop`, depois `main` por PR
**Nada foi mesclado.** `develop` e `main` seguem intocadas.

## A alegação que a revisão precisa checar

> **Nenhum comportamento mudou.** O sistema faz exatamente o que fazia antes, com o código
> reorganizado.

Toda a revisão pode ser reduzida a: *essa alegação é verdadeira?*

Há três provas independentes, e vale rodar as três antes de ler qualquer diff:

```bash
npm test                                       # 678 testes, ~5s, sem rede e sem custo
npm run lint                                   # 0 erros
bash test/baseline/coletar-baseline.sh revisao
diff test/baseline/producao-develop-requisicoes.log test/baseline/revisao-requisicoes.log
diff <(sort test/baseline/producao-develop-servidor.log) <(sort test/baseline/revisao-servidor.log)
```

Os dois `diff` precisam sair **vazios**. O primeiro compara a resposta de todas as rotas contra o
código que está em produção; o segundo, o conjunto de linhas do log do servidor.

Se algum sair diferente, **pare**: é regressão, não é questão de estilo.

## Como os commits se organizam

| # | Commits | O que são | Como revisar |
|---|---|---|---|
| 1 | 1-6 | **Rede de segurança.** Ferramental, linha de base, caracterização | Ler os testes, não o código. Eles definem o que "não quebrou" significa |
| 2 | 7-12 | **Adapters.** Telefone, ACL, canal, OpenAI, mídia, repositório | Cada um: o corpo saiu inteiro e ganhou injeção de dependência |
| 3 | 13-21 | **Domínio e coordenação.** Políticas, resumo, mídia, fila, lock, sinais | Onde mora o valor: regras que não tinham nome agora têm |
| 4 | 22-26 | **Caso de uso e serviços.** Turno, envio, transbordo, IA, follow-up | O commit 22 é o maior; ver a nota abaixo |
| 5 | 27-31 | **Composição e borda.** Config, container, proteções, servidor, limpeza | O `index.js` vira bootstrap |

### Sobre o commit 22 (o turno vira caso de uso)

É o maior: 300 linhas mudam de arquivo. **O corpo foi movido verbatim, sem reindentar**, de
propósito — reindentar tornaria o diff ilegível justamente onde ler cada linha importa mais.

Confira assim, em vez de ler o diff:

```bash
git show f137c7c --stat          # 36 inserções, 299 remoções, um arquivo
```

O mesmo vale para os commits 24 (transbordo) e 30 (servidor). O cabeçalho de cada arquivo movido
traz a nota de leitura.

## O que procurar (e o que ignorar)

**Vale o seu tempo:**

- Os **testes marcados `CONGELA`** (35 no total). Cada um documenta comportamento que sabemos estar
  errado e que **não** foi corrigido. Discorde deles se achar que algum deveria ter sido corrigido —
  essa é a conversa que importa.
- Os **comentários de cabeçalho** dos módulos novos. Vários registram conhecimento que só existia na
  cabeça de quem escreveu — a ordem do transbordo, por que "pouco tempo" ficou fora do gatilho de
  pressa, por que o lock é fail-open.
- As **fronteiras do lint**. Foram testadas com violação proposital:

```bash
# dominio nao pode importar infraestrutura nem ler process
echo "const axios = require('axios'); const p = process.env.X;" > src/domain/_v.js
npx eslint src/domain/_v.js
rm src/domain/_v.js
```

Tem de acusar **os dois erros de fronteira** (além de dois avisos de variável não usada):

```
Camada pura nao pode depender de infraestrutura (DIP)   no-restricted-syntax
Unexpected use of 'process'                             no-restricted-globals
```

O mesmo vale trocando `src/domain` por `src/application` ou `src/shared`. E em
`src/infrastructure`, um `require('../main/container')` tem de ser barrado.

**Não vale o seu tempo:**

- Indentação nos três arquivos movidos verbatim (22, 24, 30).
- Nomes de variáveis dentro de corpos movidos — nada foi renomeado nesses commits.

## As seis dívidas descobertas no caminho

Nenhuma foi corrigida. Todas estão congeladas em teste e documentadas em
[15 — Inventário de comportamento](15-inventario-de-comportamento.md).

| ID | O que é | Por que importa |
|---|---|---|
| **D-19** | Sábado tratado como fim de semana | Correção **já aprovada pelo negócio**, represada. Cliente que escreve sábado ouve "na segunda-feira às 9h" |
| **D-34** | "o consultor **já vai** assumir" escapa da guarda de promessa falsa | Transferência falha, o cliente fica esperando quem não vem |
| **D-31** | Nota diz "Sem loja escolhida" logo abaixo de "Loja escolhida: Malvinas" | O vendedor lê informação falsa |
| **D-35** | Config inválida vira `NaN` em silêncio | O anti-loop **para de proteger** e nada avisa |
| **D-08** | Resposta que menciona "consultor" não é quebrada em balões | Palavra corriqueira no domínio; parte das respostas chega num balão longo |
| **D-32** | ID de dispositivo de 1 dígito escapa da allow-list | Alcance pequeno hoje (a lista só vale na fase de teste) |
| **D-33** | Memória devolve referência; Redis devolve cópia | Dev e produção divergem na persistência |

## Números

| | Antes (`develop`) | Depois |
|---|---:|---:|
| `index.js` | 1.376 linhas | **235** |
| Código em `src/` | 0 | **3.105** em 30 arquivos |
| Testes automatizados | 0 | **678** |
| Cobertura de `src/` | — | 99% statements |
| Erros de lint | (sem lint) | **0** |
| Leituras de `process.env` fora de um lugar só | 21 | **0** |

## O que **não** foi feito

- **Nenhuma dívida corrigida.** Por decisão: refatoração não muda comportamento.
- **Nenhum arquivo legado da raiz movido**: `data.js`, `flow.js`, `horario.js`, `prompts.js`,
  `store.js`, `pipeline.js`, `test-chat.js`, `sim-lead.js` — 1.134 linhas. São módulos coerentes e
  testados; movê-los é arrumação, não risco.
- **Validação de configuração no boot.** Recusar subir com valor inválido resolve a D-35, mas é
  mudança de comportamento.
- **Nada foi para produção.**

## Caminho até a produção

```
refatoracao/v2  --PR-->  develop  --PR-->  main
```

Antes do segundo PR, confirme que nada entrou na `main` por fora:

```bash
git log --oneline --no-merges develop..main   # tem que sair vazio
```
