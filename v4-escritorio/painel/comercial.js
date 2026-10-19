/* ===========================================================
   painel/comercial.js — contatos de órgãos e prefeituras

   Só dados institucionais e públicos:
     · CNPJ do órgão  → cadastro da Receita Federal (via BrasilAPI):
                        e-mail, telefone e endereço que o próprio órgão declarou
     · municípios     → lista oficial do IBGE
     · prefeitos      → dados abertos do TSE (candidatos eleitos), importados
                        por arquivo — o TSE não publica e-mail nem telefone
   Nada de raspar redes sociais ou contato pessoal: LGPD.
   =========================================================== */
const U = require('./util');
const IA = require('./ia');

const BRASILAPI = () => (process.env.V4_BRASILAPI_BASE || 'https://brasilapi.com.br').replace(/\/$/, '');
const IBGE = () => (process.env.V4_IBGE_BASE || 'https://servicodados.ibge.gov.br').replace(/\/$/, '');
const STATUS = ['novo', 'contatado', 'em negociação', 'cliente', 'sem interesse'];

const ler = () => U.ler('contatos.json', { itens: {} });
const so = s => String(s || '').replace(/\D/g, '');
const chaveMun = (mun, uf) => U.semAcento(mun).replace(/[^a-z0-9]/g, '') + '-' + String(uf || '').toUpperCase();

function todos(f = {}) {
  const q = U.semAcento(f.q || '');
  return Object.values(ler().itens).filter(c =>
    (!f.uf || c.uf === f.uf) && (!f.tipo || c.tipo === f.tipo) && (!f.status || c.status === f.status) &&
    (!f.comEmail || c.email) &&
    (!q || U.semAcento([c.nome, c.municipio, c.prefeito, c.email].join(' ')).includes(q)))
    .sort((a, b) => (a.uf + a.municipio + a.nome).localeCompare(b.uf + b.municipio + b.nome));
}

function gravarContato(c) {
  const d = ler();
  const id = c.id || (c.cnpj ? 'cnpj-' + so(c.cnpj) : 'pref-' + chaveMun(c.municipio, c.uf));
  d.itens[id] = Object.assign({ status: 'novo', criadoEm: U.agoraISO() }, d.itens[id] || {}, c, { id, atualizadoEm: U.agoraISO() });
  U.gravar('contatos.json', d);
  return d.itens[id];
}
function atualizar(id, campos) {
  const d = ler(); const c = d.itens[id]; if (!c) return null;
  for (const k of ['status', 'notas', 'email', 'telefone', 'prefeito', 'responsavel', 'site']) if (k in campos) c[k] = campos[k];
  c.atualizadoEm = U.agoraISO(); U.gravar('contatos.json', d); return c;
}
function remover(id) { const d = ler(); delete d.itens[id]; U.gravar('contatos.json', d); return true; }

/** cadastro público do CNPJ */
async function consultarCNPJ(cnpj) {
  const n = so(cnpj);
  if (n.length !== 14) throw new Error('CNPJ precisa ter 14 dígitos');
  const r = await U.baixarJSON(`${BRASILAPI()}/api/cnpj/v1/${n}`, { timeout: 30000 });
  const tel = [r.ddd_telefone_1, r.ddd_telefone_2].filter(Boolean).map(t => String(t).replace(/^(\d{2})(\d+)/, '($1) $2'));
  return {
    cnpj: n, nome: r.razao_social || r.nome_fantasia || '', email: (r.email || '').toLowerCase(), telefone: tel.join(' / '),
    endereco: [r.descricao_tipo_de_logradouro, r.logradouro, r.numero, r.complemento, r.bairro].filter(Boolean).join(' ') +
              (r.cep ? ' · CEP ' + r.cep : ''),
    municipio: r.municipio || '', uf: r.uf || '', natureza: r.natureza_juridica || '', situacao: r.descricao_situacao_cadastral || '',
    fonte: 'Receita Federal (BrasilAPI)', consultadoEm: U.agoraISO()
  };
}

/** traz para a lista os órgãos que aparecem na carteira e na última busca, e completa pela Receita */
async function importarDosEditais(fontes, limite = 40, aoProgresso) {
  const vistos = new Map();
  for (const l of fontes) if (l.cnpj && !vistos.has(l.cnpj)) vistos.set(l.cnpj, l);
  const d = ler();
  const pendentes = [...vistos.values()].filter(l => !d.itens['cnpj-' + so(l.cnpj)] || !d.itens['cnpj-' + so(l.cnpj)].consultadoEm).slice(0, limite);
  let ok = 0; const erros = [];
  for (const [i, l] of pendentes.entries()) {
    aoProgresso && aoProgresso(`consultando ${i + 1}/${pendentes.length}: ${l.orgao}`);
    const base = { tipo: l.esfera === 'Municipal' ? 'prefeitura' : 'orgao', cnpj: so(l.cnpj), nome: l.orgao, uf: l.uf,
                   municipio: l.municipio, ibge: l.ibge, esfera: l.esfera, origem: 'edital ' + (l.numero || l.id) };
    try { Object.assign(base, await consultarCNPJ(l.cnpj)); ok++; }
    catch (e) { erros.push(l.orgao + ': ' + e.message); }
    base.tipo = /munic[ií]pio|prefeitura|c[aâ]mara municipal/i.test(base.nome) ? 'prefeitura' : base.tipo;
    gravarContato(base);
    await new Promise(r => setTimeout(r, 400));     // educação com a API pública
  }
  return { consultados: pendentes.length, ok, erros, semConsulta: Math.max(0, vistos.size - pendentes.length) };
}

/** municípios de uma UF pelo IBGE, viram fichas de prefeitura */
async function importarMunicipios(uf) {
  uf = String(uf || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF inválida');
  const lista = await U.baixarJSON(`${IBGE()}/api/v1/localidades/estados/${uf}/municipios`);
  let n = 0;
  for (const m of lista || []) {
    gravarContato({ tipo: 'prefeitura', nome: 'Prefeitura Municipal de ' + m.nome, municipio: m.nome, uf, ibge: String(m.id), fonte: 'IBGE' });
    n++;
  }
  return { uf, municipios: n };
}

/**
 * Arquivo de candidatos do TSE (dadosabertos.tse.jus.br → Candidatos 2024 → consulta_cand_2024_UF.csv).
 * Vem em latin1 com ;. Aproveita só PREFEITO eleito (e vice).
 */
function importarTSE(buf) {
  const texto = buf.toString('latin1');
  const linhas = U.lerCSV(texto);
  if (!linhas.length) throw new Error('arquivo vazio');
  const cab = linhas[0].map(c => c.trim().toUpperCase());
  const col = n => cab.indexOf(n);
  const iUF = col('SG_UF'), iUE = col('NM_UE'), iCargo = col('DS_CARGO'), iNome = col('NM_URNA_CANDIDATO'),
        iNomeC = col('NM_CANDIDATO'), iPart = col('SG_PARTIDO'), iSit = col('DS_SIT_TOT_TURNO');
  if ([iUF, iUE, iCargo, iSit].some(i => i < 0)) throw new Error('não parece o arquivo de candidatos do TSE (faltam SG_UF, NM_UE, DS_CARGO, DS_SIT_TOT_TURNO)');
  let prefeitos = 0, vices = 0;
  for (const l of linhas.slice(1)) {
    const sit = (l[iSit] || '').toUpperCase(), cargo = (l[iCargo] || '').toUpperCase();
    if (!/^ELEITO/.test(sit)) continue;
    const mun = l[iUE] ? l[iUE].replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()) : '';
    const base = { tipo: 'prefeitura', municipio: mun, uf: l[iUF], nome: 'Prefeitura Municipal de ' + mun };
    if (cargo === 'PREFEITO') {
      gravarContato(Object.assign(base, { prefeito: (l[iNome] || l[iNomeC] || '').trim(), partido: l[iPart] || '', fontePrefeito: 'TSE — eleitos' }));
      prefeitos++;
    } else if (cargo === 'VICE-PREFEITO') {
      gravarContato(Object.assign(base, { vice: (l[iNome] || l[iNomeC] || '').trim() })); vices++;
    }
  }
  return { prefeitos, vices };
}

/** rascunho de e-mail de apresentação para um contato (o envio é seu) */
async function abordagem(id) {
  const c = ler().itens[id];
  if (!c) throw new Error('contato não encontrado');
  const editais = U.ler('licitacoes.json', { itens: {} });
  const relacionados = Object.values(editais.itens).filter(l => so(l.cnpj) === so(c.cnpj)).slice(0, 5)
    .map(l => ({ objeto: l.objeto, status: l.status, encerramento: l.encerramento }));
  const prompt = `Você é a Natália, do relacionamento com órgãos públicos da V4 fábricagov Ltda (softhouse que desenvolve sistemas web, apps, integrações gov.br, BI e sustentação para o setor público).
Escreva um e-mail curto e respeitoso de apresentação institucional para este órgão. Tom formal, sem promessas de vantagem, sem pedir reunião fora dos canais oficiais, lembrando que contratações seguem a Lei 14.133.
Órgão: ${JSON.stringify({ nome: c.nome, municipio: c.municipio, uf: c.uf, prefeito: c.prefeito || null, editaisRelacionados: relacionados })}
Responda só com o e-mail: primeira linha "Assunto: ...", depois o corpo, assinado por "Natália — Relacionamento Institucional, V4 fábricagov".`;
  const r = await IA.consultar(prompt, { limiteMs: 3 * 60000 });
  if (!r.ok) throw new Error(r.motivo);
  atualizar(id, {}); const d = ler(); d.itens[id].rascunho = r.texto; U.gravar('contatos.json', d);
  return { texto: r.texto };
}

function exportarCSV(f) {
  return U.csv(todos(f), [
    { titulo: 'Tipo', v: 'tipo' }, { titulo: 'Nome', v: 'nome' }, { titulo: 'CNPJ', v: 'cnpj' }, { titulo: 'UF', v: 'uf' },
    { titulo: 'Município', v: 'municipio' }, { titulo: 'Prefeito(a)', v: 'prefeito' }, { titulo: 'Partido', v: 'partido' },
    { titulo: 'E-mail institucional', v: 'email' }, { titulo: 'Telefone', v: 'telefone' }, { titulo: 'Endereço', v: 'endereco' },
    { titulo: 'Status', v: 'status' }, { titulo: 'Notas', v: 'notas' }, { titulo: 'Fonte', v: c => [c.fonte, c.fontePrefeito].filter(Boolean).join(' + ') }
  ]);
}

module.exports = { STATUS, todos, gravarContato, atualizar, remover, consultarCNPJ, importarDosEditais, importarMunicipios, importarTSE, abordagem, exportarCSV };
