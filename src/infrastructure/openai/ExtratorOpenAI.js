// =============================================================
//  EXTRATOR — OpenAI (SPEC 0004)
//
//  Implementa a porta ExtratorDeInformacoes. Extraído de
//  index.js: extrairInformacoesComIA, sem alteração de comportamento:
//  mesmo modelo, mesma temperatura, mesmo response_format, mesma limpeza de
//  crases e o mesmo `null` em caso de falha.
// =============================================================

const { promptExtracao } = require('../../../prompts');

const MODELO = 'gpt-4o-mini';

function criar({ cliente }) {
    return {
        async extrair(mensagem, campoAtual, historicoRecente = []) {
            try {
                const mensagemSanitizada = mensagem.replace(/[<>]/g, '').substring(0, 1000);
                const prompt = promptExtracao({ mensagemSanitizada, campoAtual });
                const completion = await cliente.chat.completions.create({
                    model: MODELO,
                    messages: [...historicoRecente, { role: 'user', content: prompt }],
                    temperature: 0,
                    response_format: { type: 'json_object' } // garante JSON válido (o prompt já pede JSON)
                });
                let res = completion.choices[0].message.content.trim();
                if (res.includes('```')) res = res.replace(/```json?/g, '').replace(/```/g, '').trim();
                return JSON.parse(res);
            } catch (e) {
                console.error('Erro ao extrair informações:', e.message);
                return null;
            }
        }
    };
}

module.exports = { criar };
