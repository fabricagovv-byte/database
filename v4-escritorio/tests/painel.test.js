/* Testes do Painel V4 — rodar com: node --test tests/
   Sobe o escritório numa pasta temporária, com PNCP, BrasilAPI e IBGE
   falsos e um "claude" falso (tests/fixtures/claude-falso.js).          */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
let TMP, servidor, api, PORTA, procEsc;

/* ---------- APIs públicas falsas ---------- */
const registro = (seq, objeto, valor, uf, esfera, mun) => ({
  numeroControlePNCP: `0000000000019${seq}-1-00000${seq}/2026`, anoCompra: 2026, sequencialCompra: seq, numeroCompra: String(seq) + '/2026',
  orgaoEntidade: { cnpj: '1871538300014' + seq, razaoSocial: 'MUNICIPIO DE ' + mun.toUpperCase(), esferaId: esfera },
  unidadeOrgao: { ufSigla: uf, municipioNome: mun, codigoIbge: '310000' + seq, nomeUnidade: 'Prefeitura' },
  modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico', modoDisputaNome: 'Aberto', objetoCompra: objeto,
  valorTotalEstimado: valor, srp: false, dataPublicacaoPncp: '2026-10-18T10:00:00',
  dataAberturaProposta: '2026-10-19T08:00:00', dataEncerramentoProposta: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 19),
  situacaoCompraNome: 'Divulgada no PNCP', amparoLegal: { nome: 'Lei 14.133/2021, Art. 28, I' }, linkSistemaOrigem: 'https://exemplo.gov.br'
});
const PNCP = [
  registro(1, 'Contratação de empresa para desenvolvimento de software e sustentação de sistemas, medido em UST', 850000, 'MG', 'M', 'Uberaba'),
  registro(2, 'Aquisição de medicamentos hospitalares', 120000, 'MG', 'M', 'Contagem'),
  registro(3, 'Licença de uso de software de gestão escolar com implantação e prova de conceito', 230000, 'SP', 'M', 'Campinas')
];

function apiFalsa() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const j = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (u.pathname === '/api/consulta/v1/contratacoes/proposta' || u.pathname === '/api/consulta/v1/contratacoes/publicacao') {
      const uf = u.searchParams.get('uf');
      const dados = PNCP.filter(r => !uf || r.unidadeOrgao.ufSigla === uf);
      return j({ data: dados, totalRegistros: dados.length, totalPaginas: 1, numeroPagina: 1 });
    }
    if (/\/itens$/.test(u.pathname)) return j([{ numeroItem: 1, descricao: 'Serviços de desenvolvimento em UST', quantidade: 10000, unidadeMedida: 'UST', valorUnitarioEstimado: 85, valorTotal: 850000 }]);
    if (/\/arquivos$/.test(u.pathname)) return j([{ titulo: 'Edital', tipoDocumentoNome: 'Edital', url: 'https://pncp.gov.br/x/edital.pdf', statusAtivo: true }]);
    if (u.pathname.startsWith('/api/cnpj/v1/')) return j({ razao_social: 'MUNICIPIO DE UBERABA', email: 'COMPRAS@UBERABA.MG.GOV.BR', ddd_telefone_1: '3433180000', municipio: 'UBERABA', uf: 'MG', logradouro: 'PRACA RUI BARBOSA', numero: '1' });
    if (u.pathname === '/api/v1/localidades/estados/MG/municipios') return j([{ id: 3170107, nome: 'Uberaba' }, { id: 3118601, nome: 'Contagem' }]);
    res.writeHead(404); res.end('[]');
  });
}

/* ---------- cliente ---------- */
function pedir(metodo, rota, corpo, cru) {
  return new Promise((resolve, reject) => {
    const dados = corpo == null ? null : (Buffer.isBuffer(corpo) ? corpo : Buffer.from(JSON.stringify(corpo)));
    const req = http.request({ host: '127.0.0.1', port: PORTA, path: rota, method: metodo,
      headers: Object.assign(dados ? { 'Content-Length': dados.length } : {}, cru || {}) }, res => {
      const p = []; res.on('data', c => p.push(c));
      res.on('end', () => { const b = Buffer.concat(p); let js = null; try { js = JSON.parse(b.toString()); } catch (e) {} resolve({ code: res.statusCode, json: js, buf: b, headers: res.headers }); });
    });
    req.on('error', reject); if (dados) req.write(dados); req.end();
  });
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function concluir(rotaTarefa) {
  for (let i = 0; i < 200; i++) {
    const t = (await pedir('GET', '/api/painel/tarefas/' + rotaTarefa)).json;
    if (t.status !== 'rodando') return t;
    await esperar(100);
  }
  throw new Error('tarefa não terminou');
}

test.before(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-painel-'));
  for (const f of ['server.js', 'reuniao.js', 'avisos.js', 'painel', 'painel.html', 'exemplo-agente', 'data/sistemas.exemplo.json', 'data/config.exemplo.json'])
    fs.cpSync(path.join(RAIZ, f), path.join(TMP, f), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'data', 'equipe.json'), JSON.stringify({ team: [
    { id: 'boss-1', name: 'Arthur Miguel', boss: true, dept: 'diretoria' },
    { id: 'ag-techlead', key: 'techlead', name: 'Marina', role: 'Tech Lead', dept: 'servico' },
    { id: 'ag-frontend', key: 'frontend', name: 'Lucas', role: 'Front-end', dept: 'servico' },
    { id: 'ag-node', key: 'node', name: 'Beatriz', role: 'Node', dept: 'servico' },
    { id: 'ag-qa', key: 'qa', name: 'Dan', role: 'QA', dept: 'servico' }] }));
  api = apiFalsa(); await new Promise(r => api.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + api.address().port;
  const livre = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  PORTA = livre;
  procEsc = spawn(process.execPath, ['server.js'], { cwd: TMP, stdio: 'ignore', env: Object.assign({}, process.env, {
    PORT: String(PORTA), V4_PNCP_BASE: base, V4_BRASILAPI_BASE: base, V4_IBGE_BASE: base,
    V4_CLAUDE_BIN: path.join(__dirname, 'fixtures', 'claude-falso.js') }) });
  for (let i = 0; i < 100; i++) { try { if ((await pedir('GET', '/api/painel/resumo')).code === 200) return; } catch (e) {} await esperar(100); }
  throw new Error('escritório não subiu');
});
test.after(() => { try { procEsc.kill(); } catch (e) {} api.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('busca no PNCP pontua aderência e filtra o que não é software', async () => {
  const { json } = await pedir('POST', '/api/painel/licitacoes/buscar', { modo: 'abertas', modalidades: [6], ufs: ['MG', 'SP'], notaMin: 20 });
  const t = await concluir(json.tarefa);
  assert.strictEqual(t.status, 'ok', t.erro);
  const u = (await pedir('GET', '/api/painel/licitacoes/ultima')).json;
  assert.strictEqual(u.total, 2);
  assert.ok(u.itens[0].objeto.includes('desenvolvimento de software'));
  assert.ok(u.itens[0].nota >= 60);
  assert.ok(u.itens.every(l => !/medicamentos/.test(l.objeto)));
  assert.match(u.itens[0].link, /^https:\/\/pncp\.gov\.br\/app\/editais\//);
});

test('carteira, status e análise com parecer da IA', async () => {
  const u = (await pedir('GET', '/api/painel/licitacoes/ultima')).json;
  const id = u.itens[0].id;
  assert.strictEqual((await pedir('POST', '/api/painel/licitacoes/salvar', { id })).code, 200);
  const a = (await pedir('POST', '/api/painel/licitacoes/atualizar', { id, status: 'vamos disputar', notas: 'prioridade' })).json;
  assert.strictEqual(a.status, 'vamos disputar');
  const t = await concluir((await pedir('POST', '/api/painel/licitacoes/analisar', { id, ia: true })).json.tarefa);
  assert.strictEqual(t.status, 'ok', t.erro);
  assert.strictEqual(t.resultado.analise.totalItens, 1);
  assert.strictEqual(t.resultado.analise.ia.parecer, 'disputar');
  assert.ok(t.resultado.analise.sinais.some(s => /UST/.test(s)));
  const csv = (await pedir('GET', '/api/painel/licitacoes/exportar.csv')).buf.toString();
  assert.match(csv, /Uberaba/);
});

test('comercial: contato institucional pela Receita, IBGE e prefeitos do TSE', async () => {
  const t = await concluir((await pedir('POST', '/api/painel/comercial/importar-editais', { limite: 5 })).json.tarefa);
  assert.strictEqual(t.status, 'ok', t.erro);
  let c = (await pedir('GET', '/api/painel/comercial?comEmail=1')).json.itens;
  assert.ok(c.some(x => x.email === 'compras@uberaba.mg.gov.br'));
  assert.strictEqual((await concluir((await pedir('POST', '/api/painel/comercial/municipios', { uf: 'MG' })).json.tarefa)).status, 'ok');
  const tse = Buffer.from('"SG_UF";"NM_UE";"DS_CARGO";"NM_CANDIDATO";"NM_URNA_CANDIDATO";"SG_PARTIDO";"DS_SIT_TOT_TURNO"\n"MG";"CONTAGEM";"PREFEITO";"FULANA DE TAL";"FULANA";"XYZ";"ELEITO"\n"MG";"CONTAGEM";"PREFEITO";"BELTRANO";"BELTRANO";"ABC";"NÃO ELEITO"\n', 'latin1');
  const r = (await pedir('POST', '/api/painel/comercial/tse', tse, { 'Content-Type': 'application/octet-stream' })).json;
  assert.strictEqual(r.prefeitos, 1);
  c = (await pedir('GET', '/api/painel/comercial?uf=MG&tipo=prefeitura&q=contagem')).json.itens;
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].prefeito, 'FULANA');
});

test('WhatsApp: recusa sem assinatura, aceita com assinatura e o robô responde', async () => {
  await pedir('PUT', '/api/painel/whatsapp', { ativo: false, appSecret: 'segredo', verifyToken: 'v', autorizados: '5534999990000' });
  const corpo = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '5534999990000', type: 'text', text: { body: 'licitacoes' } }] } }] }] }));
  assert.strictEqual((await pedir('POST', '/webhook/whatsapp', corpo, { 'X-Hub-Signature-256': 'sha256=errada' })).code, 401);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(corpo).digest('hex');
  assert.strictEqual((await pedir('POST', '/webhook/whatsapp', corpo, { 'X-Hub-Signature-256': sig, Host: 'meu-tunel.exemplo.com' })).code, 200);
  const v = await pedir('GET', '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=v&hub.challenge=123');
  assert.strictEqual(v.buf.toString(), '123');
  await esperar(150);
  const log = (await pedir('GET', '/api/painel/whatsapp')).json.log;
  assert.ok(log.some(m => m.dir === 'entrou' && m.autorizado));
  const s = (await pedir('POST', '/api/painel/whatsapp/simular', { texto: 'licitacoes' })).json.resposta;
  assert.match(s, /Uberaba/);
});

test('fábrica: pedido vira sistema com código, relatório, testes e registro no escritório', async () => {
  const p = (await pedir('POST', '/api/painel/fabrica', { nome: 'Protocolo Digital', pedido: 'Sistema web de protocolo de documentos com cadastro e consulta para a prefeitura' })).json;
  assert.ok(p.squad.some(s => s.nome === 'Marina'));
  let d;
  for (let i = 0; i < 100; i++) { d = (await pedir('GET', '/api/painel/fabrica/' + p.id)).json; if (!['na fila', 'gerando'].includes(d.status)) break; await esperar(100); }
  assert.strictEqual(d.status, 'pronto', d.erro);
  assert.strictEqual(d.ust, 42);
  assert.match(d.relatorio, /UST/);
  assert.ok(d.arvore.includes('server.js'));
  assert.ok(d.sistemaId);
  const z = (await pedir('GET', '/api/painel/fabrica/' + p.id + '/zip')).buf;
  assert.strictEqual(z.slice(0, 2).toString(), 'PK');
  const t = await concluir((await pedir('POST', '/api/painel/fabrica/' + p.id + '/testes', {})).json.tarefa);
  assert.strictEqual(t.resultado.ok, true, t.resultado.saida);
  const sis = (await pedir('GET', '/api/sistemas')).json;
  assert.ok(sis.some(s => s.id === d.sistemaId));
  const eq = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'equipe.json'), 'utf8')).team;
  assert.strictEqual(eq.find(a => a.name === 'Marina').sistema, d.sistemaId);
});

test('UST: teto, distribuição pelo time e relatório; financeiro com saldo', async () => {
  const c = (await pedir('POST', '/api/painel/ust/contrato', { nome: 'Uberaba', tetoUST: 100, valorUST: '90,00' })).json;
  await pedir('POST', '/api/painel/ust/importar-fabrica', { contratoId: c.id });
  await pedir('POST', '/api/painel/ust/demanda', { contratoId: c.id, titulo: 'BI', ust: 70, prioridade: 2 });
  await pedir('POST', '/api/painel/ust/demanda', { contratoId: c.id, titulo: 'Ajuste pequeno', ust: 50, prioridade: 3 });
  const r = (await pedir('GET', '/api/painel/ust/distribuir?contrato=' + c.id)).json;
  assert.strictEqual(r.usado, 92);                     // 42 da fábrica + 50; o BI (70) não cabe
  assert.strictEqual(r.falta, 8);
  assert.deepStrictEqual(r.fora.map(x => x.titulo), ['BI']);
  assert.ok(r.porAgente.length > 0);
  assert.match((await pedir('GET', '/api/painel/ust/relatorio.md?contrato=' + c.id)).buf.toString(), /Relatório de UST/);
  await pedir('POST', '/api/painel/financeiro', { tipo: 'receita', valor: '1.000,00', data: '2026-10-01' });
  await pedir('POST', '/api/painel/financeiro', { tipo: 'despesa', valor: 300, data: '2026-10-02', situacao: 'previsto' });
  const f = (await pedir('GET', '/api/painel/financeiro')).json.resumo;
  assert.strictEqual(f.saldo, 1000);
  assert.strictEqual(f.saldoProjetado, 700);
});

test('API do painel recusa host de fora', async () => {
  assert.strictEqual((await pedir('GET', '/api/painel/resumo', null, { Host: 'evil.com' })).code, 403);
});

test('cada sala tem seu sistema no registro do escritório', async () => {
  const sis = (await pedir('GET', '/api/sistemas')).json;
  for (const id of ['v4-diretoria', 'v4-licitacoes', 'v4-fabrica', 'v4-comercial', 'v4-whatsapp', 'v4-financeiro', 'v4-ust']) {
    const s = sis.find(x => x.id === id);
    assert.ok(s, id + ' não está no registro');
    assert.strictEqual(s.estado, 'web');
    assert.match(s.url, /^painel\.html#/);
  }
  const pag = await pedir('GET', '/painel.html');
  assert.strictEqual(pag.code, 200);
  assert.match(pag.buf.toString(), /painel-demo\.js/);
});

test('modo demonstração responde as telas sem servidor', async () => {
  const vm = require('vm');
  const ctx = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, URL, Date, Math, JSON, Object, Number, String, Array, Map, Promise, Error, RegExp };
  vm.runInNewContext(fs.readFileSync(path.join(RAIZ, 'js', 'painel-demo.js'), 'utf8'), ctx);
  const D = ctx.window.PAINEL_DEMO;
  const r = await D.chamar('GET', '/resumo');
  assert.ok(r.licitacoes.carteira >= 1 && r.fabrica.total >= 1);
  const ust = (await D.chamar('GET', '/ust')).contratos[0];
  const dist = await D.chamar('GET', '/ust/distribuir?contrato=' + ust.id);
  assert.ok(dist.usado <= dist.teto);
  assert.match((await D.chamar('POST', '/whatsapp/simular', { texto: 'caixa' })).resposta, /Saldo/);
  const p = await D.chamar('POST', '/fabrica', { nome: 'Teste', pedido: 'sistema de agendamento de consultas' });
  assert.strictEqual(p.status, 'gerando');
  await assert.rejects(D.chamar('POST', '/comercial/cnpj', { cnpj: '1' }), /npm start/);
});
