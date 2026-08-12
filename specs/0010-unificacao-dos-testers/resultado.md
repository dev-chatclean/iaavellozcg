# RESULTADO 0010 — Unificação dos testers locais

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O problema que isto fecha (D-04)

`index.js`, `test-chat.js` e `sim-lead.js` implementavam o **mesmo turno de conversa de três jeitos
diferentes** — e já divergiam entre si:

| | produção | `test-chat` | `sim-lead` |
|---|---|---|---|
| `response_format: json_object` | sim | **não** | sim |
| Passava `expediente` ao prompt | sim | **não** | sim |
| Aplicava `tipoContato` | sim | sim | **não** |
| Reavaliava perfil em correção | sim | **não** | **não** |
| Montava o resumo | `montarResumo` | ad-hoc | **cópia** divergente |

Ou seja: quem testava no terminal validava um comportamento que **não era o de produção**. Isso é
pior do que não ter tester — dá confiança falsa.

## O que mudou

Os dois passaram a montar o container com um canal de terminal e um repositório em memória, e a
chamar o **mesmo caso de uso** que roda em produção:

```js
const deps = container.criar(config, { canal, notificador: canal, repositorio });
const atendimento = ProcessarMensagemRecebida.criar(deps, config);
await atendimento.processarMensagem({ chatId, texto, tipo: 'text' });
```

| Arquivo | Antes | Depois |
|---|---:|---:|
| `test-chat.js` | 116 linhas com turno próprio | **78 linhas**, sem lógica de conversa |
| `sim-lead.js` | 140 linhas com turno e resumo próprios | **80 linhas** |

Peças novas, ambas pequenas:
- `CanalDeTerminal` — implementa `CanalDeMensagem` e `NotificadorDeEquipe` imprimindo no terminal.
- `ClienteComContagem` — Decorator que acumula tokens sem que os adapters saibam, para o
  `npm run sim` reportar o custo. Antes essa contagem era o motivo de o tester ter turno próprio.
- `container.criar(config, sobrescritas)` — permite trocar canal e repositório sem duplicar a
  montagem.

## Verificado rodando de verdade

Sem chave, falha na validação de configuração, como o servidor:

```
$ node sim-lead.js
Configuração inválida — o servidor não vai subir:
  - OPENAI_API_KEY: é obrigatória (chave da OpenAI com crédito)
```

Com chave inválida, executa o turno de produção inteiro e cai no fallback correto:

```
CLIENTE > oi
Erro ao extrair informações: 401 Incorrect API key provided
Erro ao gerar resposta IA para 5583*****0000: 401 ...
BOT      > Opa, tive uma instabilidade rapidinha por aqui 😅 Pode me mandar de novo o que você disse?
```

O telefone sai mascarado no log — o mesmo comportamento de produção, porque é o mesmo código.

## Guarda contra o drift voltar

`test/unidade/testers-sem-drift.test.js` verifica **estrutura**, não comportamento: os testers têm
que usar o caso de uso e **não podem** chamar a OpenAI direto, montar prompts, reimplementar a
máquina de estados ou o resumo. Se alguém reintroduzir lógica de turno num tester, quebra.

O D-04 não voltava por acidente — voltava porque era conveniente. Agora custa um teste vermelho.

## Números

| | |
|---|---|
| Testes | **428** (eram 412), 16 novos |
| Linha de base | idêntica |
| Lint | 0 erros, 1 aviso |
| Implementações do turno | **1** (eram 3) |

## Mudança de comportamento declarada (nas ferramentas de desenvolvimento)

Os testers agora se comportam como produção — que é o objetivo. Consequências práticas:
- O atraso de digitação (900 ms + 18 ms por caractere) agora acontece também no terminal.
- O resumo impresso é o real, montado pelo domínio.
- Follow-up e reset por inatividade passam a existir na sessão local.

Nada disso afeta o produto: são ferramentas de desenvolvimento.
