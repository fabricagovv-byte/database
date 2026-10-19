/* ===========================================================
   painel/financeiro.js — as finanças da V4, lançadas por você

   Lançamento: data, descrição, tipo (receita/despesa), categoria, valor,
   situação (realizado/previsto), contrato/projeto. Importa e exporta CSV.
   =========================================================== */
const U = require('./util');

const CATEGORIAS = {
  receita: ['Contrato público', 'Sustentação', 'Licença/SaaS', 'Consultoria', 'Outras receitas'],
  despesa: ['Folha e pró-labore', 'Impostos', 'Infraestrutura/nuvem', 'Ferramentas e licenças', 'Garantias e seguros',
            'Certidões e cartório', 'Marketing', 'Escritório', 'IA e APIs', 'Outras despesas']
};
const ler = () => U.ler('financeiro.json', { lancamentos: [], saldoInicial: 0 });

function validar(b) {
  const tipo = b.tipo === 'despesa' ? 'despesa' : 'receita';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : new Date().toISOString().slice(0, 10);
  const valor = Math.abs(typeof b.valor === 'number' ? b.valor : U.num(b.valor));
  if (!valor) throw new Error('informe o valor');
  return { tipo, data, valor, descricao: String(b.descricao || '').trim().slice(0, 160) || (tipo === 'receita' ? 'Receita' : 'Despesa'),
           categoria: String(b.categoria || '').slice(0, 60) || (tipo === 'receita' ? 'Outras receitas' : 'Outras despesas'),
           situacao: b.situacao === 'previsto' ? 'previsto' : 'realizado', contrato: String(b.contrato || '').slice(0, 120) };
}
function adicionar(b) { const d = ler(); const l = Object.assign({ id: U.id('fin-') }, validar(b)); d.lancamentos.push(l); U.gravar('financeiro.json', d); return l; }
function editar(id, b) { const d = ler(); const i = d.lancamentos.findIndex(l => l.id === id); if (i < 0) return null; d.lancamentos[i] = Object.assign({ id }, validar(Object.assign({}, d.lancamentos[i], b))); U.gravar('financeiro.json', d); return d.lancamentos[i]; }
function remover(id) { const d = ler(); d.lancamentos = d.lancamentos.filter(l => l.id !== id); U.gravar('financeiro.json', d); return true; }
function saldoInicial(v) { const d = ler(); d.saldoInicial = U.num(v); U.gravar('financeiro.json', d); return d.saldoInicial; }

function lista(f = {}) {
  return ler().lancamentos.filter(l => (!f.mes || l.data.startsWith(f.mes)) && (!f.tipo || l.tipo === f.tipo) &&
    (!f.categoria || l.categoria === f.categoria) && (!f.situacao || l.situacao === f.situacao))
    .sort((a, b) => b.data.localeCompare(a.data));
}

function resumo() {
  const d = ler();
  const r = { saldoInicial: d.saldoInicial, receitas: 0, despesas: 0, aReceber: 0, aPagar: 0, porMes: {}, porCategoria: {}, porContrato: {} };
  for (const l of d.lancamentos) {
    const s = l.tipo === 'receita' ? 1 : -1;
    if (l.situacao === 'previsto') { if (s > 0) r.aReceber += l.valor; else r.aPagar += l.valor; }
    else { if (s > 0) r.receitas += l.valor; else r.despesas += l.valor; }
    const m = l.data.slice(0, 7);
    r.porMes[m] = r.porMes[m] || { receitas: 0, despesas: 0, previstoEntrada: 0, previstoSaida: 0 };
    const k = l.situacao === 'previsto' ? (s > 0 ? 'previstoEntrada' : 'previstoSaida') : (s > 0 ? 'receitas' : 'despesas');
    r.porMes[m][k] += l.valor;
    const ck = l.tipo + '|' + l.categoria; r.porCategoria[ck] = (r.porCategoria[ck] || 0) + l.valor;
    if (l.contrato) { r.porContrato[l.contrato] = r.porContrato[l.contrato] || { receitas: 0, despesas: 0 }; r.porContrato[l.contrato][s > 0 ? 'receitas' : 'despesas'] += l.valor; }
  }
  r.saldo = r.saldoInicial + r.receitas - r.despesas;
  r.saldoProjetado = r.saldo + r.aReceber - r.aPagar;
  r.margem = r.receitas ? (r.receitas - r.despesas) / r.receitas : 0;
  r.meses = Object.keys(r.porMes).sort();
  return r;
}

/** CSV: data;descrição;valor;categoria;tipo;situação;contrato (valor negativo = despesa) */
function importarCSV(texto) {
  const linhas = U.lerCSV(texto);
  if (!linhas.length) throw new Error('arquivo vazio');
  const temCab = /data/i.test(linhas[0][0] || '');
  let n = 0; const erros = [];
  for (const [i, l] of linhas.slice(temCab ? 1 : 0).entries()) {
    try {
      let data = (l[0] || '').trim();
      const m = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) data = `${m[3]}-${m[2]}-${m[1]}`;
      const v = U.num(l[2]);
      const tipo = (l[4] || '').toLowerCase().startsWith('d') || v < 0 ? 'despesa' : 'receita';
      adicionar({ data, descricao: l[1], valor: Math.abs(v), categoria: l[3], tipo, situacao: (l[5] || '').toLowerCase().startsWith('p') ? 'previsto' : 'realizado', contrato: l[6] });
      n++;
    } catch (e) { erros.push('linha ' + (i + 1 + (temCab ? 1 : 0)) + ': ' + e.message); }
  }
  return { importados: n, erros };
}
function exportarCSV(f) {
  return U.csv(lista(f), [{ titulo: 'Data', v: 'data' }, { titulo: 'Descrição', v: 'descricao' },
    { titulo: 'Valor', v: l => (l.tipo === 'despesa' ? -l.valor : l.valor).toFixed(2).replace('.', ',') },
    { titulo: 'Categoria', v: 'categoria' }, { titulo: 'Tipo', v: 'tipo' }, { titulo: 'Situação', v: 'situacao' }, { titulo: 'Contrato', v: 'contrato' }]);
}

function relatorioMD() {
  const r = resumo();
  const L = [`# Relatório financeiro — V4 fábricagov`, ``, `Gerado em ${new Date().toLocaleString('pt-BR')}.`, ``,
    `| Indicador | Valor |`, `| --- | ---: |`,
    `| Saldo inicial | ${U.brl(r.saldoInicial)} |`, `| Receitas realizadas | ${U.brl(r.receitas)} |`, `| Despesas realizadas | ${U.brl(r.despesas)} |`,
    `| **Saldo atual** | **${U.brl(r.saldo)}** |`, `| A receber (previsto) | ${U.brl(r.aReceber)} |`, `| A pagar (previsto) | ${U.brl(r.aPagar)} |`,
    `| Saldo projetado | ${U.brl(r.saldoProjetado)} |`, `| Margem realizada | ${(r.margem * 100).toFixed(1)}% |`, ``,
    `## Por mês`, ``, `| Mês | Receitas | Despesas | Resultado | Entra (prev.) | Sai (prev.) |`, `| --- | ---: | ---: | ---: | ---: | ---: |`,
    ...r.meses.map(m => { const x = r.porMes[m]; return `| ${m} | ${U.brl(x.receitas)} | ${U.brl(x.despesas)} | ${U.brl(x.receitas - x.despesas)} | ${U.brl(x.previstoEntrada)} | ${U.brl(x.previstoSaida)} |`; }),
    ``, `## Por categoria`, ``, `| Tipo | Categoria | Total |`, `| --- | --- | ---: |`,
    ...Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const [t, c] = k.split('|'); return `| ${t} | ${c} | ${U.brl(v)} |`; })];
  if (Object.keys(r.porContrato).length) {
    L.push('', '## Por contrato', '', '| Contrato | Receitas | Despesas | Margem |', '| --- | ---: | ---: | ---: |');
    for (const [c, x] of Object.entries(r.porContrato)) L.push(`| ${c} | ${U.brl(x.receitas)} | ${U.brl(x.despesas)} | ${x.receitas ? ((x.receitas - x.despesas) / x.receitas * 100).toFixed(1) + '%' : '—'} |`);
  }
  return L.join('\n') + '\n';
}

module.exports = { CATEGORIAS, adicionar, editar, remover, saldoInicial, lista, resumo, importarCSV, exportarCSV, relatorioMD };
