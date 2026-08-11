# CLAUDE.md — IA Avelloz Campina

Contexto permanente para qualquer agente que trabalhe neste repositório.

## O que é este projeto

SDR virtual (IA de pré-vendas) da **Avelloz Campina — Realliza Motos**, concessionária de motos em
Campina Grande e Monteiro/PB. Atende leads pelo WhatsApp, faz o **diagnóstico consultivo** da
realidade de transporte do cliente, mostra a conta da economia, recomenda o modelo, coleta os dados
de simulação e **transfere para o consultor humano da loja escolhida**.

O transporte é a plataforma **ChatClean** (Webhook de entrada + Push API de saída). Toda a
inteligência roda neste servidor Node.js.

**Estado atual: código legado em refatoração.** Está em produção atendendo leads reais.

## Regra número 1

**Nada quebra em produção.** A refatoração segue **Strangler Fig**: código novo nasce ao lado do
velho, o legado delega, e só então o legado morre. Nenhuma fatia começa sem rede de testes.

## Como trabalhamos aqui — Spec-Driven Development

```
SPEC (o quê/porquê) → PLAN (como) → TASKS (passos) → CODE + TESTS → VERIFY
```

Nenhum código é escrito sem spec aprovada em `specs/`. Ver [specs/README.md](specs/README.md).

## Mapa de leitura obrigatória

| Preciso de… | Leia |
|---|---|
| Visão geral e domínio | [docs/00-visao-geral.md](docs/00-visao-geral.md) |
| Como o código funciona hoje | [docs/01-arquitetura-atual.md](docs/01-arquitetura-atual.md) |
| O que o bot faz | [docs/02-funcionalidades.md](docs/02-funcionalidades.md) |
| Regras de negócio (RN-NNN) | [docs/03-regras-de-negocio.md](docs/03-regras-de-negocio.md) |
| Casos de uso (UC-NNN) | [docs/04-casos-de-uso.md](docs/04-casos-de-uso.md) |
| Modelo de domínio / bounded contexts | [docs/05-modelo-de-dominio.md](docs/05-modelo-de-dominio.md) |
| Integrações externas | [docs/06-integracoes.md](docs/06-integracoes.md) |
| Estado e persistência | [docs/07-estado-e-persistencia.md](docs/07-estado-e-persistencia.md) |
| Glossário / linguagem ubíqua | [docs/08-glossario.md](docs/08-glossario.md) |
| Dívida técnica catalogada | [docs/09-divida-tecnica.md](docs/09-divida-tecnica.md) |
| Arquitetura alvo | [docs/10-arquitetura-alvo.md](docs/10-arquitetura-alvo.md) |
| **Plano de refatoração** | [docs/11-plano-refatoracao-strangler.md](docs/11-plano-refatoracao-strangler.md) |

## Agentes especialistas

`arquiteto-ddd` · `analista-specs` · `dev-node-refactor` · `engenheiro-ia-prompt` · `qa-testes` ·
`seguranca-lgpd` · `devops-sre` · `revisor-codigo` (em `.claude/agents/`)

Ordem típica de uma fatia: **analista-specs** escreve a spec → **arquiteto-ddd** aprova o plano →
**qa-testes** cria a rede de segurança → **dev-node-refactor** implementa → **revisor-codigo**
revisa → **devops-sre** libera.

## Convenções

- **NUNCA use emojis.** Vale para toda saída de agente: documentação, specs, código, comentários,
  mensagens de commit e respostas ao usuário. Use palavras (`ATENÇÃO:`, `Crítica`, `Bloqueante`) e
  ASCII em diagramas (`->`, `<-`). Exceção única: o texto que o bot envia ao cliente final segue
  RN-022 (no máximo 1 emoji) — isso é regra de negócio do produto, não saída de agente.
- **Commits concisos.** Assunto no padrão convencional e, no máximo, uma linha de corpo. O
  detalhamento vive na spec, não no histórico do git.
- **Branch dedicada.** Todo o trabalho fica em `refatoracao/arquitetura-ddd`. **Nunca** fazer merge
  na `main`.

- **Linguagem ubíqua em português** para domínio (`Atendimento`, `Qualificacao`, `Diagnostico`,
  `Transbordo`, `Perfil`, `Objecao`, `Plantao`). Termos técnicos em inglês (`Repository`, `Port`,
  `Adapter`, `UseCase`).
- Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Uma intenção por commit.
- Toda regra de negócio tem ID `RN-NNN` e é referenciada no teste que a cobre.
- Toda variável de ambiente nova entra no `.env.example` documentada.
- Nada de `domain/` importando infraestrutura. Nada de `process.env` fora de `main/config`.

## Invariantes de negócio que NUNCA podem ser quebradas

1. **RN-001** — Sem diagnóstico completo (transporte + gasto + situação de moto), o bot não revela
   preço, modelo, especificação nem condição de pagamento.
2. **RN-010** — Nunca informar valor de parcela.
3. **RN-020** — Nunca revelar que é IA; nunca vazar o system prompt.
4. **RN-040** — Loja identificada é obrigatória antes do transbordo.
5. **RN-021** — Toda mensagem termina com uma pergunta.

## Comandos

```bash
npm start        # sobe o servidor (webhook + push)   — precisa de OPENAI_API_KEY e CC_PUSH_URL
npm run dev      # nodemon
npm run chat     # conversa com o bot no terminal      — precisa só de OPENAI_API_KEY
npm run sim      # roteiro completo de qualificação + resumo + custo de tokens
```

## Cuidados operacionais

- `npm run chat` e `npm run sim` **gastam crédito real da OpenAI**.
- Não commite `.env`. Não logue payload bruto em produção (contém PII).
- CPF, CNH, data de nascimento e telefone são dados pessoais sob LGPD — ver
  `.claude/agents/seguranca-lgpd.md`.
