# 00 — Visão Geral

## Contexto de negócio

A **Avelloz Campina — Realliza Motos** é uma concessionária da marca Avelloz com três unidades:
Matriz e Malvinas (Campina Grande/PB) e Monteiro (Monteiro/PB). Vende motos econômicas de baixa
cilindrada com **preço promocional já incluindo emplacamento** e forte apelo em facilidade de
pagamento (cartão em até 21x, financiamento com entrada zero em até 48x, consórcio, à vista).

O público-alvo não é o entusiasta de motos. É a pessoa que **gasta com transporte e não percebe**:
quem depende de Uber/99, quem pega ônibus lotado, quem roda de aplicativo com moto alugada, quem tem
carro e quer economizar no dia a dia, quem quer dar autonomia à esposa/família.

## O problema que o software resolve

Leads chegam pelo WhatsApp em volume, quase sempre com a mesma pergunta — *"quanto custa?"*. Responder
o preço direto mata a venda: o cliente compara com o concorrente e some. A metodologia comercial da
loja exige **diagnóstico antes de produto** — fazer o cliente dizer quanto gasta hoje, mostrar a conta
projetada no ano, e só então apresentar a moto certa como solução.

Fazer isso manualmente, em escala, não é viável. O SDR virtual executa essa metodologia 24/7, qualifica
o lead e entrega ao consultor humano **já aquecido, diagnosticado e com dados de simulação coletados**.

## Proposta de valor do sistema

| Para | Valor entregue |
|---|---|
| **Loja** | Lead chega ao vendedor já qualificado, com a dor mapeada e os dados de simulação prontos. |
| **Vendedor** | Não perde tempo com curioso; recebe resumo estruturado no ticket do CRM. |
| **Cliente** | Atendimento imediato, a qualquer hora, com tom humano e recomendação personalizada. |

## Como funciona (fluxo macro)

```
Cliente WhatsApp
      │
      ▼
ChatClean CRM ──── POST /webhook ────▶ Servidor Node.js (este projeto)
      ▲                                       │
      │                                       ├─▶ OpenAI: extração de campos (gpt-4o-mini, t=0)
      │                                       ├─▶ OpenAI: geração de resposta (gpt-4o-mini, t=0.7)
      │                                       ├─▶ OpenAI: Whisper (áudio/vídeo) e visão (gpt-4o)
      │                                       ├─▶ Redis: estado durável do atendimento
      │                                       │
      └──── POST CC_PUSH_URL ◀────────────────┘
            { number, body, externalKey }
```

O ChatClean é apenas **transporte**. Persona, metodologia de venda, tratamento de objeções, decisão de
transbordo e estado da conversa vivem aqui.

## Jornada do lead (o funil implementado)

```
1. ACOLHER            "conhece a Avelloz?"
2. INTERESSE          pra que quer a moto?
3. DIAGNÓSTICO  ◀── coração do produto, bloqueia tudo que vem depois
     3.1 como se locomove hoje
     3.2 quanto gasta por mês  (o cliente precisa DIZER o número)
     3.3 situação de moto (tem? própria? alugada? velha?)
4. DOR + CONTA        projeta o gasto no ano: "isso dá R$ X/ano"
5. RECOMENDAÇÃO       AZ1 (economia) / AZ125 (equilíbrio) / AZX160 (potência) + preço promocional
6. PAGAMENTO          cartão / financiamento / consórcio / à vista  (NUNCA valor de parcela)
7. DADOS SIMULAÇÃO    CPF, nascimento, nome completo, telefone, CNH, cor/modelo
8. LOJA (obrigatório) Matriz / Malvinas / Monteiro
9. TRANSBORDO         resumo no CRM + "Transferir para o departamento <Loja>"
```

## Catálogo (fonte: `data.js`)

| Modelo | Cilindrada | Preço promocional (com emplacamento) | Posicionamento |
|---|---|---|---|
| AZ1 | 50cc | R$ 11.390,00 | Economia máxima urbana (~40–50 km/L) |
| AZ125 | 125cc (Alfa) | R$ 14.190,00 | Equilíbrio, conforto, injeção eletrônica, CBS |
| AZX160 | 160cc | R$ 19.990,00 | Potência/trail, cidade e estrada |

## Restrições comerciais duras

- Não aceita moto usada na troca.
- Não faz test drive.
- Nunca promete prazo de entrega.
- CNH **não** é obrigatória para comprar.
- Nunca informa valor de parcela (só o consultor humano).

## Métricas do produto

- Leads qualificados / leads atendidos (taxa de qualificação)
- Transbordos por loja
- Tempo médio até o transbordo (nº de turnos)
- Taxa de vazamento de preço antes do diagnóstico (**deve ser 0%**)
- Custo OpenAI por lead qualificado

## Estado do repositório

Monólito procedural em Node.js/CommonJS, ~1.500 linhas úteis, **sem testes automatizados**, com regras
de negócio distribuídas entre `index.js`, `flow.js`, `data.js` e o texto do prompt em `prompts.js`.
A refatoração está descrita em [11-plano-refatoracao-strangler.md](11-plano-refatoracao-strangler.md).
