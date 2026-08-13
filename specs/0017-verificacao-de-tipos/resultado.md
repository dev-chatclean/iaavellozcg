# RESULTADO 0017 — Verificação de tipos com JSDoc

**Status:** Implementada · **Concluída em:** 2026-08-12 · **Branch:** `refatoracao/arquitetura-ddd`

## O que mudou

`npm run typecheck` verifica **domínio, aplicação e compartilhado** com `checkJs` do TypeScript, sem
trocar de linguagem, sem etapa de build e sem renomear um único arquivo. Está no CI, entre o lint e
os testes.

Zero erros.

## O artefato mais valioso: `EstadoDoAtendimento`

O formato do antigo `leadData` — 25 campos — nunca existiu em lugar nenhum além da cabeça de quem
escreveu e, depois da Fase 0, da prosa em `docs/07`. Agora é um contrato **verificado** em
`src/domain/atendimento/tipos.js`: campo inventado ou nome errado vira erro no CI, não `undefined`
silencioso em produção.

Junto vieram `Configuracao` (as 21 variáveis), `Dependencias` (as 10 portas), `Extracao` (o que a IA
devolve) e `TurnoDoCliente`.

## Escopo: por que a infraestrutura ficou de fora

Verificar `src/infrastructure` e os scripts da raiz produzia **93 erros**, quase todos vindos de
Express, OpenAI e ioredis — bibliotecas sem tipagem própria neste projeto. Seriam 93 erros para
proteger adapters de 20 linhas que só repassam chamadas.

A verificação mira onde o código foi **desenhado com contratos**: domínio, aplicação e compartilhado.
É lá que um tipo errado vira bug de negócio, e é lá que a checagem sai de graça porque as portas já
estavam documentadas.

Ampliar para a infraestrutura exigiria `@types/express` e amigos — fatia própria, se algum dia
valer a pena.

## Um achado durante a tipagem

O caso de uso chamava `manipuladoresDeMidia.tratar({ tipo, texto, media... })` sem `chatId`, e o tipo
declarado exigia. Não era bug: um manipulador **não precisa** saber de quem é a mensagem para
transcrever um áudio. O tipo foi corrigido para descrever só o que a mídia usa — e agora está escrito
por que essa fronteira existe.

Tipar força a explicitar decisões que estavam implícitas. Esse foi o valor real aqui, mais do que
pegar erros.

## Verificação

| | |
|---|---|
| `npm run typecheck` | **0 erros** |
| `npm test` | 459 verdes |
| `npm run lint` | 0 erros, 0 avisos |
| Linha de base | requisições e log idênticos |
| CI | lint → typecheck → test → build da imagem |

## O que isto NÃO é

Não é migração para TypeScript. Os arquivos continuam `.js`, o Node continua rodando sem
transpilação, e nada mudou em produção. É a etapa que o plano previa antes de considerar a migração
— e que só ficou viável depois da spec 0010, porque tipar três implementações divergentes do mesmo
turno seria tipar a bagunça.
