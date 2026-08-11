# 05 — Modelo de Domínio (DDD)

## Domínio

**Pré-venda consultiva de motos por mensageria**: transformar uma conversa de WhatsApp num lead
qualificado e diagnosticado, entregue ao vendedor certo da loja certa.

## Bounded Contexts

```
┌───────────────────────────────────────────────────────────────────────┐
│                        ATENDIMENTO  (CORE DOMAIN)                     │
│  Atendimento · Qualificacao · Diagnostico · Perfil · Objecao ·        │
│  Transbordo · Reativacao                                              │
│  A metodologia consultiva mora aqui. É o que diferencia o produto.    │
└───────┬─────────────┬──────────────┬──────────────┬──────────────┬────┘
        │ usa         │ usa          │ usa          │ usa          │ usa
        ▼             ▼              ▼              ▼              ▼
┌──────────────┐┌────────────┐┌─────────────┐┌────────────┐┌─────────────┐
│  CATÁLOGO    ││ INTELIGÊNCIA││ MENSAGERIA  ││ EXPEDIENTE ││ CRM /       │
│  COMERCIAL   ││ CONVERSAC.  ││             ││            ││ HANDOFF     │
│  (Supporting)││ (Supporting)││ (Generic)   ││ (Generic)  ││ (Supporting)│
│              ││             ││             ││            ││             │
│ Modelo       ││ Extracao    ││ MensagemRecb││ Expediente ││ Departamento│
│ Preco        ││ Resposta    ││ MensagemEnv ││ Feriado    ││ ResumoLead  │
│ FormaPagto   ││ Transcricao ││ Canal       ││ Plantao    ││ Oportunidade│
│ Loja         ││ Visao       ││ Idempotencia││            ││             │
└──────────────┘└─────────────┘└─────────────┘└────────────┘└─────────────┘
```

### Relações entre contextos

| De → Para | Padrão | Observação |
|---|---|---|
| Atendimento → Catálogo | **Conformist** | O catálogo é dado de negócio estável; o core consome como está. |
| Atendimento → Inteligência | **Anti-Corruption Layer** | O core define `Extrator` e `Redator` como portas; OpenAI fica fora. |
| Atendimento → Mensageria | **ACL** | O payload do ChatClean (3 formatos!) nunca entra no core. |
| Atendimento → CRM | **Open Host / evento** | O transbordo publica um evento; o adapter traduz para nota + push + oportunidade. |
| Atendimento → Expediente | **Shared Kernel leve** | `Expediente` é VO consultado no momento do transbordo. |

**Core domain** = Atendimento. É onde vale investir em modelagem rica, testes e evals. Os demais
existem para servi-lo e devem ficar atrás de portas finas.

---

## Agregado raiz: `Atendimento`

Limite de consistência transacional. Uma mensagem = uma transação sobre um `Atendimento`.

```
Atendimento (AR)
├── id: ChatId                      (VO — telefone normalizado, núcleo canônico p/ comparação)
├── contatoCrmId: ContactId | null
├── nomeContato: string | null
├── qualificacao: Qualificacao      (entidade)
│   ├── finalidade, transporteAtual, gastoMensal, situacaoMoto
│   ├── modeloInteresse: ModeloId | null
│   ├── formaPagamento: FormaPagamento | null
│   └── loja: LojaId | null
├── dadosSimulacao: DadosSimulacao  (VO — nomeCompleto, Cpf, dataNascimento, Telefone, cnh, corModelo)
├── perfil: Perfil | null           (VO)
├── historico: HistoricoConversa    (entidade — turnos, capacidade 100)
├── estado: EstadoAtendimento       (VO enum)
├── controleDeLoop: ControleDeLoop  (VO — janela de turnos, últimas mensagens)
├── ultimaInteracao: Instante
└── reativacao: Reativacao | null   (VO — vencimento + última mensagem enviada)
```

### Máquina de estados

```
                 primeira mensagem
       (novo) ─────────────────────> ACOLHENDO
                                        │ finalidade coletada
                                        ▼
                                   DIAGNOSTICANDO <── bloqueia produto (RN-001)
                                        │ transporte + gasto + situação
                                        ▼
                                    RECOMENDANDO
                                        │ modelo + pagamento
                                        ▼
                                    FECHANDO
                                        │ loja identificada (RN-040)
                                        ▼
    ┌── pediu humano ──> TRANSFERIDO <──┘
    │   cliente atual ──> TRANSFERIDO (pós-venda)
    │
    └── loop detectado ──> PAUSADO ──(normalizou)──> volta ao estado anterior

   TRANSFERIDO ──nova mensagem──> TRANSFERIDO (responde dúvida pontual, UC-010)
   qualquer ──24h sem interação──> (descartado; próximo contato nasce novo)
```

**Hoje isso é implícito** — combinação de `qualificacaoCompleta`, `finalizado`, `loopAvisado` e campos
vazios. Tornar explícito é uma das fatias da refatoração (Fase 4).

### Invariantes do agregado

| # | Invariante | Regra |
|---|---|---|
| I1 | Só sai de `DIAGNOSTICANDO` com transporte + gasto + situação preenchidos | RN-001 |
| I2 | Só transfere por qualificação com `loja` definida | RN-040 |
| I3 | `TRANSFERIDO` não volta ao funil e não agenda reativação | RN-044, RN-070 |
| I4 | Fatos do diagnóstico só mudam por correção explícita | RN-003 |
| I5 | O histórico nunca passa de 100 turnos | — |
| I6 | Um atendimento nunca é processado concorrentemente | RN-056 |

### Métodos de domínio (comportamento, não getters)

```
atendimento.registrarTurnoDoCliente(mensagem, instante)
atendimento.aplicarExtracao(extracao)          // RN-003
atendimento.proximaEtapa(): EtapaDoFunil       // PURO — sem efeito colateral (corrige o legado)
atendimento.podeRevelarProduto(): boolean      // RN-001
atendimento.exigeTransbordo(): MotivoTransbordo | null
atendimento.transferir(departamento, expediente): TransbordoSolicitado  // evento
atendimento.registrarRespostaDoBot(texto)
atendimento.agendarReativacao(instante)
atendimento.detectarLoop(instante): boolean    // RN-054
atendimento.expirouPorInatividade(instante): boolean  // RN-071
```

---

## Value Objects

| VO | Contexto | Regras encapsuladas |
|---|---|---|
| `ChatId` | Atendimento | Normalização de JID (`:24@s.whatsapp.net`), núcleo canônico ignorando o 9º dígito |
| `Telefone` | Shared | Formato BR, DDI/DDD |
| `Cpf` | Shared | Só dígitos; **mascarável** por padrão em log/resumo |
| `Dinheiro` | Shared | Centavos inteiros, formatação `R$ 11.390,00` |
| `GastoDeTransporte` | Atendimento | Texto do cliente + valor + periodicidade; sabe **projetar no ano** (o argumento da venda) |
| `Perfil` | Atendimento | Um dos 8; carrega o gancho de dor |
| `Objecao` | Atendimento | Uma das 9; carrega a resposta consultiva |
| `EtapaDoFunil` | Atendimento | Enum ordenado + instrução para o redator |
| `EstadoAtendimento` | Atendimento | Enum da máquina de estados |
| `ModeloId` | Catálogo | Só `AZ1`, `AZ125`, `AZX160` (RN-011) |
| `Preco` | Catálogo | Sempre "promocional, com emplacamento" (RN-012) |
| `LojaId` | Catálogo | `matriz`, `malvinas`, `monteiro` |
| `Departamento` | CRM | Derivado de `LojaId`; fallback `Comercial`; especial `Pós-venda` |
| `Expediente` | Expediente | `{ aberto, motivo, proximoExpediente }` |
| `Instante` | Shared | Wrapper de tempo — permite clock fake em teste |

> **Primitive obsession** é o smell dominante no legado: hoje tudo é `string` solta dentro de um
> objeto anônimo `leadData`. Cada VO acima elimina uma classe inteira de bug.

---

## Eventos de domínio

| Evento | Publicado quando | Assinantes |
|---|---|---|
| `AtendimentoIniciado` | Primeira mensagem de um contato novo | métricas |
| `DiagnosticoConcluido` | Transporte + gasto + situação preenchidos | métricas, evals |
| `ModeloRecomendado` | Bot recomenda um modelo | métricas |
| `ObjecaoDetectada` | Extração retorna objeção | métricas |
| `TransbordoSolicitado` | Qualificação completa / pedido de humano / cliente atual | CRM (nota + push equipe + histórico), pipeline de oportunidade |
| `LeadReativado` | Follow-up disparado | métricas |
| `LoopDetectado` | Blindagem anti-loop acionada | alerta para a equipe |
| `AtendimentoExpirado` | Reset por 24h de inatividade | métricas |

Publicar `TransbordoSolicitado` como evento é o que permite ligar o `pipeline.js` (oportunidade no
CRM) sem tocar no core — e desligar de novo sem risco.

---

## Portas (interfaces do domínio/aplicação)

### Saída (driven)
```
CanalDeMensagem        enviarTexto(chatId, texto) · enviarNotaInterna(chatId, texto)
RepositorioAtendimento buscar(chatId) · salvar(a) · remover(chatId) · listarIds()
                       adquirirLock(chatId, ttl) · liberarLock(chatId)
ExtratorDeInformacoes  extrair(mensagem, etapa, historico): Extracao
RedatorDeResposta      redigir(contexto): string
TranscritorDeAudio     transcrever(buffer, mimetype): string
LeitorDeImagem         descrever(url): string
RelogioDeExpediente    consultar(instante): Expediente
NotificadorDeEquipe    notificar(resumo, departamento)
CatalogoDeProdutos     modelos() · loja(id) · formasDePagamento()
RegistroDeLeads        registrar(leadFinalizado)
Relogio                agora(): Instante
```

### Entrada (driving)
```
ProcessarMensagemRecebida   (UC-001, 009, 011, 015, 016)
TransferirParaConsultor     (UC-005, 006, 007)
ReativarAtendimentoInativo  (UC-012)
ResponderAposTransbordo     (UC-010)
ResetarAtendimento          (UC-014)
ConsultarDiagnosticoDoServico (UC-017)
```

Com essas portas, `test-chat.js` e `sim-lead.js` deixam de reimplementar o turno: passam a chamar
`ProcessarMensagemRecebida` com adapters de terminal. Isso mata a dívida D-04.

---

## Serviços de domínio (lógica que não pertence a uma entidade só)

| Serviço | Responsabilidade |
|---|---|
| `PoliticaDeDiagnostico` | Decide se pode revelar produto (RN-001) |
| `PoliticaDeTransbordo` | Decide se/para onde transferir (RN-040, RN-041, RN-042) |
| `ClassificadorDePerfil` | Texto → `Perfil` (RN-005) |
| `CalculadoraDeEconomia` | Gasto declarado → projeção anual (o número que sustenta a venda) |
| `MontadorDeResumo` | `Atendimento` → resumo estruturado do transbordo (RN-043) |

`CalculadoraDeEconomia` **não existe hoje** — a conta anual é delegada ao LLM, que pode errar
aritmética. Trazê-la para o domínio é uma melhoria de negócio real, não só de arquitetura.
