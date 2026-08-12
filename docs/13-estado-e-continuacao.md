# 13 — Estado Atual e Continuação

**Última atualização:** 2026-08-12, fim do dia 2 · **Branch:** `refatoracao/arquitetura-ddd`
**Último commit:** `eb6b473` · **Árvore limpa, tudo versionado, `main` intocada.**

Este é o documento de retomada. Quem senta na próxima sessão lê daqui.

---

## 1. Onde paramos, em uma frase

**A refatoração estrutural está concluída.** O que resta é dívida operacional — e toda ela muda
comportamento, então depende de decisão do negócio antes de ser tocada.

## 2. Números

| Indicador | Início (`255c13b`) | Agora | Meta original |
|---|---:|---:|---:|
| Testes automatizados | 0 | **430** (3s) | — |
| `index.js` | 1040 linhas | **95** | < 30 |
| Maior arquivo de produção | 1040 | **440** (o caso de uso) | < 250 |
| Erros de lint | (sem lint) | **0** | 0 |
| Avisos de lint | (sem lint) | **0** | — |
| Implementações do turno | 3 | **1** | 1 |
| Itens de dívida resolvidos | 0 | **19** | 29 |
| Código na arquitetura alvo | 0 | **36 arquivos** | — |

## 3. Specs entregues

| # | Entrega | Dívida fechada |
|---|---|---|
| 0001 | Rede de segurança: testes, lint, CI, linha de base | D-12, D-13 |
| 0002 | Configuração validada, webhook fail-closed, PII fora do log | D-23, S1, S4, S5, S8 |
| 0003 | ACL do payload com motivos de descarte nomeados | D-29 |
| 0004 | Portas e adapters | D-02, D-26 |
| 0005 | Manipuladores de mídia (Strategy) | (estrutural) |
| 0006 | Domínio do atendimento: políticas nomeadas | D-03 |
| 0007 | Remoção do pipeline de oportunidades | D-05 |
| 0008 | Turno vira caso de uso | D-01, D-24 (parcial) |
| 0009 | Expediente: sábado e plantão na resposta | D-19, D-28 |
| 0010 | Testers usam o caso de uso de produção | **D-04** |
| 0018 | `index.js` como bootstrap | D-01, D-22 |
| 0022 | Catálogo e expediente no domínio | (estrutural) |

Cada uma tem `resultado.md` em `specs/`.

## 4. Estrutura hoje

```
index.js  95 linhas — montar(config, deps) + iniciar(sistema)

src/
  main/          config (validada), container (composition root)
  application/   casos-de-uso/, fila/, midia/, portas/
  domain/        atendimento/ (+politicas), catalogo/, expediente/, mensageria/
  infrastructure/ http/, openai/, chatclean/, redis/, memoria/, midia/,
                  relogio/, terminal/

raiz: flow.js (fachada, 51) · prompts.js (204) · test-chat.js (78) · sim-lead.js (80)
```

## 5. Como retomar

```bash
git checkout refatoracao/arquitetura-ddd    # NUNCA fazer merge na main
npm install
npm test          # 430 testes, ~3s, sem rede e sem custo
npm run lint      # 0 erros, 0 avisos
bash test/baseline/coletar-baseline.sh conferencia
diff test/baseline/antes-da-refatoracao-requisicoes.log test/baseline/conferencia-requisicoes.log
```

Diff vazio e suíte verde: o ponto de partida está íntegro.

## 6. O que resta — e por que parou aqui

Toda a dívida restante **muda comportamento**. O critério do projeto é que mudança de comportamento
só entra quando pedida explicitamente. Cada item abaixo é uma spec pronta para ser aprovada.

### Operacional (Fase 8)

| ID | O que é | Impacto real | Spec |
|---|---|---|---|
| **D-15** | Fila, dedup e rate-limit em memória | **O sistema só é seguro com UMA instância.** Com duas: mensagens duplicadas, rate-limit multiplicado, follow-up em dobro | 0012 |
| **D-16** | Shutdown abrupto | Todo deploy perde turnos em voo e a fila. O estado só é gravado ao fim do turno, então o cliente pode "falar no vazio" | 0014 |
| **D-17** | Sem retry nas chamadas externas | Instabilidade de 2s da OpenAI vira mensagem de desculpa; falha no Push é silêncio total | 0013 |
| **D-18** | Redis degrada em silêncio | Sem `REDIS_URL`, estado em memória sem alarme | 0019 |
| **D-20** | Sem log estruturado nem métricas | Não dá para responder "quantos leads ontem?" | 0015 |

### Correções de defeito

| ID | O que é | Spec |
|---|---|---|
| **D-06** | Consultar o funil marca o lead como qualificado — montar um follow-up qualifica o lead | 0021 |
| **D-08** | A quebra de mensagens decide por regex com palavras comuns do domínio | 0020 |
| **D-25** | Atraso de digitação roda dentro do lock do atendimento | 0020 |
| **WABA** | `mediaMimetype` e `nomeContato` vêm vazios no formato WABA — o vendedor recebe "Contato: Lead" | (a especificar) |

### Segurança e LGPD

| ID | O que é | Spec |
|---|---|---|
| **S2** | CPF completo no resumo enviado à equipe | 0016 |
| **S3** | Dados pessoais em claro no Redis por 30 dias | 0016 |
| **S7** | `mediaUrl` baixada sem validar a origem | 0019 |
| **S9, S10** | Sem política de expurgo nem base legal declarada | 0016 |

### Estrutural que ainda cabe sem mudar comportamento

- **Spec 0011** — `prompts.js` vira `infrastructure/openai/prompts/` versionado, com suíte de evals.
  É a última peça da raiz que não é bootstrap nem tester.
- **Spec 0017** — tipagem incremental (JSDoc → TypeScript). Agora é viável: não há mais três
  implementações do mesmo turno para tipar.

## 7. Pendência operacional (ação no servidor)

Continua valendo, e ninguém fez ainda:

```bash
NODE_ENV=production pm2 start index.js --name iaavellozcg
```

Sem `NODE_ENV=production`, o fail-closed do webhook **não dispara**. Com ele, o servidor se recusa a
subir sem `WEBHOOK_SECRET` (mínimo 16 caracteres) e sem `CC_PUSH_URL` — comportamento correto, mas
quem fizer o próximo deploy precisa saber antes e ter o segredo gerado.

Nada disso está em produção: a branch **nunca foi mesclada**.

## 8. Decisões de negócio ainda em aberto

| # | Pergunta | Suposição em vigor |
|---|---|---|
| 1 | Horário de segunda a sexta continua 09h-18h? | Mantido 09h-18h |
| 2 | Monteiro tem horário próprio? | Igual às unidades de Campina Grande |
| 3 | De quais endereços vêm as mídias que os clientes enviam? | Só o do ChatClean foi observado (Oracle Cloud, Vinhedo). Necessário para a spec 0019 |

## 9. O padrão que funcionou, para repetir

1. **Teste de caracterização congela o comportamento atual**, inclusive o errado.
2. **A fatia troca a implementação.** Se os testes congelados passam sem alteração, o contrato não mudou.
3. **A correção do defeito inverte o teste** que o documentava.
4. **A linha de base roda a aplicação de verdade** e compara — pega o que o teste não vê.

Foi assim que 12 specs entraram sem uma única regressão detectada em produção. Duas regressões
minhas foram encontradas e corrigidas no caminho (varredor duplicado, `await` faltando), ambas por
teste — nenhuma chegou perto de um cliente.

## 10. Convenções (valem para quem continuar)

- **Nunca fazer merge na `main`.**
- **Nunca usar emojis** em documentação, código, commits ou respostas. Exceção: o texto que o *bot*
  envia ao cliente segue RN-022.
- **Commits concisos**, com o número da spec no escopo.
- **Executar a aplicação antes de mudar código.**
- **Nenhum código sem spec aprovada.**
- **Mudança de comportamento só quando pedida.** Achado vira dívida documentada e teste `CONGELA`,
  não correção de contrabando.
