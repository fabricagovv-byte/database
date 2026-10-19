#!/usr/bin/env node
/* Imita o Claude Code em modo -p --output-format stream-json, para os testes.
   Na fábrica (permission-mode acceptEdits) escreve um sistema mínimo na pasta atual. */
const fs = require('fs');
const path = require('path');
let entrada = '';
process.stdin.on('data', d => { entrada += d; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const modo = args[args.indexOf('--permission-mode') + 1];
  const linha = o => process.stdout.write(JSON.stringify(o) + '\n');
  linha({ type: 'system', subtype: 'init', session_id: 'sessao-teste' });
  let result;
  if (modo === 'acceptEdits') {
    const porta = (entrada.match(/padrão (\d+)/) || [])[1] || '4501';
    linha({ type: 'assistant', session_id: 'sessao-teste', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'server.js' } }] } });
    fs.mkdirSync('tests', { recursive: true });
    fs.writeFileSync('server.js', `const http = require('http');\nconst s = http.createServer((q, r) => r.end('<h1>Protocolo</h1>'));\nif (require.main === module) s.listen(process.env.PORT || ${porta}, '127.0.0.1');\nmodule.exports = s;\n`);
    fs.writeFileSync('v4.json', JSON.stringify({ nome: 'Protocolo Digital', descricao: 'teste', comando: 'node', args: ['server.js'], porta: Number(porta), abre: '/' }));
    fs.writeFileSync(path.join('tests', 'app.test.js'), `const test = require('node:test'); const assert = require('assert');\ntest('soma', () => assert.strictEqual(1 + 1, 2));\n`);
    fs.writeFileSync('RELATORIO.md', '# Relatório\n\n| Atividade | UST |\n| --- | ---: |\n| Tudo | 42 |\n');
    fs.writeFileSync('README.md', '# Protocolo Digital\n');
    result = JSON.stringify({ resumo: 'Sistema de protocolo entregue.', funcionalidades: ['cadastro'], ust: 42, pendencias: [] });
  } else if (/Helena/.test(entrada) && modo === 'dontAsk' && args.includes('--disallowedTools')) {
    result = '```json\n' + JSON.stringify({ parecer: 'disputar', resumo: 'Objeto aderente.', exigencias: ['atestado'], riscos: [], prazos: [], estimativaUST: 300, equipeSugerida: [], perguntasEsclarecimento: [] }) + '\n```';
  } else {
    result = 'Assunto: Apresentação V4\n\nPrezados, ...';
  }
  linha({ type: 'result', subtype: 'success', is_error: false, result, session_id: 'sessao-teste', total_cost_usd: 0.01, duration_ms: 5 });
});
