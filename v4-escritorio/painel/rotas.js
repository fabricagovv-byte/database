/* ===========================================================
   painel/rotas.js — API do Painel V4 (/api/painel/*) e webhook do WhatsApp

   Operações demoradas (busca no PNCP, análise com IA, consulta de CNPJs)
   viram TAREFAS: a rota devolve { tarefa } na hora e a tela acompanha em
   /api/painel/tarefas/<id>.
   =========================================================== */
const U = require('./util');
const IA = require('./ia');
const LIC = require('./licitacoes');
const COM = require('./comercial');
const FAB = require('./fabrica');
const FIN = require('./financeiro');
const UST = require('./ust');
const WA = require('./whatsapp');

let D = null;
function init(dep) {
  D = dep;
  U.init(dep.ROOT);
  const vazia = require('path').join(dep.ROOT, 'data', 'painel', 'ia-vazia');
  require('fs').mkdirSync(vazia, { recursive: true });
  IA.init(dep.CLAUDE_BIN, vazia);
  FAB.init(dep);
  WA.init({ licitacoes: LIC, fabrica: FAB, ust: UST, financeiro: FIN, equipe: dep.equipe });
  LIC.agendarRadar(avisarTudo);
  setTimeout(() => FAB.girarFila(), 2000);
}

/** aviso no celular (ntfy/CallMeBot do escritório) e no WhatsApp dos autorizados */
async function avisarTudo(titulo, texto) {
  if (D.avisar) await D.avisar(titulo, texto).catch(() => {});
  const w = WA.publico();
  if (w.ativo && w.pronto) for (const n of w.autorizados) await WA.enviar(n, '*' + titulo + '*\n\n' + texto).catch(() => {});
}

/* ---------- tarefas em segundo plano ---------- */
const tarefas = new Map();
function tarefa(nome, fn) {
  const id = U.id('t-');
  const t = { id, nome, status: 'rodando', progresso: '', inicio: Date.now(), resultado: null, erro: null };
  tarefas.set(id, t);
  Promise.resolve().then(() => fn(p => { t.progresso = String(p).slice(0, 300); }))
    .then(r => { t.resultado = r; t.status = 'ok'; })
    .catch(e => { t.erro = e && e.message || String(e); t.status = 'erro'; })
    .finally(() => { t.fim = Date.now(); setTimeout(() => tarefas.delete(id), 30 * 60000); });
  return { tarefa: id };
}

/* ---------- roteador ---------- */
const rotas = [];
const r = (metodo, padrao, fn) => rotas.push({ metodo, re: new RegExp('^/api/painel' + padrao + '$'), fn });

async function rotear(req, res, rota, url) {
  for (const x of rotas) {
    if (x.metodo !== req.method) continue;
    const m = rota.match(x.re); if (!m) continue;
    try {
      let corpo = {};
      if (req.method !== 'GET' && !x.fn.cru) {
        const c = await U.lerCorpo(req, 5e6);
        if (c.json === null) return U.responder(res, 400, { ok: false, motivo: 'json inválido' });
        corpo = c.json;
      }
      const out = await x.fn({ req, res, m, q: url.searchParams, corpo });
      if (out !== undefined && !res.headersSent) U.responder(res, 200, out);
    } catch (e) {
      if (!res.headersSent) U.responder(res, 400, { ok: false, motivo: e.message });
    }
    return true;
  }
  U.responder(res, 404, { ok: false, motivo: 'rota do painel não existe' });
  return true;
}
const cru = fn => { fn.cru = true; return fn; };
const arquivo = (res, nome, tipo, conteudo) => { U.enviarArquivo(res, nome, tipo, conteudo); };
const hoje = () => new Date().toISOString().slice(0, 10);

/* ---------- visão geral ---------- */
r('GET', '/resumo', () => {
  const cart = LIC.carteira();
  const ult = U.ler('ultima-busca.json', null);
  const prj = FAB.lista();
  const fin = FIN.resumo();
  const ust = UST.estado();
  const porStatus = (lista, campo) => lista.reduce((o, x) => (o[x[campo]] = (o[x[campo]] || 0) + 1, o), {});
  return {
    licitacoes: { carteira: cart.length, porStatus: porStatus(cart, 'status'),
                  ultimaBusca: ult ? { quando: ult.quando, total: ult.total } : null,
                  proximas: cart.filter(l => l.dias != null && l.dias >= 0 && ['vamos disputar', 'em análise', 'proposta enviada'].includes(l.status)).slice(0, 5),
                  radar: LIC.radar().ultimo },
    fabrica: { total: prj.length, porStatus: porStatus(prj, 'status'), ust: prj.reduce((s, p) => s + U.numJS(p.ust), 0) },
    comercial: { total: COM.todos().length, comEmail: COM.todos({ comEmail: true }).length },
    financeiro: { saldo: fin.saldo, aReceber: fin.aReceber, aPagar: fin.aPagar, saldoProjetado: fin.saldoProjetado },
    ust: { contratos: ust.contratos.length, teto: ust.contratos.reduce((s, c) => s + c.tetoUST, 0) },
    whatsapp: WA.publico()
  };
});
r('GET', '/tarefas/([\\w-]+)', ({ m }) => {
  const t = tarefas.get(m[1]);
  if (!t) throw new Error('tarefa não encontrada (o servidor pode ter reiniciado)');
  return t;
});
r('GET', '/ia', async () => D.estadoClaude ? D.estadoClaude() : { instalado: null });

/* ---------- licitações ---------- */
r('GET', '/licitacoes/meta', () => ({ modalidades: LIC.MODALIDADES, esferas: Object.values(LIC.ESFERAS), status: LIC.STATUS,
                                      perfil: LIC.perfil(), radar: Object.assign({}, LIC.radar(), { vistos: undefined }) }));
r('POST', '/licitacoes/buscar', ({ corpo }) => tarefa('busca no PNCP', async p => {
  p('consultando o PNCP…');
  const res = await LIC.buscar(corpo);
  return { total: res.total, bruto: res.totalBruto, erros: res.erros, consultas: res.consultas };
}));
r('GET', '/licitacoes/ultima', () => U.ler('ultima-busca.json', { itens: [], total: 0 }));
r('GET', '/licitacoes/carteira', () => LIC.carteira());
r('POST', '/licitacoes/salvar', ({ corpo }) => {
  const l = U.ler('ultima-busca.json', { itens: [] }).itens.find(x => x.id === corpo.id);
  if (!l) throw new Error('não achei na última busca');
  return LIC.salvar(l, { status: corpo.status || 'nova' });
});
r('POST', '/licitacoes/atualizar', ({ corpo }) => { const l = LIC.atualizar(corpo.id, corpo); if (!l) throw new Error('não está na carteira'); return l; });
r('POST', '/licitacoes/remover', ({ corpo }) => ({ ok: LIC.remover(corpo.id) }));
r('POST', '/licitacoes/analisar', ({ corpo }) => tarefa('análise de edital', p => LIC.analisar(corpo.id, !!corpo.ia, p)));
r('PUT', '/licitacoes/perfil', ({ corpo }) => {
  if (!corpo || !Array.isArray(corpo.grupos)) throw new Error('perfil inválido');
  return U.gravar('perfil-licitacoes.json', { grupos: corpo.grupos.slice(0, 20).map(g => ({ nome: String(g.nome || '').slice(0, 60), termos: String(g.termos || '').slice(0, 2000), excluir: String(g.excluir || '').slice(0, 1000) })),
                                              ruido: String(corpo.ruido || '').slice(0, 2000) });
});
r('POST', '/licitacoes/perfil/padrao', () => U.gravar('perfil-licitacoes.json', LIC.PERFIL_PADRAO));
r('PUT', '/licitacoes/radar', ({ corpo }) => LIC.configurarRadar(corpo));
r('POST', '/licitacoes/radar/rodar', () => tarefa('radar', async p => { p('rodando o radar…'); const x = await LIC.rodarRadar(avisarTudo); if (!x.ok) throw new Error(x.motivo); return { novas: x.novas.length, resultado: x.resultado }; }));
r('GET', '/licitacoes/exportar.csv', ({ res, q }) => {
  const fonte = q.get('fonte') === 'ultima' ? U.ler('ultima-busca.json', { itens: [] }).itens : LIC.carteira();
  arquivo(res, 'licitacoes-' + hoje() + '.csv', 'text/csv; charset=utf-8', U.csv(fonte, [
    { titulo: 'Nota', v: 'nota' }, { titulo: 'Status', v: 'status' }, { titulo: 'Órgão', v: 'orgao' }, { titulo: 'UF', v: 'uf' },
    { titulo: 'Município', v: 'municipio' }, { titulo: 'Modalidade', v: 'modalidade' }, { titulo: 'Número', v: 'numero' },
    { titulo: 'Objeto', v: 'objeto' }, { titulo: 'Valor estimado', v: l => String(l.valor || 0).replace('.', ',') },
    { titulo: 'Propostas até', v: 'encerramento' }, { titulo: 'Dias', v: 'dias' }, { titulo: 'Link PNCP', v: 'link' }]));
});
r('POST', '/licitacoes/fabrica', ({ corpo }) => {
  const l = LIC.carteira().find(x => x.id === corpo.id) || U.ler('ultima-busca.json', { itens: [] }).itens.find(x => x.id === corpo.id);
  if (!l) throw new Error('licitação não encontrada');
  const itens = l.analise && l.analise.itens ? l.analise.itens.slice(0, 15).map(i => '- ' + i.descricao).join('\n') : '';
  return FAB.criar({ nome: 'Edital ' + (l.numero || '') + ' ' + (l.municipio || l.orgao).slice(0, 30),
    pedido: `Protótipo funcional para disputar o edital do(a) ${l.orgao} (${l.municipio || ''}/${l.uf}).\nObjeto: ${l.objeto}\n${itens ? 'Itens do edital:\n' + itens + '\n' : ''}Monte as telas e funções principais que o objeto pede, para servir de prova de conceito.`,
    cliente: l.orgao, licitacaoId: l.id, prioridade: 1 });
});

/* ---------- comercial ---------- */
r('GET', '/comercial', ({ q }) => ({ itens: COM.todos({ uf: q.get('uf'), tipo: q.get('tipo'), status: q.get('status'), q: q.get('q'), comEmail: q.get('comEmail') === '1' }), status: COM.STATUS }));
r('POST', '/comercial/importar-editais', ({ corpo }) => tarefa('contatos dos editais', p => {
  const fontes = LIC.carteira().concat(U.ler('ultima-busca.json', { itens: [] }).itens);
  return COM.importarDosEditais(fontes, Math.min(200, Number(corpo.limite) || 40), p);
}));
r('POST', '/comercial/municipios', ({ corpo }) => tarefa('municípios IBGE', () => COM.importarMunicipios(corpo.uf)));
r('POST', '/comercial/tse', cru(async ({ req }) => {
  const c = await U.lerCorpo(req, 600 * 1024 * 1024);
  return COM.importarTSE(c.bruto);
}));
r('POST', '/comercial/cnpj', async ({ corpo }) => COM.gravarContato(Object.assign({ tipo: 'orgao' }, await COM.consultarCNPJ(corpo.cnpj))));
r('POST', '/comercial/atualizar', ({ corpo }) => { const c = COM.atualizar(corpo.id, corpo); if (!c) throw new Error('contato não encontrado'); return c; });
r('POST', '/comercial/novo', ({ corpo }) => COM.gravarContato({ tipo: corpo.tipo === 'prefeitura' ? 'prefeitura' : 'orgao', nome: String(corpo.nome || '').slice(0, 160),
  uf: String(corpo.uf || '').toUpperCase().slice(0, 2), municipio: String(corpo.municipio || '').slice(0, 80), email: String(corpo.email || '').slice(0, 120),
  telefone: String(corpo.telefone || '').slice(0, 60), prefeito: String(corpo.prefeito || '').slice(0, 80), fonte: 'cadastro manual' }));
r('POST', '/comercial/remover', ({ corpo }) => ({ ok: COM.remover(corpo.id) }));
r('POST', '/comercial/abordagem', ({ corpo }) => tarefa('rascunho de e-mail', p => { p('a Natália está escrevendo…'); return COM.abordagem(corpo.id); }));
r('GET', '/comercial/exportar.csv', ({ res, q }) => arquivo(res, 'contatos-' + hoje() + '.csv', 'text/csv; charset=utf-8',
  COM.exportarCSV({ uf: q.get('uf'), tipo: q.get('tipo'), status: q.get('status'), q: q.get('q'), comEmail: q.get('comEmail') === '1' })));

/* ---------- whatsapp ---------- */
r('GET', '/whatsapp', () => ({ config: WA.publico(), log: WA.log().slice(0, 100) }));
r('PUT', '/whatsapp', ({ corpo }) => WA.configurar(corpo));
r('POST', '/whatsapp/testar', async ({ corpo }) => { await WA.enviar(corpo.numero, corpo.texto || 'Teste do robô da V4 fábricagov.'); return { ok: true }; });
r('POST', '/whatsapp/simular', async ({ corpo }) => ({ resposta: await WA.responder('simulador', String(corpo.texto || '')) }));

/* ---------- fábrica ---------- */
r('GET', '/fabrica', () => ({ projetos: FAB.lista(), config: FAB.config() }));
r('POST', '/fabrica', ({ corpo }) => FAB.criar(corpo));
r('PUT', '/fabrica/config', ({ corpo }) => FAB.configurar(corpo));
r('GET', '/fabrica/([\\w-]+)', ({ m }) => { const p = FAB.detalhe(m[1]); if (!p) throw new Error('projeto não encontrado'); return p; });
r('GET', '/fabrica/([\\w-]+)/arquivo', ({ m, q }) => { const t = FAB.lerArquivo(m[1], q.get('p')); if (t == null) throw new Error('arquivo não encontrado'); return { texto: t }; });
r('GET', '/fabrica/([\\w-]+)/zip', ({ m, res }) => { const z = FAB.zip(m[1]); if (!z) throw new Error('projeto não encontrado'); arquivo(res, z.nome, 'application/zip', z.buf); });
r('GET', '/fabrica/([\\w-]+)/relatorio.md', ({ m, res }) => { const p = FAB.detalhe(m[1]); if (!p || !p.relatorio) throw new Error('relatório ainda não existe'); arquivo(res, p.slug + '-RELATORIO.md', 'text/markdown; charset=utf-8', p.relatorio); });
r('POST', '/fabrica/([\\w-]+)/cancelar', ({ m }) => FAB.cancelar(m[1]));
r('POST', '/fabrica/([\\w-]+)/retomar', ({ m }) => FAB.retomar(m[1]));
r('POST', '/fabrica/([\\w-]+)/ajustar', ({ m, corpo }) => FAB.ajustar(m[1], corpo.texto));
r('POST', '/fabrica/([\\w-]+)/apagar', ({ m }) => ({ ok: FAB.apagar(m[1]) }));
r('POST', '/fabrica/([\\w-]+)/testes', ({ m }) => tarefa('testes', async p => { p('rodando node --test…'); return FAB.rodarTestes(m[1]); }));
r('POST', '/fabrica/([\\w-]+)/ligar', async ({ m }) => {
  const p = FAB.detalhe(m[1]); if (!p || !p.sistemaId) throw new Error('o sistema ainda não foi registrado no escritório');
  const x = await D.ligar(p.sistemaId); if (!x || !x.ok) throw new Error((x && x.motivo) || 'não ligou');
  return { ok: true, url: 'http://localhost:' + p.porta + '/' };
});
r('POST', '/fabrica/([\\w-]+)/desligar', ({ m }) => { const p = FAB.detalhe(m[1]); if (p && p.sistemaId) D.desligar(p.sistemaId); return { ok: true }; });

/* ---------- financeiro ---------- */
r('GET', '/financeiro', ({ q }) => ({ lancamentos: FIN.lista({ mes: q.get('mes'), tipo: q.get('tipo'), categoria: q.get('categoria'), situacao: q.get('situacao') }),
                                      resumo: FIN.resumo(), categorias: FIN.CATEGORIAS }));
r('POST', '/financeiro', ({ corpo }) => FIN.adicionar(corpo));
r('POST', '/financeiro/editar', ({ corpo }) => { const l = FIN.editar(corpo.id, corpo); if (!l) throw new Error('lançamento não encontrado'); return l; });
r('POST', '/financeiro/remover', ({ corpo }) => ({ ok: FIN.remover(corpo.id) }));
r('POST', '/financeiro/saldo-inicial', ({ corpo }) => ({ saldoInicial: FIN.saldoInicial(corpo.valor) }));
r('POST', '/financeiro/importar', ({ corpo }) => FIN.importarCSV(String(corpo.texto || '')));
r('GET', '/financeiro/exportar.csv', ({ res, q }) => arquivo(res, 'financeiro-' + hoje() + '.csv', 'text/csv; charset=utf-8', FIN.exportarCSV({ mes: q.get('mes') })));
r('GET', '/financeiro/relatorio.md', ({ res }) => arquivo(res, 'relatorio-financeiro-' + hoje() + '.md', 'text/markdown; charset=utf-8', FIN.relatorioMD()));
r('GET', '/financeiro/relatorio', () => ({ texto: FIN.relatorioMD() }));

/* ---------- UST ---------- */
r('GET', '/ust', () => UST.estado());
r('POST', '/ust/contrato', ({ corpo }) => UST.salvarContrato(corpo));
r('POST', '/ust/contrato/remover', ({ corpo }) => ({ ok: UST.removerContrato(corpo.id) }));
r('POST', '/ust/demanda', ({ corpo }) => UST.salvarDemanda(corpo));
r('POST', '/ust/demanda/remover', ({ corpo }) => ({ ok: UST.removerDemanda(corpo.id) }));
r('POST', '/ust/capacidade', ({ corpo }) => ({ capacidadeHorasMes: UST.capacidade(corpo.horas) }));
r('POST', '/ust/importar-fabrica', ({ corpo }) => UST.importarFabrica(FAB.lista(), corpo.contratoId));
r('GET', '/ust/distribuir', ({ q }) => UST.distribuir(q.get('contrato'), D.equipe()));
r('GET', '/ust/relatorio.md', ({ q, res }) => { const x = UST.distribuir(q.get('contrato'), D.equipe()); arquivo(res, 'ust-' + hoje() + '.md', 'text/markdown; charset=utf-8', UST.relatorioMD(x)); });
r('GET', '/ust/relatorio.csv', ({ q, res }) => { const x = UST.distribuir(q.get('contrato'), D.equipe()); arquivo(res, 'ust-' + hoje() + '.csv', 'text/csv; charset=utf-8', UST.relatorioCSV(x)); });
r('GET', '/ust/relatorio', ({ q }) => ({ texto: UST.relatorioMD(UST.distribuir(q.get('contrato'), D.equipe())) }));

/* ---------- webhook do WhatsApp (fora do /api, aceita host externo) ---------- */
async function webhook(req, res, url) {
  if (req.method === 'GET') {
    const ch = WA.verificarWebhook(url.searchParams);
    res.writeHead(ch ? 200 : 403, { 'Content-Type': 'text/plain' }).end(ch || 'token de verificação não confere');
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  try {
    const c = await U.lerCorpo(req, 1e6);
    const x = await WA.receber(c.bruto, req.headers['x-hub-signature-256']);
    res.writeHead(x.codigo, { 'Content-Type': 'text/plain' }).end(x.ok ? 'ok' : x.motivo);
  } catch (e) { res.writeHead(400).end('erro'); }
}

/* Os sistemas de cada sala: o computador de cada agente abre a área do
   painel que é o trabalho dele. Ficam no registro como sistema "web". */
const SISTEMAS_INTERNOS = {
  'v4-diretoria':   { nome: 'Painel do CEO', url: 'painel.html#inicio', sobre: 'Visão geral da V4: licitações, fábrica, comercial, caixa e UST.' },
  'v4-licitacoes':  { nome: 'Busca de Licitações', url: 'painel.html#licitacoes', sobre: 'Busca no PNCP com filtros, carteira, análise e radar diário.' },
  'v4-fabrica':     { nome: 'Fábrica de Software', url: 'painel.html#fabrica', sobre: 'Pedidos de sistema, squads, código, testes, prévia e relatórios.' },
  'v4-comercial':   { nome: 'Comercial', url: 'painel.html#comercial', sobre: 'Contatos institucionais de órgãos e prefeituras, situação e rascunhos de e-mail.' },
  'v4-whatsapp':    { nome: 'Robô de WhatsApp', url: 'painel.html#whatsapp', sobre: 'Configuração, simulador e mensagens do robô de licitações.' },
  'v4-financeiro':  { nome: 'Financeiro', url: 'painel.html#financeiro', sobre: 'Lançamentos, saldo, projeção e relatórios.' },
  'v4-ust':         { nome: 'Gestão de UST', url: 'painel.html#ust', sobre: 'Teto de UST por contrato, distribuição pelo time e relatórios.' }
};

module.exports = { init, rotear, webhook, SISTEMAS_INTERNOS };
