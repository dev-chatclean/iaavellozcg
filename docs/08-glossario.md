# 08 — Glossário / Linguagem Ubíqua

Vocabulário oficial do projeto. **Use estes termos em specs, código, testes, commits e conversas.**
Não crie sinônimos. Se um termo novo aparecer, ele entra aqui antes de entrar no código.

## Domínio — Atendimento (core)

| Termo | Definição | No código legado |
|---|---|---|
| **Atendimento** | A conversa completa com um contato, do primeiro "oi" ao transbordo. Agregado raiz. | `leadData` |
| **Lead** | Pessoa interessada, ainda não é cliente. | `tipoContato: 'lead'` |
| **Cliente atual** | Já comprou; procura pós-venda. Sai do funil comercial. | `tipoContato: 'cliente'` |
| **Turno** | Um par mensagem-do-cliente → resposta-do-bot. | iteração de `processarMensagem` |
| **Funil** | Sequência ordenada de campos que qualificam o lead. | `flow.js: CAMPOS` |
| **Etapa** | Posição atual no funil; o primeiro campo vazio. | `determinarProximoCampo()` |
| **Diagnóstico** | Levantamento da realidade atual: transporte + gasto mensal + situação de moto. **Bloqueia toda informação de produto.** | `diagnosticoCompleto` |
| **Qualificação** | Conjunto completo de campos que autoriza o transbordo. | `qualificacaoCompleta` |
| **Dados de simulação** | CPF, nascimento, nome completo, telefone, CNH, cor/modelo — para a análise de crédito. | `CAMPOS_EXTRAS` |
| **Perfil** | Classificação da dor do lead (8 valores). Define o gancho da abordagem. | `perfilKey`, `PERFIS` |
| **Gancho** | Argumento consultivo específico do perfil. | `PERFIS[x].gancho` |
| **Objeção** | Resistência declarada, com resposta consultiva mapeada (9 tipos). | `objecaoAtiva`, `OBJECOES` |
| **A conta** | A projeção anual do gasto atual do cliente — o argumento central da venda. | (só no prompt) |
| **Transbordo** | Entrega do atendimento a um consultor humano. Encerra o papel do bot. | `notificarEquipe`, `encaminhar`, `finalizado` |
| **Handoff** | Sinônimo técnico de transbordo. Prefira **transbordo**. | — |
| **Resumo** | Bloco estruturado publicado no CRM no transbordo. | `montarResumo` |
| **Reativação** | Follow-up após 30 min de inatividade. | `followUpDueAt` |
| **Reset por inatividade** | Descarte do atendimento após 24h sem interação. | `RESET_INATIVIDADE` |

## Domínio — Catálogo

| Termo | Definição |
|---|---|
| **Modelo** | AZ1, AZ125 ou AZX160. Nomes imutáveis (RN-011). |
| **Preço promocional** | O único preço divulgado, **sempre já com emplacamento** (RN-012). |
| **Emplacamento** | Documentação/registro da moto, incluso no preço. Argumento de venda. |
| **Forma de pagamento** | Cartão (até 21x), financiamento (entrada zero até 48x), consórcio, à vista. |
| **Parcela** | Valor mensal do financiamento. **O bot nunca informa** (RN-010). |
| **Unidade / Loja** | Matriz, Malvinas (Campina Grande) ou Monteiro. |

## Domínio — CRM e operação

| Termo | Definição |
|---|---|
| **Departamento** | Destino do transbordo no CRM: Loja Matriz, Loja Malvinas, Loja Monteiro, Comercial (fallback), Pós-venda. |
| **Ticket** | Conversa no CRM ChatClean. Tem `status` e `userId`. |
| **Bot de fila** | Modo de operação: o bot responde enquanto **nenhum humano assumiu** o ticket (RN-052). |
| **Nota interna** | Mensagem visível só para a equipe no ticket (`onlyNote: true`). |
| **Push** | Envio de mensagem ao cliente via `CC_PUSH_URL`. |
| **Oportunidade** | Card no funil comercial do CRM. Funcionalidade inerte hoje. |
| **Expediente** | Segunda a sexta, 09h–18h (America/Recife), exceto feriados. |
| **Plantão** | Modo fora de expediente: não promete atendimento imediato, agenda retorno. |
| **Blindagem anti-loop** | Proteção contra ping-pong com outro bot (RN-054). |
| **Agrupamento** | Junção de mensagens de texto em rajada num único turno (RN-057). |
| **Allow-list** | Números liberados na fase de teste. |
| **Núcleo canônico** | Telefone reduzido para comparação, ignorando o 9º dígito. |

## Domínio — Inteligência

| Termo | Definição |
|---|---|
| **Extração** | Chamada de LLM (temp 0) que converte a mensagem em campos estruturados. |
| **Redação / Geração** | Chamada de LLM (temp 0.7) que escreve a resposta com persona. |
| **System prompt / `SYSTEM_SDR`** | Prompt-mestre estático com persona, regras e conhecimento. |
| **Rodapé dinâmico** | Bloco de contexto do turno, enviado como mensagem do usuário. |
| **Sinal transitório** | Informação válida só no turno (`objecao`, `perguntou`, `analiseImagem`). |
| **Correção** | Lista de campos que o cliente está corrigindo explicitamente (RN-003). |
| **Jailbreak** | Tentativa de burlar as regras. Deve zerar a extração (RN-025). |
| **Eval** | Avaliação automatizada da qualidade conversacional em roteiros completos. |

## Técnico — arquitetura alvo

| Termo | Definição |
|---|---|
| **Porta (Port)** | Interface definida pelo domínio/aplicação para falar com o mundo. |
| **Adapter** | Implementação concreta de uma porta (OpenAI, ChatClean, Redis, Express). |
| **ACL (Anti-Corruption Layer)** | Tradução entre o modelo externo e o nosso (ex.: payload ChatClean). |
| **Composition root** | Único lugar onde adapters concretos são instanciados e injetados (`main/`). |
| **Caso de uso** | Orquestrador de um fluxo de negócio. Nome imperativo (`ProcessarMensagemRecebida`). |
| **Fatia** | Unidade de trabalho da estrangulação: um pedaço do legado migrado ponta a ponta. |
| **Strangler Fig** | Estratégia: o novo cresce ao redor do velho até substituí-lo, sem big bang. |
| **Teste de caracterização** | Teste que congela o comportamento **atual** (mesmo errado) como rede de segurança. |
| **Feature toggle** | Variável que liga/desliga uma fatia nova, permitindo rollback imediato. |

## Falsos amigos (não confunda)

| Não use | Use | Motivo |
|---|---|---|
| "segmento" | **perfil** | Nome herdado do projeto `iachatclean`. |
| "reunião marcada" | **transbordo** | Etapa de outro produto; sobrou nos comentários do `pipeline.js`. |
| "empresa" (no lead) | — | Campo fantasma no `/leads`, não existe no domínio Avelloz. |
| "cliente" para quem ainda não comprou | **lead** | Distinção importante: cliente vai para Pós-venda. |
| "finalizar a conversa" | **transbordar** | O atendimento continua após o transbordo (RN-044). |
| "preço de tabela" | **preço promocional com emplacamento** | Só existe uma forma de apresentar o preço. |
