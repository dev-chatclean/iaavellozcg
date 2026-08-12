# RESULTADO 0006 — Domínio do atendimento

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

As regras de negócio saíram de dentro do código de infraestrutura e do texto dos prompts, e ganharam
nome, arquivo e teste próprio.

```
src/domain/atendimento/
  EtapaDoFunil.js                      RN-002  ordem oficial + instrução por etapa
  Qualificacao.js                      RN-003  política de sobrescrita de campos
  Perfil.js                            RN-005  classificação da dor, com precedência
  MontadorDeResumo.js                  RN-043  o que o vendedor recebe no transbordo
  politicas/
    PoliticaDeDiagnostico.js           RN-001  o bloqueio mais importante do produto
    PoliticaDeTransbordo.js            RN-040, RN-041, RN-042, RN-061
```

`flow.js` virou fachada de 51 linhas (eram 73 de lógica). `prompts.js` e `index.js` passaram a
consultar o domínio.

## RN-001 finalmente tem casa

A regra que sustenta a metodologia comercial inteira — não revelar preço antes do diagnóstico —
vivia em **dois lugares ao mesmo tempo**: no texto do `SYSTEM_SDR` e numa expressão booleana solta no
meio de `promptResposta`:

```js
const diagnosticoCompleto = !!(leadData.transporteAtual && leadData.gastoMensal && leadData.situacaoMoto);
```

Agora é `PoliticaDeDiagnostico.podeRevelarProduto(campos)`, com nome, seis testes próprios e um lugar
só para mudar. O texto do prompt continua dizendo a regra ao modelo — isso é instrução, não
implementação.

## D-06: consulta pura no domínio, efeito colateral preservado na fachada

`EtapaDoFunil.proxima()` é **pura** — há teste afirmando que consultar não altera o objeto
consultado. Mas `flow.js` continua marcando `qualificacaoCompleta` ao consultar, como sempre fez:

```js
function determinarProximoCampo(leadData) {
    const etapa = EtapaDoFunil.proxima(leadData);
    if (etapa) return { campo: etapa.campo, pergunta: etapa.instrucao };
    leadData.qualificacaoCompleta = true; // efeito colateral herdado (D-06)
    return null;
}
```

Corrigir isso muda comportamento observável: hoje, montar uma mensagem de follow-up para um funil
completo marca o lead como qualificado. O teste que congela esse defeito continua verde. A correção
tem spec própria — não entra numa fatia estrutural.

O domínio já está limpo; só falta a fachada parar de sujar.

## Verificação

| | |
|---|---|
| Testes | **410** (eram 369) — 41 novos, exercitando o domínio sem o legado no meio |
| Cobertura do domínio novo | **100%** em statements, branches e funções |
| Cobertura global | 85,7% |
| Linha de base | Requisições **e** log do servidor idênticos |
| Lint | 0 erros, 4 avisos |
| `index.js` | 839 para **812 linhas** |
| `flow.js` | 73 para **51 linhas** (fachada) |

Os 41 testes novos alcançam regras que antes só eram testáveis montando o sistema inteiro: para
verificar RN-001 era preciso subir o turno completo com fakes e inspecionar o prompt gerado. Agora é
uma chamada de função.

## Decisão de projeto: o domínio depende de `data.js`

`MontadorDeResumo` e `PoliticaDeTransbordo` importam `data.js` (perfis, departamentos, mapeamento de
loja). `data.js` é conteúdo de negócio puro, sem I/O — é o futuro `domain/catalogo`, ainda na raiz.
A fronteira do lint proíbe infraestrutura no domínio, e `data.js` não é infraestrutura. Movê-lo é
fatia própria.

## Observação sobre cobertura dos adapters

`RedatorOpenAI` aparece com 37% e `BaixadorHttp` com 85%: os fakes das portas os substituem nos
testes, então o corpo real só roda em produção. É esperado nesta fase — a suíte de contrato hoje
cobre só o repositório. Ampliá-la para os adapters de LLM exigiria respostas gravadas, e entra junto
com os evals (spec 0011).
