/* ===========================================================
   painel/whatsapp.js — robô de licitações no WhatsApp

   Usa a WhatsApp Cloud API oficial da Meta. Precisa de:
     token de acesso, ID do número, App Secret, token de verificação
     e a versão da Graph API (ex.: v21.0 — confira a vigente na Meta).
   O webhook (/webhook/whatsapp) precisa de um endereço público com HTTPS
   apontando para este computador (ex.: Cloudflare Tunnel ou ngrok).

   Segurança: só números AUTORIZADOS (o seu, o do time) consultam dados da
   V4. Qualquer outro número recebe a resposta automática configurada e a
   mensagem fica registrada para alguém do comercial responder. O robô
   responde por comandos fixos — mensagem de terceiro nunca vira ordem
   para um agente de IA nesta máquina.
   =========================================================== */
const crypto = require('crypto');
const U = require('./util');

let D = null;   // { licitacoes, fabrica, ust, financeiro, equipe }
function init(dep) { D = dep; }

const PADRAO = { ativo: false, token: '', phoneId: '', appSecret: '', verifyToken: '', versao: 'v21.0', autorizados: [],
  respostaPublica: 'Olá! Você falou com a V4 fábricagov, softhouse para órgãos públicos. Recebemos sua mensagem e nossa equipe responde em breve, em horário comercial.' };
const config = () => Object.assign({}, PADRAO, U.ler('whatsapp.json', {}));
const soDig = s => String(s || '').replace(/\D/g, '');

function configurar(b) {
  const c = config();
  for (const k of ['ativo', 'phoneId', 'verifyToken', 'versao', 'respostaPublica']) if (k in b) c[k] = typeof c[k] === 'boolean' ? !!b[k] : String(b[k]).slice(0, 600);
  // segredos só são trocados quando vêm preenchidos (a tela não recebe o valor de volta)
  if (b.token) c.token = String(b.token).trim();
  if (b.appSecret) c.appSecret = String(b.appSecret).trim();
  if ('autorizados' in b) c.autorizados = (Array.isArray(b.autorizados) ? b.autorizados : String(b.autorizados).split(/[,\n;]/)).map(soDig).filter(x => x.length >= 10);
  U.gravar('whatsapp.json', c);
  return publico();
}
function publico() {
  const c = config();
  const falta = [['token', 'token de acesso'], ['phoneId', 'ID do número'], ['appSecret', 'App Secret'], ['verifyToken', 'token de verificação'], ['versao', 'versão da Graph API']]
    .filter(([k]) => !c[k]).map(([, n]) => n);
  return { ativo: c.ativo, phoneId: c.phoneId, verifyToken: c.verifyToken, versao: c.versao, autorizados: c.autorizados,
           respostaPublica: c.respostaPublica, temToken: !!c.token, temSegredo: !!c.appSecret, falta, pronto: !falta.length };
}

const log = () => U.ler('whatsapp-log.json', []);
function registrar(m) { const l = log(); l.unshift(Object.assign({ quando: U.agoraISO() }, m)); U.gravar('whatsapp-log.json', l.slice(0, 400)); }

async function enviar(para, texto) {
  const c = config();
  if (!publico().pronto) throw new Error('WhatsApp não configurado: falta ' + publico().falta.join(', '));
  const r = await U.postarJSON(`https://graph.facebook.com/${c.versao}/${c.phoneId}/messages`,
    { messaging_product: 'whatsapp', to: soDig(para), type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false } },
    { Authorization: 'Bearer ' + c.token });
  registrar({ dir: 'saiu', numero: soDig(para), texto: String(texto).slice(0, 1000) });
  return r;
}

function verificarAssinatura(bruto, cabecalho) {
  const c = config();
  if (!c.appSecret || !cabecalho || !cabecalho.startsWith('sha256=')) return false;
  const esperado = crypto.createHmac('sha256', c.appSecret).update(bruto).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(cabecalho.slice(7));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** GET de verificação que a Meta faz ao cadastrar o webhook */
function verificarWebhook(q) {
  const c = config();
  if (q.get('hub.mode') === 'subscribe' && c.verifyToken && q.get('hub.verify_token') === c.verifyToken) return q.get('hub.challenge');
  return null;
}

function extrair(payload) {
  const out = [];
  for (const e of (payload && payload.entry) || []) for (const ch of e.changes || []) {
    const v = ch.value || {};
    const nomes = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));
    for (const m of v.messages || []) out.push({ de: m.from, nome: nomes[m.from] || '', texto: (m.text && m.text.body) || (m.button && m.button.text) || '', tipo: m.type, id: m.id });
  }
  return out;
}

/* ---------- respostas ---------- */
let ultimaLista = new Map();   // número -> ids da última lista mostrada
const linhaLic = (l, i) => `${i + 1}. [${l.nota ?? '–'}] ${l.orgao} (${l.municipio ? l.municipio + '/' : ''}${l.uf})\n${(l.objeto || '').slice(0, 150)}\n💰 ${U.brl(l.valor)}${l.dias != null ? ' · ⏳ ' + l.dias + ' dia(s)' : ''}${l.status ? ' · ' + l.status : ''}\n${l.link}`;

async function responder(numero, texto) {
  const t = U.semAcento(texto).trim();
  const AJUDA = 'V4 fábricagov — comandos:\n• licitacoes — melhores da última busca\n• buscar <palavras> — busca agora no PNCP\n• carteira — licitações que estamos acompanhando\n• detalhe <nº> — detalhes de um item da última lista\n• radar — roda o radar agora\n• fabrica — sistemas em construção\n• ust — consumo dos contratos\n• caixa — resumo financeiro';
  if (!t || /^(oi|ola|menu|ajuda|help|\?)/.test(t)) return AJUDA;

  if (/^licita/.test(t)) {
    const u = U.ler('ultima-busca.json', { itens: [] });
    const top = u.itens.slice(0, 5);
    ultimaLista.set(numero, top.map(l => l.id));
    return top.length ? `Top ${top.length} da última busca (${new Date(u.quando).toLocaleString('pt-BR')}):\n\n` + top.map(linhaLic).join('\n\n') : 'Nenhuma busca ainda. Mande: buscar software';
  }
  if (/^buscar\b/.test(t)) {
    const palavras = t.replace(/^buscar\s*/, '').split(/\s+/).filter(Boolean).join(',');
    const r = await D.licitacoes.buscar({ modo: 'abertas', palavras, modalidades: [6, 4, 8], notaMin: palavras ? 0 : 30, maxPaginas: 4 });
    const top = r.itens.slice(0, 5);
    ultimaLista.set(numero, top.map(l => l.id));
    return `Busca no PNCP${palavras ? ' por "' + palavras.replace(/,/g, ' ') + '"' : ''}: ${r.total} encontrada(s)${r.erros.length ? ' (' + r.erros.length + ' consulta(s) falharam)' : ''}.\n\n` + (top.map(linhaLic).join('\n\n') || 'Nada com esse filtro.');
  }
  if (/^carteira/.test(t)) {
    const c = D.licitacoes.carteira().filter(l => !['descartada', 'perdemos'].includes(l.status)).slice(0, 8);
    ultimaLista.set(numero, c.map(l => l.id));
    return c.length ? 'Carteira V4:\n\n' + c.map(linhaLic).join('\n\n') : 'Carteira vazia.';
  }
  const md = t.match(/^detalhe\s+(\d+)/);
  if (md) {
    const ids = ultimaLista.get(numero) || [];
    const idL = ids[Number(md[1]) - 1];
    const l = idL && (D.licitacoes.carteira().find(x => x.id === idL) || U.ler('ultima-busca.json', { itens: [] }).itens.find(x => x.id === idL));
    if (!l) return 'Não achei esse número. Peça "licitacoes" ou "carteira" antes.';
    const a = l.analise;
    return `${l.orgao} — ${l.modalidade} ${l.numero || ''}\n${l.objeto}\n\n💰 Estimado: ${U.brl(l.valor)}\n📅 Propostas até: ${l.encerramento ? new Date(l.encerramento).toLocaleString('pt-BR') : '—'}\n📍 ${l.municipio || ''}/${l.uf}${l.srp ? '\n🗂️ Registro de preços' : ''}` +
      (a ? `\n\n🔎 Análise: ${a.recomendacao} (nota ${a.nota})\n` + (a.sinais || []).map(s => '• ' + s).join('\n') + (a.ia && a.ia.resumo ? '\n\n' + a.ia.resumo : '') : '') + `\n\n${l.link}`;
  }
  if (/^radar/.test(t)) {
    const r = await D.licitacoes.rodarRadar();
    if (!r.ok) return r.motivo;
    return r.novas.length ? `Radar: ${r.novas.length} nova(s).\n\n` + r.novas.slice(0, 5).map(linhaLic).join('\n\n') : 'Radar rodou: nenhuma licitação nova desde a última vez.';
  }
  if (/^fabrica/.test(t)) {
    const ps = D.fabrica.lista().slice(0, 8);
    return ps.length ? 'Fábrica V4:\n' + ps.map(p => `• ${p.nome} — ${p.status}${p.ust ? ' · ' + p.ust + ' UST' : ''}${p.testes ? ' · testes ' + (p.testes.ok ? 'ok' : 'falhando') : ''}`).join('\n') : 'Nenhum sistema pedido ainda.';
  }
  if (/^ust/.test(t)) {
    const e = D.ust.estado();
    if (!e.contratos.length) return 'Nenhum contrato de UST cadastrado.';
    return 'UST por contrato:\n' + e.contratos.map(c => {
      try { const r = D.ust.distribuir(c.id, D.equipe()); return `• ${c.nome}: ${r.usado}/${r.teto} UST (${r.percentual}%) · faltam ${r.falta}`; }
      catch (x) { return '• ' + c.nome + ': ' + x.message; }
    }).join('\n');
  }
  if (/^(caixa|financeiro|saldo)/.test(t)) {
    const r = D.financeiro.resumo();
    return `Caixa V4:\nSaldo atual: ${U.brl(r.saldo)}\nA receber: ${U.brl(r.aReceber)}\nA pagar: ${U.brl(r.aPagar)}\nProjetado: ${U.brl(r.saldoProjetado)}`;
  }
  return 'Não entendi. ' + AJUDA;
}

/** POST do webhook: confere assinatura, responde cada mensagem */
async function receber(bruto, cabecalho) {
  if (!verificarAssinatura(bruto, cabecalho)) return { ok: false, codigo: 401, motivo: 'assinatura inválida' };
  let payload; try { payload = JSON.parse(bruto.toString('utf8')); } catch (e) { return { ok: false, codigo: 400, motivo: 'json inválido' }; }
  const c = config();
  const msgs = extrair(payload);
  // a Meta quer 200 rápido; as respostas seguem em segundo plano
  setImmediate(async () => {
    for (const m of msgs) {
      const autorizado = c.autorizados.includes(soDig(m.de));
      registrar({ dir: 'entrou', numero: m.de, nome: m.nome, texto: m.texto, autorizado });
      if (!c.ativo) continue;
      try {
        const resp = autorizado ? await responder(m.de, m.texto) : c.respostaPublica;
        if (resp) await enviar(m.de, resp);
      } catch (e) { registrar({ dir: 'erro', numero: m.de, texto: e.message }); }
    }
  });
  return { ok: true, codigo: 200, mensagens: msgs.length };
}

module.exports = { init, config, configurar, publico, enviar, verificarWebhook, receber, responder, extrair, log, verificarAssinatura };
