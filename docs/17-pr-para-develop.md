# PR: `refatoracao/v2` → `develop`

Texto pronto para colar na descrição do Pull Request, e os comandos para abri-lo.

---

## Comandos

A branch **ainda não foi publicada** — não há chave SSH configurada na máquina onde a refatoração
foi feita. Depois de configurar o acesso:

```bash
git checkout refatoracao/v2
git push -u origin refatoracao/v2
```

Depois abra o PR pela interface do GitHub, ou:

```bash
gh pr create --base develop --head refatoracao/v2 \
  --title "Refatoração para DDD + hexagonal, sem mudança de comportamento" \
  --body-file docs/17-pr-para-develop.md
```

### Antes de mesclar

```bash
npm ci
npm test                                          # 711 testes, ~5s
npm run lint                                      # 0 erros, 0 avisos
bash test/baseline/coletar-baseline.sh revisao
diff test/baseline/producao-develop-requisicoes.log test/baseline/revisao-requisicoes.log
```

O `diff` tem de sair **vazio**. Ele compara a resposta de todas as rotas contra o código que está em
produção hoje.

---

## Descrição do PR

### O que este PR faz

Reorganiza o código em DDD + arquitetura hexagonal, **sem mudar nenhum comportamento do sistema**.

O `index.js` foi de **1.376 para 235 linhas**; nasceram 4.045 linhas em `src/`, divididas em domínio,
aplicação, infraestrutura e composição. Todo o trabalho está em 38 commits pequenos, cada um com sua
própria verificação.

### A alegação central

> O sistema faz exatamente o que fazia antes.

Três provas independentes, todas verdes em cada um dos 38 commits:

| Prova | O que garante |
|---|---|
| **711 testes** | Domínio, adapters isolados, contrato do repositório (Redis **e** memória), turno completo de ponta a ponta |
| **Linha de base executável** | Sobe o servidor de verdade e compara a resposta de **todas as rotas** contra a produção. Diff vazio |
| **Lint de fronteira** | `domain` não importa infraestrutura, `application` não lê `process.env`, `infrastructure` não conhece o composition root. Testado com violação proposital |

### O que mudou de comportamento

**Nada no sistema.** Duas mudanças em ferramenta de desenvolvimento:

- `npm run chat` e `npm run sim` passam a usar o **atendimento de produção** (antes tinham a própria
  cópia do turno, já divergida — não passavam o expediente ao prompt e citavam um departamento
  inexistente).
- A função `criarOportunidade` foi removida: **nunca era chamada**. O `/diag` segue reportando o
  pipeline como antes.

### O que foi encontrado e **não** corrigido

Oito comportamentos errados, todos preservados de propósito e congelados em teste com a marca
`CONGELA`. Corrigir qualquer um é mudança de comportamento e precisa de decisão do negócio.

| ID | O que acontece hoje |
|---|---|
| **D-19** | **Sábado tratado como fim de semana.** O negócio já aprovou 08h-18h. Cliente que escreve sábado ouve "na segunda-feira às 9h" |
| **D-36** | **O modo plantão nunca chega ao prompt.** Às 2h da manhã o bot pode prometer atendimento imediato |
| **D-34** | "o consultor **já vai** assumir" escapa da guarda de promessa falsa: transferência falha e o cliente espera quem não vem |
| **D-31** | A nota diz "Sem loja escolhida" logo abaixo de "Loja escolhida: Malvinas" |
| **D-35** | Configuração inválida vira `NaN` em silêncio: o anti-loop **para de proteger** e nada avisa |
| **D-08** | Resposta que menciona "consultor" não é quebrada em balões — e "consultor" é palavra corriqueira aqui |
| **D-32** | ID de dispositivo de um dígito escapa da allow-list |
| **D-33** | Memória devolve referência, Redis devolve cópia: desenvolvimento e produção divergem na persistência |

**D-19 e D-36 já foram corrigidas uma vez**, na primeira tentativa de refatoração, e se perderam na
troca de branch. É o principal argumento para integrar isto logo: enquanto a branch fica parada, elas
podem se perder de novo.

### Dívidas resolvidas

- **D-30** — os feriados eram lidos de `process.env` no carregamento do módulo. Agora entram por
  parâmetro. Comportamento idêntico; o domínio deixou de depender de ambiente.
- **D-04** — os testers locais duplicavam a lógica do turno.

### Como revisar

Não leia 6.700 linhas de diff. O guia está em
[docs/16-revisao-da-v2.md](16-revisao-da-v2.md) — ele agrupa os 38 commits em cinco blocos, diz o
que procurar em cada um e, mais útil, **o que ignorar**.

Três commits movem código verbatim, sem reindentar, para o diff ser uma relocação pura e revisável:
o turno virando caso de uso, o transbordo e o servidor HTTP. Neles, olhe o `--stat`, não o diff.

### Números

| | Antes | Depois |
|---|---:|---:|
| `index.js` | 1.376 linhas | **235** |
| Código em `src/` | 0 | **4.045** em 36 arquivos |
| Testes automatizados | 0 | **711** |
| Erros e avisos de lint | (sem lint) | **0** |
| Leituras de `process.env` fora de um único lugar | 21 | **0** |
| Implementações da conversa | 2 | **1** |

### Depois deste PR

`develop` → `main` por PR, como os anteriores. Confira antes que nada entrou na `main` por fora:

```bash
git log --oneline --no-merges develop..main   # tem que sair vazio
```
