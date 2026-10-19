/* ===========================================================
   painel/ust.js — UST: teto, distribuição e relatórios

   Você cadastra o contrato com a QUANTIDADE MÁXIMA de UST (o teto) e o
   valor da UST. As demandas (ordens de serviço) entram com a estimativa de
   UST — à mão ou vindas da Fábrica. A distribuição:
     1. ordena as demandas por prioridade e data
     2. aceita demandas até bater o teto (o que já foi entregue conta primeiro)
     3. reparte as UST de cada demanda entre os agentes do squad, respeitando
        a capacidade mensal de cada um (horas ÷ horas por UST)
     4. diz quanto falta para bater o teto e quais itens do backlog cabem
   =========================================================== */
const U = require('./util');

const ler = () => U.ler('ust.json', { contratos: {}, demandas: {}, capacidadeHorasMes: 120 });
const gravar = d => U.gravar('ust.json', d);

function salvarContrato(b) {
  const d = ler();
  const id = b.id && d.contratos[b.id] ? b.id : U.id('ctr-');
  const teto = U.num(b.tetoUST);
  if (!teto || teto <= 0) throw new Error('informe a quantidade máxima de UST (teto)');
  d.contratos[id] = Object.assign(d.contratos[id] || { criadoEm: U.agoraISO() }, {
    id, nome: String(b.nome || 'Contrato').slice(0, 120), orgao: String(b.orgao || '').slice(0, 160),
    tetoUST: teto, valorUST: U.num(b.valorUST), horasPorUST: U.num(b.horasPorUST) || 1,
    inicio: b.inicio || '', fim: b.fim || '', metaMensal: U.num(b.metaMensal)
  });
  gravar(d); return d.contratos[id];
}
function removerContrato(id) { const d = ler(); delete d.contratos[id]; for (const x of Object.values(d.demandas)) if (x.contratoId === id) x.contratoId = null; gravar(d); return true; }

function salvarDemanda(b) {
  const d = ler();
  const id = b.id && d.demandas[b.id] ? b.id : U.id('os-');
  const ust = U.num(b.ust);
  if (!ust || ust <= 0) throw new Error('informe as UST da demanda');
  d.demandas[id] = Object.assign(d.demandas[id] || { criadoEm: U.agoraISO() }, {
    id, contratoId: b.contratoId || null, titulo: String(b.titulo || 'Demanda').slice(0, 160), ust,
    prioridade: Math.max(1, Math.min(5, Number(b.prioridade) || 3)),
    status: ['backlog', 'em execução', 'entregue', 'cancelada'].includes(b.status) ? b.status : 'backlog',
    squad: Array.isArray(b.squad) ? b.squad.slice(0, 8) : (d.demandas[id] && d.demandas[id].squad) || [],
    origem: b.origem || (d.demandas[id] && d.demandas[id].origem) || 'manual'
  });
  gravar(d); return d.demandas[id];
}
function removerDemanda(id) { const d = ler(); delete d.demandas[id]; gravar(d); return true; }
function capacidade(h) { const d = ler(); d.capacidadeHorasMes = Math.max(1, U.num(h) || 120); gravar(d); return d.capacidadeHorasMes; }

/** traz os projetos da Fábrica que têm UST como demandas do contrato */
function importarFabrica(projetos, contratoId) {
  const d = ler(); let n = 0;
  for (const p of projetos) {
    if (!U.numJS(p.ust)) continue;
    const id = 'os-' + p.id;
    const atual = d.demandas[id];
    d.demandas[id] = Object.assign(atual || { criadoEm: p.criadoEm }, {
      id, contratoId: (atual && atual.contratoId) || contratoId || null, titulo: 'Fábrica: ' + p.nome, ust: U.numJS(p.ust),
      prioridade: (atual && atual.prioridade) || p.prioridade || 3,
      status: p.status === 'pronto' ? 'entregue' : (atual && atual.status) || 'em execução',
      squad: (p.squad || []).map(s => s.nome), origem: 'fabrica:' + p.id
    });
    if (!atual) n++;
  }
  gravar(d); return { novas: n };
}

function distribuir(contratoId, equipe) {
  const d = ler();
  const c = d.contratos[contratoId];
  if (!c) throw new Error('contrato não encontrado');
  // capacidade de cada agente no período inteiro do contrato (sem datas: 12 meses)
  let meses = 12;
  if (c.inicio && c.fim) meses = Math.max(1, Math.round((new Date(c.fim) - new Date(c.inicio)) / (30.44 * 86400000)));
  const capUST = d.capacidadeHorasMes * meses / (c.horasPorUST || 1);
  const devs = (equipe || []).filter(a => !a.boss && (a.dept === 'servico' || a.dept === 'fabrica2')).map(a => a.name);
  const carga = new Map(devs.map(n => [n, 0]));
  const dem = Object.values(d.demandas).filter(x => x.contratoId === contratoId && x.status !== 'cancelada');
  const ordem = { entregue: 0, 'em execução': 1, backlog: 2 };
  dem.sort((a, b) => ordem[a.status] - ordem[b.status] || a.prioridade - b.prioridade || a.criadoEm.localeCompare(b.criadoEm));

  let usado = 0; const aceitas = [], fora = [];
  for (const x of dem) {
    if (x.status === 'entregue' || x.status === 'em execução' || usado + x.ust <= c.tetoUST) {
      usado += x.ust;
      // reparte entre o squad; sem squad, os menos carregados do time
      let pessoas = (x.squad && x.squad.length ? x.squad : []).filter(n => carga.has(n));
      if (!pessoas.length) {
        const qtd = Math.max(1, Math.min(4, Math.ceil(x.ust / Math.max(1, capUST * 0.5))));
        pessoas = [...carga.entries()].sort((a, b) => a[1] - b[1]).slice(0, qtd).map(e => e[0]);
      }
      const parte = x.ust / Math.max(1, pessoas.length);
      const alocacao = pessoas.map(n => { carga.set(n, (carga.get(n) || 0) + parte); return { agente: n, ust: +parte.toFixed(2) }; });
      aceitas.push(Object.assign({}, x, { alocacao }));
    } else fora.push(x);
  }
  const falta = Math.max(0, c.tetoUST - usado);
  const cabem = []; let sobra = falta;
  for (const x of fora.slice().sort((a, b) => a.ust - b.ust)) if (x.ust <= sobra) { cabem.push(x); sobra -= x.ust; }
  const porAgente = [...carga.entries()].filter(e => e[1] > 0).map(([agente, ust]) => ({
    agente, ust: +ust.toFixed(2), horas: +(ust * c.horasPorUST).toFixed(1), ocupacao: +(ust / capUST * 100).toFixed(0)
  })).sort((a, b) => b.ust - a.ust);
  const res = {
    contrato: c, quando: U.agoraISO(), teto: c.tetoUST, usado: +usado.toFixed(2), falta: +falta.toFixed(2),
    percentual: c.tetoUST ? +(usado / c.tetoUST * 100).toFixed(1) : 0,
    valorUsado: +(usado * c.valorUST).toFixed(2), valorTeto: +(c.tetoUST * c.valorUST).toFixed(2),
    entregue: +dem.filter(x => x.status === 'entregue').reduce((s, x) => s + x.ust, 0).toFixed(2),
    aceitas, fora, cabem, porAgente, capacidadeUSTporAgente: +capUST.toFixed(1), meses,
    sobrecarregados: porAgente.filter(a => a.ocupacao > 100).map(a => a.agente)
  };
  d.ultimaDistribuicao = d.ultimaDistribuicao || {};
  d.ultimaDistribuicao[contratoId] = res.quando;
  gravar(d);
  return res;
}

function relatorioMD(r) {
  const c = r.contrato;
  const L = [`# Relatório de UST — ${c.nome}`, ``, `${c.orgao ? 'Órgão: ' + c.orgao + ' · ' : ''}Gerado em ${new Date(r.quando).toLocaleString('pt-BR')}.`, ``,
    `| Indicador | Valor |`, `| --- | ---: |`,
    `| Teto do contrato | ${r.teto} UST (${U.brl(r.valorTeto)}) |`, `| Distribuído | ${r.usado} UST (${r.percentual}%) |`,
    `| Já entregue | ${r.entregue} UST |`, `| Valor distribuído | ${U.brl(r.valorUsado)} |`, `| Falta para o teto | ${r.falta} UST |`,
    `| Capacidade por agente no período (${r.meses} meses) | ${r.capacidadeUSTporAgente} UST |`, ``,
    `## Demandas aceitas`, ``, `| Prior. | Demanda | Situação | UST | Agentes |`, `| ---: | --- | --- | ---: | --- |`,
    ...r.aceitas.map(x => `| ${x.prioridade} | ${x.titulo} | ${x.status} | ${x.ust} | ${x.alocacao.map(a => a.agente + ' (' + a.ust + ')').join(', ')} |`),
    ``, `## Por agente`, ``, `| Agente | UST | Horas | Ocupação |`, `| --- | ---: | ---: | ---: |`,
    ...r.porAgente.map(a => `| ${a.agente} | ${a.ust} | ${a.horas} | ${a.ocupacao}%${a.ocupacao > 100 ? ' ⚠️' : ''} |`)];
  if (r.fora.length) L.push('', '## Fora do teto', '', ...r.fora.map(x => `- ${x.titulo} — ${x.ust} UST (prioridade ${x.prioridade})`));
  if (r.cabem.length) L.push('', `## Para bater o teto (cabem nos ${r.falta} UST que faltam)`, '', ...r.cabem.map(x => `- ${x.titulo} — ${x.ust} UST`));
  if (r.sobrecarregados.length) L.push('', '> Agentes acima de 100% da capacidade: ' + r.sobrecarregados.join(', ') + '. Redistribua ou amplie o prazo.');
  return L.join('\n') + '\n';
}
function relatorioCSV(r) {
  const linhas = [];
  for (const x of r.aceitas) for (const a of x.alocacao) linhas.push({ demanda: x.titulo, status: x.status, prioridade: x.prioridade, agente: a.agente, ust: a.ust,
    horas: (a.ust * (r.contrato.horasPorUST || 1)).toFixed(1), valor: (a.ust * r.contrato.valorUST).toFixed(2) });
  return U.csv(linhas, [{ titulo: 'Demanda', v: 'demanda' }, { titulo: 'Situação', v: 'status' }, { titulo: 'Prioridade', v: 'prioridade' },
    { titulo: 'Agente', v: 'agente' }, { titulo: 'UST', v: l => String(l.ust).replace('.', ',') }, { titulo: 'Horas', v: l => l.horas.replace('.', ',') },
    { titulo: 'Valor (R$)', v: l => l.valor.replace('.', ',') }]);
}

const estado = () => { const d = ler(); return { contratos: Object.values(d.contratos), demandas: Object.values(d.demandas), capacidadeHorasMes: d.capacidadeHorasMes }; };

module.exports = { estado, salvarContrato, removerContrato, salvarDemanda, removerDemanda, capacidade, importarFabrica, distribuir, relatorioMD, relatorioCSV };
