# 15 — Inventário de Comportamento

O que mudou no comportamento do sistema entre o commit raiz (`255c13b`) e o que está em produção
hoje, levantado **mecanicamente**, sem depender de leitura manual dos commits.

## Como foi levantado

A primeira refatoração (branch `refatoracao/arquitetura-ddd`) produziu uma suíte que congelava o
comportamento de `255c13b`. Como aquela refatoração preservou os nomes exportados dos módulos puros,
os testes rodam contra o código do legado trocando **uma linha de `require`** em cada arquivo:

| Teste | Apontado para |
|---|---|
| `test/unidade/flow.test.js` | `flow.js` |
| `test/unidade/data.test.js` | `data.js` |
| `test/unidade/horario.test.js` | `horario.js` |

Rodando assim, **cada asserção que falha é uma mudança de comportamento**. Resultado da primeira
execução: **102 testes, 85 passaram, 17 falharam.**

Os 85 que passaram já são informação: aquela parte do comportamento **não mudou** e está protegida.

## Categoria A — o outro dev mudou (v2 tem de preservar)

### A1. `formaPagamento` deixou de bloquear o funil

`flow.js` passou de `if (!formaPagamento)` para `if (!formaPagamento && !loja)`.

Depois que o cliente escolhe a unidade, a forma de pagamento não é mais perguntada — quem fecha a
condição é o consultor da loja. Antes, a IA voltava atrás e represava pagamento depois de o cliente
já ter decidido onde comprar.

Congelado em `flow.test.js`, em dois testes: um para cada lado da condição.

### A2. Não existe mais departamento de fallback

`DEPARTAMENTOS.geral = 'Comercial'` saiu. Entrou `entrada: 'Agente IA'`, que é **onde o lead já
está** enquanto a IA atende.

A consequência é conceitual e importante: quando a loja não é identificada, **não há transferência**
— o ticket simplesmente permanece na fila de entrada para a equipe direcionar. Isso é caminho
normal, não falha.

### A3. Objeção `moto_eletrica`

`OBJECOES` foi de 9 para 10 entradas. A loja não vende moto elétrica, e a objeção existe para a IA
parar de afirmar que vende.

## Categoria B — a refatoração mudou, aprovado pelo negócio, nunca chegou à produção

### B1. Sábado (D-19)

O código em produção trata **sábado como fim de semana**: fechado o dia inteiro, em qualquer hora.
A spec 0009 da primeira refatoração mudou para **08h às 18h**, e o negócio confirmou.

Essa correção nunca foi para a `main`. Foram 8 falhas na sonda, todas na mesma causa, incluindo três
efeitos visíveis para o cliente:

| Momento | Produção diz | Deveria dizer |
|---|---|---|
| Sábado 10h | fechado, "na segunda-feira às 9h" | aberto |
| Sexta 19h | "na segunda-feira às 9h" | "amanhã às 8h" |
| Sexta 25/12 (Natal) | "na segunda-feira às 9h" | "amanhã às 8h" |

**Está congelado como está**, marcado `CONGELA` em `horario.test.js`. Corrigir é mudança de
comportamento e precisa de spec própria — mas é uma correção **já aprovada**, só represada.

Junto dela vinha o **D-28**: o modo plantão chegando ao prompt da resposta, para o bot não prometer
atendimento imediato de madrugada. Também não está em produção.

## Categoria C — comportamento NOVO, que a sonda não detecta

A sonda encontra comportamento que **mudou** em caminho já coberto. Não encontra comportamento
**acrescentado** em caminho novo — ali não há teste para falhar.

Esse buraco aparece na cobertura. Rodando a sonda com `--coverage`, as linhas não cobertas de
`flow.js` são, literalmente, o código novo:

| Linhas | O que é |
|---|---|
| 23-29 | `detectarModeloMencionado` — qual moto a IA já citou |
| 37-40 | `modoAtalho` — cliente com pressa abandona o funil, só a loja importa |
| 50-55 | adoção automática de `modeloApresentado` após 2 menções, ou quando o cliente seguiu adiante |

Cobertura da sonda: `horario.js` 100%, `data.js` 98%, `flow.js` **85,6%** — e os 14% que faltam são
exatamente o que o outro dev acrescentou.

Fora dos módulos puros, ainda **sem nenhuma caracterização**, tudo dentro de `index.js`:

- transferência de departamento (`forceTicketToDepartment` + `queueId`, rota `/diag/transferir`)
- `senderAlt` com prioridade e tolerância ao ID de dispositivo na allow-list
- lead impaciente transferido e conversa encerrada pós-handoff
- encerramento gracioso em SIGTERM/SIGINT
- fail-fast quando falta `OPENAI_API_KEY`
- `/health` devolvendo `uptime` e `timestamp`

A borda HTTP dessas rotas está congelada na [linha de base](12-linha-de-base.md).

**Atualização — a transferência de departamento já está caracterizada.** O teste dourado ganhou o
cenário 2b, que cobre: o roteamento de cada loja para a fila certa (Matriz 228, Malvinas 230,
Monteiro 231), o desligamento por `TRANSFERIR_DEPARTAMENTO=false`, o fechamento do ticket por
`TRANSFERIR_FECHANDO=true`, a sobrescrita do ID pelo ambiente e a falha do Push.

Esse último virou um `CONGELA` desconfortável: **quando toda chamada ao CRM falha, o lead é marcado
como finalizado mesmo assim** — a resposta não chega ao cliente, a nota não chega à equipe, a
transferência é recusada, e o atendimento simplesmente desaparece. É a D-17 vista por dentro.

**Atualização 2 — a Categoria C está fechada, com uma exceção.** Além da transferência, entraram:

| Área | Onde ficou | O que revelou |
|---|---|---|
| `senderAlt` vs `contact.number` | `parsePayload.test.js` | **A prioridade inverteu.** O `SenderAlt` agora vence, porque vem como JID completo e o ID do dispositivo (`:24`) é cortado corretamente; o `contact.number` às vezes chega com o sufixo grudado, sem separador, e aí não há como separar |
| Lead impaciente (`modoAtalho`) | `turno.test.js` cenário 16 + `flow.test.js` | A pergunta da loja é **fixa**, não passa pelo modelo — quem pediu objetividade não recebe outro parágrafo de qualificação |
| Encerramento pós-handoff | `turno.test.js` cenário 17 | Sinal de fim ou teto de respostas encerram; depois disso a IA fica em **silêncio absoluto**, só registrando o histórico |
| Adoção do modelo apresentado | `flow.test.js` | Adota após 2 menções da IA, ou assim que o cliente seguir adiante (loja, pagamento, CPF, cor) |

Falta apenas o **shutdown gracioso** e o **fail-fast da chave**, que são comportamento de processo:
estão cobertos pela borda (a linha de base sobe o servidor de verdade) e pela guarda de
inicialização em `agendamento.test.js`.

Cobertura dos módulos puros: **100% de statements, 99,1% de ramos.**

## Categoria D — dívida encontrada de passagem

**D-35: valor de configuração inválido vira `NaN` em silêncio.**
`parseInt('vinte', 10)` devolve `NaN`, e nada reclama. O servidor sobe normalmente e só se comporta
de forma estranha depois: uma janela `NaN` faz **toda comparação de tempo dar `false`** — o
anti-loop para de proteger, o agrupamento para de agrupar, o reset por inatividade nunca dispara.

Não há erro no log, não há alerta. Congelado em `config.test.js`. Validar a configuração no boot e
recusar subir com valor inválido é mudança de comportamento e tem spec própria.

**D-34: a guarda contra promessa falsa de transferência tem um buraco.**
Quando a transferência para a loja falha, o sistema substitui a resposta da IA se ela tiver
prometido o repasse. A detecção usa
`consultor (j[áa]|vai) (assumir|continuar|dar sequ)`, que casa "consultor **já** assumir" e
"consultor **vai** assumir" — mas **não** "consultor **já vai** assumir", que é a redação mais
natural das três e a que o modelo produz com frequência.

| Frase | Guarda pega? |
|---|---|
| o consultor vai assumir | sim |
| o consultor já assumir | sim |
| **o consultor já vai assumir** | **não** |
| o consultor já vai dar sequência | não |

Consequência: transferência falha, a IA diz "o consultor já vai assumir", o cliente fica esperando
alguém que nunca vai chegar. É exatamente o que a expressão existe para impedir. Congelado em
`sinais-do-cliente.test.js`.

**D-33: os dois repositórios divergem na leitura.** O adapter de memória devolve a **referência** do
objeto guardado; o de Redis devolve uma cópia nova (o JSON é reparseado a cada leitura). Em memória,
mutar o `leadData` lido altera o estado guardado **sem chamar `saveLead`** — com Redis, não altera.

Isso significa que o sistema pode se comportar de um jeito em desenvolvimento (memória) e de outro em
produção (Redis), exatamente na parte mais delicada: a persistência do atendimento. O teste de
contrato declara a divergência em voz alta em vez de escondê-la.

**D-32: a tolerância ao 9º dígito e a tolerância ao ID de dispositivo colidem.**
Um ID de dispositivo de **um** dígito colado num número de 12 dígitos produz 13 — exatamente o
comprimento que dispara a regra do 9º dígito. Se o 5º caractere for `9` (parte do número, não o 9º
dígito de celular), a regra remove o dígito errado e a comparação falha:

```
558494610845 + 9  ->  5584946108459  ->  núcleo 558446108459   (perdeu o 9 do meio)
```

Com ID de dois dígitos não acontece, porque a regra só age em 13 caracteres. Alcance real hoje é
pequeno: a allow-list só vale na fase de teste (`IA_ALLOWED_CONTACTS` vazia libera todos). Congelado
em `telefone.test.js`.

**D-30 — RESOLVIDA.** Era: os feriados extras eram lidos do ambiente no carregamento do módulo.
Agora entram por parâmetro (`Expediente.criar({ feriadosExtras })`), e quem lê a variável é o
`src/main/config`, como todas as outras. O comportamento do sistema não mudou — a leitura continua
acontecendo uma vez, no boot. O que mudou é que o domínio deixou de depender de ambiente, e ficou
possível ter dois calendários no mesmo processo (antes, o primeiro `require` vencia para sempre).

Texto original, para referência:

**D-30: os feriados extras são lidos do ambiente no carregamento do módulo.**
`horario.js` monta um `Set` a partir de `process.env.FERIADOS` quando o módulo é carregado. Mudar a
variável em execução não tem efeito, e uma regra de negócio (o calendário) passa a depender de
ambiente. Congelado num teste explícito; injetar os feriados por parâmetro sai na fatia do domínio
de expediente.

Achados do lint, presos no ratchet e não corrigidos:

- `index.js` — `fs` e `path` importados sem uso; 4 blocos `catch` vazios
- `prompts.js` — argumento `expediente` sem uso; **classe de caracteres com emoji composto** na
  regex de quebra de mensagem (seletor de variação `\u{FE0F}`), que é defeito em potencial

## Estado da suíte

**678 testes verdes** contra o código de produção, sem rede e sem custo: unidade nos módulos puros,
caracterização de `parsePayload`, `montarResumo` e das proteções, e o teste dourado, que exercita o
turno inteiro com OpenAI, ChatClean e estado falsificados.

```bash
npm test
```

Os testes marcados `CONGELA` documentam comportamento que sabemos estar errado e que **não deve ser
corrigido pela refatoração**. Quando a correção vier, com spec aprovada, o mesmo teste é invertido —
foi assim que o D-19 e o D-28 foram tratados na primeira passada.

## O que este inventário decide

1. **Categoria A entra na v2 como está.** É produção funcionando.
2. **Categoria B é decisão do negócio**, e já está tomada — falta só agendar a spec.
3. **Categoria C precisa de caracterização antes de ser refatorada.** É o próximo passo: nenhuma
   dessas áreas pode ser tocada sem teste, e a maior delas (transferência de departamento) é também
   a mais crítica, porque é o que faz o lead chegar ao vendedor.
