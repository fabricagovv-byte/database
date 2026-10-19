/* ===========================================================
   painel/licitacoes.js — busca de licitações no PNCP

   Fonte oficial: Portal Nacional de Contratações Públicas (API pública,
   sem chave). Dois modos de busca:
     · abertas    — contratações com recebimento de propostas em aberto
     · publicadas — publicadas num intervalo de datas
   Cada edital recebe uma nota de aderência ao que a V4 vende (0–100),
   a partir de palavras-chave que você ajusta no painel.
   =========================================================== */
const U = require('./util');
const IA = require('./ia');

const BASE = () => (process.env.V4_PNCP_BASE || 'https://pncp.gov.br').replace(/\/$/, '');

const MODALIDADES = {
  1: 'Leilão eletrônico', 2: 'Diálogo competitivo', 3: 'Concurso', 4: 'Concorrência eletrônica',
  5: 'Concorrência presencial', 6: 'Pregão eletrônico', 7: 'Pregão presencial', 8: 'Dispensa',
  9: 'Inexigibilidade', 10: 'Manifestação de interesse', 11: 'Pré-qualificação', 12: 'Credenciamento',
  13: 'Leilão presencial'
};
const ESFERAS = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };
const STATUS = ['nova', 'em análise', 'vamos disputar', 'proposta enviada', 'ganhamos', 'perdemos', 'descartada'];

/* perfil de aderência da V4 — cada grupo tem termos que somam e termos que anulam */
const PERFIL_PADRAO = {
  grupos: [
    { nome: 'Desenvolvimento de software', termos: 'desenvolvimento de software,fábrica de software,sistema web,sistemas de informação,manutenção de sistema,manutenção evolutiva,manutenção corretiva,aplicativo,software,unidade de serviço técnico,ust,pontos de função,ponto de função,sustentação de sistemas,portal,plataforma digital', excluir: 'medicamento,hospitalar,veículo,irrigação,cftv,videomonitoramento,engenharia elétrica,pavimentação' },
    { nome: 'Licença e SaaS', termos: 'licença de software,licenciamento de software,licença de uso,software de gestão,cessão de uso de software,cessão de direito de uso,saas,sistema integrado de gestão', excluir: 'cftv,videomonitoramento,imóvel,cilindro,oxigênio' },
    { nome: 'Consultoria e serviços de TI', termos: 'consultoria em tecnologia da informação,governança de ti,serviços de tecnologia da informação,solução de tecnologia da informação,transformação digital,inteligência artificial,business intelligence,ciência de dados', excluir: 'proteção individual,conferência municipal' },
    { nome: 'Nuvem e dados', termos: 'hospedagem,computação em nuvem,cloud,datacenter,data center,tratamento de dados,backup,banco de dados', excluir: '' },
    { nome: 'Gestão documental', termos: 'digitalização,gestão documental,gestão eletrônica de documentos,ged,ocr,indexação,processo eletrônico', excluir: '' }
  ],
  ruido: 'sistema de registro de preços,sistema de registro de preço,registro de preços,sistema único de saúde,sistema de abastecimento,sistema de esgoto,sistema de iluminação,sistema de som'
};

const perfil = () => U.ler('perfil-licitacoes.json', PERFIL_PADRAO);
const lista = s => String(s || '').split(',').map(x => U.semAcento(x).trim()).filter(Boolean);
const temTermo = (t, termo) => new RegExp('(^|[^a-z0-9])' + termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t);

/** nota de aderência 0–100 e termos que casaram */
function aderencia(texto, palavrasExtras) {
  let t = ' ' + U.semAcento(texto) + ' ';
  const extras = lista(palavrasExtras);
  if (extras.length) {
    const casou = extras.filter(x => temTermo(t, x));
    if (!casou.length) return { nota: 0, termos: [] };
  }
  const p = perfil();
  for (const r of lista(p.ruido)) t = t.split(r).join(' ');
  let nota = 0; const termos = [];
  for (const g of p.grupos) {
    if (lista(g.excluir).some(x => temTermo(t, x))) continue;
    for (const k of lista(g.termos)) if (temTermo(t, k)) { nota += k.includes(' ') ? 40 : 15; termos.push(k); }
  }
  for (const x of extras) if (temTermo(t, x) && !termos.includes(x)) { nota += 30; termos.push(x); }
  return { nota: Math.min(100, nota), termos };
}

function normalizar(r) {
  const o = r.orgaoEntidade || {}, u = r.unidadeOrgao || {};
  const cnpj = o.cnpj || '', ano = r.anoCompra, seq = r.sequencialCompra;
  return {
    id: r.numeroControlePNCP || (cnpj + '-' + ano + '-' + seq),
    cnpj, orgao: o.razaoSocial || '', esfera: ESFERAS[o.esferaId] || o.esferaId || '',
    uf: u.ufSigla || '', municipio: u.municipioNome || '', ibge: u.codigoIbge || '', unidade: u.nomeUnidade || '',
    ano, seq, numero: r.numeroCompra || '', processo: r.processo || '',
    codModalidade: r.modalidadeId, modalidade: r.modalidadeNome || MODALIDADES[r.modalidadeId] || '',
    disputa: r.modoDisputaNome || '', objeto: (r.objetoCompra || '').trim(), info: (r.informacaoComplementar || '').trim(),
    valor: U.numJS(r.valorTotalEstimado), homologado: U.numJS(r.valorTotalHomologado), srp: !!r.srp,
    publicacao: r.dataPublicacaoPncp || '', abertura: r.dataAberturaProposta || '', encerramento: r.dataEncerramentoProposta || '',
    situacao: r.situacaoCompraNome || '', amparo: (r.amparoLegal && r.amparoLegal.nome) || '',
    linkOrigem: r.linkSistemaOrigem || '',
    link: cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : ''
  };
}

const aaaammdd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const diasAte = iso => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;

/** busca no PNCP e aplica os filtros. f = filtros vindos do painel */
async function buscar(f = {}) {
  const modo = f.modo === 'publicadas' ? 'publicadas' : 'abertas';
  const mods = (Array.isArray(f.modalidades) && f.modalidades.length ? f.modalidades : [6, 4, 8]).map(Number).filter(m => MODALIDADES[m]);
  const ufs = (Array.isArray(f.ufs) ? f.ufs : String(f.ufs || '').split(',')).map(x => String(x).trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x));
  const maxPaginas = Math.min(20, Math.max(1, Number(f.maxPaginas) || 6));
  const hoje = new Date();
  const erros = []; const brutos = new Map(); let consultas = 0;

  const alvos = [];
  for (const m of mods) for (const uf of (ufs.length ? ufs : [null])) alvos.push({ m, uf });

  for (const a of alvos) {
    for (let pg = 1; pg <= maxPaginas; pg++) {
      const q = new URLSearchParams({ codigoModalidadeContratacao: a.m, pagina: pg, tamanhoPagina: 50 });
      let rota;
      if (modo === 'abertas') {
        const fim = new Date(hoje.getTime() + (Number(f.diasAFrente) || 60) * 86400000);
        q.set('dataFinal', aaaammdd(fim)); rota = '/api/consulta/v1/contratacoes/proposta';
      } else {
        const ini = new Date(hoje.getTime() - (Number(f.dias) || 7) * 86400000);
        q.set('dataInicial', aaaammdd(ini)); q.set('dataFinal', aaaammdd(hoje)); rota = '/api/consulta/v1/contratacoes/publicacao';
      }
      if (a.uf) q.set('uf', a.uf);
      let d;
      try { consultas++; d = await U.baixarJSON(BASE() + rota + '?' + q, { timeout: 60000 }); }
      catch (e) { erros.push(MODALIDADES[a.m] + (a.uf ? ' ' + a.uf : '') + ' pág. ' + pg + ': ' + e.message); break; }
      const dados = (d && d.data) || [];
      for (const r of dados) { const n = normalizar(r); brutos.set(n.id, n); }
      if (!d || pg >= (d.totalPaginas || 1) || dados.length < 50) break;
    }
  }

  const carteira = U.ler('licitacoes.json', { itens: {} }).itens;
  const valorMin = U.numJS(f.valorMin), valorMax = U.numJS(f.valorMax);
  const esferas = Array.isArray(f.esferas) ? f.esferas : [];
  const notaMin = U.numJS(f.notaMin);
  const prazoMin = f.prazoMin === '' || f.prazoMin == null ? null : U.numJS(f.prazoMin);
  const excluir = lista(f.excluir);
  const municipio = U.semAcento(f.municipio || '').trim();

  let lista2 = [...brutos.values()].map(l => {
    const ad = aderencia(l.objeto + ' ' + l.info, f.palavras);
    return Object.assign(l, { nota: ad.nota, termos: ad.termos, dias: diasAte(l.encerramento),
                              naCarteira: !!carteira[l.id], status: carteira[l.id] ? carteira[l.id].status : null });
  });
  lista2 = lista2.filter(l =>
    l.nota >= notaMin &&
    (!valorMin || l.valor >= valorMin) && (!valorMax || l.valor <= valorMax) &&
    (!esferas.length || esferas.includes(l.esfera)) &&
    (prazoMin == null || (l.dias != null && l.dias >= prazoMin)) &&
    (!municipio || U.semAcento(l.municipio).includes(municipio)) &&
    (!excluir.length || !excluir.some(x => temTermo(' ' + U.semAcento(l.objeto) + ' ', x))));
  lista2.sort((a, b) => b.nota - a.nota || (b.valor - a.valor));

  const resultado = { quando: U.agoraISO(), filtros: f, modo, consultas, totalBruto: brutos.size, total: lista2.length, erros, itens: lista2.slice(0, 500) };
  U.gravar('ultima-busca.json', resultado);
  const hist = U.ler('buscas.json', []);
  hist.unshift({ quando: resultado.quando, modo, total: resultado.total, bruto: resultado.totalBruto, erros: erros.length, filtros: f });
  U.gravar('buscas.json', hist.slice(0, 50));
  return resultado;
}

/* ---------------- carteira ---------------- */
function carteira() {
  const c = U.ler('licitacoes.json', { itens: {} });
  return Object.values(c.itens).map(l => Object.assign(l, { dias: diasAte(l.encerramento) }))
    .sort((a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status) || (a.dias ?? 999) - (b.dias ?? 999));
}
function salvar(l, extra = {}) {
  const c = U.ler('licitacoes.json', { itens: {} });
  const atual = c.itens[l.id] || {};
  c.itens[l.id] = Object.assign({}, atual, l, extra, {
    status: extra.status || atual.status || 'nova', salvoEm: atual.salvoEm || U.agoraISO(), atualizadoEm: U.agoraISO()
  });
  U.gravar('licitacoes.json', c);
  return c.itens[l.id];
}
function atualizar(idL, campos) {
  const c = U.ler('licitacoes.json', { itens: {} });
  const l = c.itens[idL];
  if (!l) return null;
  for (const k of ['status', 'notas', 'responsavel', 'valorProposta', 'resultado']) if (k in campos) l[k] = campos[k];
  if (l.status && !STATUS.includes(l.status)) l.status = 'nova';
  l.atualizadoEm = U.agoraISO();
  U.gravar('licitacoes.json', c);
  return l;
}
function remover(idL) {
  const c = U.ler('licitacoes.json', { itens: {} });
  delete c.itens[idL]; U.gravar('licitacoes.json', c); return true;
}

/* ---------------- análise ---------------- */
const SINAIS = [
  { re: /prova de conceito|poc\b|amostra/i, txt: 'Exige prova de conceito/amostra — preparar demonstração', peso: -5 },
  { re: /atestado de capacidade t[ée]cnica|capacidade t[ée]cnica/i, txt: 'Exige atestado de capacidade técnica', peso: 0 },
  { re: /unidade de servi[çc]o t[ée]cnico|\bust\b/i, txt: 'Medido em UST — usar a calculadora de UST', peso: 5 },
  { re: /ponto[s]? de fun[çc][ãa]o|\bpf\b/i, txt: 'Medido em pontos de função', peso: 5 },
  { re: /sustenta[çc][ãa]o|manuten[çc][ãa]o corretiva|manuten[çc][ãa]o evolutiva/i, txt: 'Inclui sustentação — receita recorrente', peso: 5 },
  { re: /lgpd|prote[çc][ãa]o de dados/i, txt: 'Cobra LGPD/proteção de dados', peso: 0 },
  { re: /exclusiv[ao] (para )?(me|epp|microempresa)/i, txt: 'Exclusiva para ME/EPP — conferir enquadramento da V4', peso: 0 },
  { re: /visita t[ée]cnica/i, txt: 'Prevê visita técnica', peso: -3 },
  { re: /garantia contratual|seguro.garantia/i, txt: 'Pede garantia contratual', peso: -2 }
];

async function analisar(idL, comIA, aoProgresso) {
  const c = U.ler('licitacoes.json', { itens: {} });
  let l = c.itens[idL];
  if (!l) { const u = U.ler('ultima-busca.json', { itens: [] }).itens.find(x => x.id === idL); if (!u) throw new Error('licitação não encontrada'); l = salvar(u, { status: 'em análise' }); }
  const base = `${BASE()}/api/pncp/v1/orgaos/${l.cnpj}/compras/${l.ano}/${l.seq}`;
  let itens = [], arquivos = [], aviso = null;
  try {
    for (let pg = 1; pg <= 6; pg++) {
      const lote = (await U.baixarJSON(`${base}/itens?pagina=${pg}&tamanhoPagina=50`)) || [];
      itens.push(...lote.map(i => ({ n: i.numeroItem, descricao: i.descricao, qtd: i.quantidade, unidade: i.unidadeMedida,
        unitario: U.numJS(i.valorUnitarioEstimado), total: U.numJS(i.valorTotal), criterio: i.criterioJulgamentoNome,
        beneficio: i.tipoBeneficioNome, sigiloso: !!i.orcamentoSigiloso })));
      if (lote.length < 50) break;
    }
    arquivos = ((await U.baixarJSON(`${base}/arquivos`)) || []).filter(a => a.statusAtivo !== false)
      .map(a => ({ titulo: a.titulo, tipo: a.tipoDocumentoNome, url: a.url }));
  } catch (e) { aviso = 'Não consegui ler itens/arquivos no PNCP: ' + e.message; }

  const texto = [l.objeto, l.info, ...itens.map(i => i.descricao)].join(' \n ');
  const sinais = SINAIS.filter(s => s.re.test(texto));
  const dias = diasAte(l.encerramento);
  let nota = l.nota || aderencia(texto).nota;
  nota += sinais.reduce((s, x) => s + x.peso, 0);
  if (dias != null && dias < 3) nota -= 25; else if (dias != null && dias < 7) nota -= 10;
  if (l.valor >= 100000) nota += 5;
  nota = Math.max(0, Math.min(100, nota));
  const recomendacao = dias != null && dias < 0 ? 'prazo encerrado' : nota >= 60 ? 'disputar' : nota >= 35 ? 'avaliar com o time' : 'descartar';
  const checklist = [
    'Ler edital e termo de referência completos', 'Certidões negativas válidas até a data da sessão',
    'Atestados de capacidade técnica compatíveis com o objeto', 'Planilha de custos (UST/PF/horas) e BDI',
    'Declarações exigidas (ME/EPP, menor, idoneidade)', 'Cadastro ativo no portal da disputa'
  ];
  if (sinais.some(s => /prova de conceito/i.test(s.txt))) checklist.push('Ensaiar a prova de conceito com o Diego (pré-vendas)');
  if (sinais.some(s => /garantia/i.test(s.txt))) checklist.push('Cotar seguro-garantia com a Mônica (controladoria)');

  const analise = { quando: U.agoraISO(), dias, nota, recomendacao, sinais: sinais.map(s => s.txt), itens: itens.slice(0, 200),
                    totalItens: itens.length, arquivos, checklist, aviso, ia: null };

  if (comIA) {
    aoProgresso && aoProgresso('a analista Helena está lendo o edital…');
    const prompt = `Você é a Helena, analista de editais da V4 fábricagov (softhouse que desenvolve software para órgãos públicos).
Analise esta contratação do PNCP e diga se a V4 deve disputar. Se conseguir, abra os arquivos oficiais (links abaixo, todos em pncp.gov.br) para ler o edital/termo de referência.

DADOS:
${JSON.stringify({ orgao: l.orgao, uf: l.uf, municipio: l.municipio, modalidade: l.modalidade, objeto: l.objeto, info: l.info,
  valorEstimado: l.valor, srp: l.srp, abertura: l.abertura, encerramento: l.encerramento, linkEdital: l.link,
  itens: itens.slice(0, 40), arquivos: arquivos.slice(0, 8), sinaisDetectados: analise.sinais }, null, 1)}

Responda SOMENTE com um JSON neste formato:
{"parecer":"disputar|avaliar|descartar","resumo":"3 a 5 frases","exigencias":["..."],"riscos":["..."],"prazos":["..."],"estimativaUST":número ou null,"equipeSugerida":["função: motivo"],"perguntasEsclarecimento":["..."]}
Não invente dados: se algo não estiver nos documentos, diga que não encontrou.`;
    const r = await IA.rodar({ prompt, modo: 'plan', ferramentas: ['WebFetch'], limiteMs: 6 * 60000,
      aoEvento: ev => { const d = IA.descreverEvento(ev); if (d && aoProgresso) aoProgresso(d.join(' · ')); } });
    analise.ia = r.ok ? (IA.extrairJSON(r.texto) || { resumo: r.texto }) : { erro: r.motivo };
    if (r.ok) analise.custoIA = r.custo;
  }
  const atual = U.ler('licitacoes.json', { itens: {} });
  atual.itens[idL] = Object.assign(atual.itens[idL] || l, { analise, nota, status: (atual.itens[idL] || l).status === 'nova' ? 'em análise' : (atual.itens[idL] || l).status });
  U.gravar('licitacoes.json', atual);
  return atual.itens[idL];
}

/* ---------------- radar diário ---------------- */
const RADAR_PADRAO = { ativo: false, hora: 7, minuto: 0, dias: [1, 2, 3, 4, 5], notaMin: 40,
                       filtros: { modo: 'abertas', modalidades: [6, 4, 8], ufs: [], diasAFrente: 45, notaMin: 40 },
                       ultimo: null, vistos: [] };
const radar = () => Object.assign({}, RADAR_PADRAO, U.ler('radar.json', {}));
function configurarRadar(c) {
  const r = radar();
  for (const k of ['ativo', 'hora', 'minuto', 'dias', 'notaMin', 'filtros']) if (k in c) r[k] = c[k];
  return U.gravar('radar.json', r);
}
let rodandoRadar = false;
async function rodarRadar(avisar) {
  if (rodandoRadar) return { ok: false, motivo: 'radar já está rodando' };
  rodandoRadar = true;
  try {
    const r = radar();
    const res = await buscar(Object.assign({}, r.filtros, { notaMin: r.notaMin }));
    const vistos = new Set(r.vistos || []);
    const novas = res.itens.filter(l => !vistos.has(l.id));
    novas.forEach(l => vistos.add(l.id));
    r.vistos = [...vistos].slice(-5000);
    r.ultimo = { quando: U.agoraISO(), novas: novas.length, total: res.total, erros: res.erros.length };
    U.gravar('radar.json', r);
    if (novas.length && avisar) {
      const txt = novas.slice(0, 8).map((l, i) => `${i + 1}. [${l.nota}] ${l.orgao} (${l.uf}) — ${l.objeto.slice(0, 120)} · ${U.brl(l.valor)}${l.dias != null ? ' · ' + l.dias + ' dias' : ''}\n${l.link}`).join('\n\n');
      await avisar('Radar V4: ' + novas.length + ' licitação(ões) nova(s)', txt);
    }
    return { ok: true, novas, resultado: r.ultimo };
  } finally { rodandoRadar = false; }
}
function agendarRadar(avisar) {
  let ultimaChave = null;
  setInterval(() => {
    const r = radar(); if (!r.ativo) return;
    const d = new Date();
    if (!r.dias.includes(d.getDay()) || d.getHours() !== Number(r.hora) || d.getMinutes() < Number(r.minuto)) return;
    const chave = d.toISOString().slice(0, 10);
    if (ultimaChave === chave || (r.ultimo && r.ultimo.quando.slice(0, 10) === chave)) return;
    ultimaChave = chave;
    rodarRadar(avisar).catch(e => console.error('  radar falhou:', e.message));
  }, 60000);
}

module.exports = { MODALIDADES, ESFERAS, STATUS, PERFIL_PADRAO, perfil, aderencia, normalizar, buscar, carteira, salvar,
                   atualizar, remover, analisar, radar, configurarRadar, rodarRadar, agendarRadar, diasAte };
