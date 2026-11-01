/* CHINA TRADE & MARKET INTELLIGENCE — aplicação web.
   Funciona em três modos de armazenamento, escolhidos sozinhos ao abrir:
   - claude: página hospedada no claude.ai, dados no banco do artefato (só você e editores leem);
   - api:    servida pelo backend FastAPI (login, PostgreSQL, cotações ao vivo por WebSocket);
   - local:  navegador comum, dados no localStorage deste aparelho.
   Nenhuma cotação é inventada: sem fonte, a tela mostra "sem dados". */
"use strict";

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const agora = () => new Date().toISOString();
const hoje = () => new Date().toISOString().slice(0, 10);
const n = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
const fmtN = (v, d = 2) => (v == null || isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(+v));
function moeda(v, cur = "BRL") {
  if (v == null || isNaN(v)) return "—";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur, maximumFractionDigits: cur === "JPY" ? 0 : 2 }).format(+v); }
  catch { return cur + " " + fmtN(v); }
}
const pct = (v, d = 2) => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + fmtN(v, d) + "%");
const cls = (v) => (v > 0 ? "alta" : v < 0 ? "queda" : "");
function dataBR(iso, hora = true) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleString("pt-BR", hora && iso.length > 10 ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" });
}
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const linkSeguro = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("#toasts").append(el); setTimeout(() => el.remove(), 4200);
}
const NO_ARTEFATO = !!(window.claude && window.claude.use);
async function cap(nome) {
  if (!NO_ARTEFATO) return null;
  try { return await window.claude.use(nome); } catch { return null; }
}

// ---------- catálogos ----------
const PLATAFORMAS = ["1688", "Alibaba", "AliExpress", "Made-in-China", "Global Sources", "DHgate", "Taobao", "Outra"];
const STATUS = ["pesquisando", "negociando", "cotado", "aprovado", "comprado", "descartado"];
const CLASSES = { acao_br: "Ações B3", acao_us: "Ações EUA", indice: "Índices", etf: "ETFs e fundos", cripto: "Criptomoedas", moeda: "Moedas" };
const UNIVERSO = [
  ["PETR4", "Petrobras PN", "acao_br", "BRL"], ["VALE3", "Vale ON", "acao_br", "BRL"], ["ITUB4", "Itaú Unibanco PN", "acao_br", "BRL"],
  ["BBDC4", "Bradesco PN", "acao_br", "BRL"], ["BBAS3", "Banco do Brasil ON", "acao_br", "BRL"], ["WEGE3", "WEG ON", "acao_br", "BRL"],
  ["ABEV3", "Ambev ON", "acao_br", "BRL"], ["MGLU3", "Magazine Luiza ON", "acao_br", "BRL"],
  ["AAPL", "Apple", "acao_us", "USD"], ["NVDA", "NVIDIA", "acao_us", "USD"], ["MSFT", "Microsoft", "acao_us", "USD"],
  ["TSLA", "Tesla", "acao_us", "USD"], ["AMZN", "Amazon", "acao_us", "USD"], ["GOOGL", "Alphabet", "acao_us", "USD"], ["META", "Meta", "acao_us", "USD"],
  ["IBOV", "Ibovespa", "indice", "pts"], ["SPX", "S&P 500", "indice", "pts"], ["IXIC", "Nasdaq Composite", "indice", "pts"], ["DJI", "Dow Jones", "indice", "pts"],
  ["BOVA11", "iShares Ibovespa", "etf", "BRL"], ["IVVB11", "iShares S&P 500 (BRL)", "etf", "BRL"], ["SPY", "SPDR S&P 500", "etf", "USD"], ["QQQ", "Invesco QQQ", "etf", "USD"],
  ["BTC", "Bitcoin", "cripto", "USD"], ["ETH", "Ethereum", "cripto", "USD"], ["SOL", "Solana", "cripto", "USD"], ["BNB", "BNB", "cripto", "USD"], ["XRP", "XRP", "cripto", "USD"],
  ["USDBRL", "Dólar americano", "moeda", "BRL"], ["EURBRL", "Euro", "moeda", "BRL"], ["CNYBRL", "Yuan chinês", "moeda", "BRL"],
  ["GBPBRL", "Libra esterlina", "moeda", "BRL"], ["JPYBRL", "Iene japonês", "moeda", "BRL"], ["CHFBRL", "Franco suíço", "moeda", "BRL"], ["ARSBRL", "Peso argentino", "moeda", "BRL"],
].map(([id, nome, classe, m]) => ({ id, simbolo: id, nome, classe, moeda: m }));
const MOEDAS = ["BRL", "USD", "CNY", "EUR", "GBP", "JPY", "CHF", "ARS"];
const COLS = ["produtos", "fornecedores", "contatos", "tarefas", "clientes", "vendas", "links", "watchlist", "carteira", "paper",
  "alertas", "alertas_log", "conversoes", "cotacoes", "tendencias", "agentes_log", "auditoria", "config"];

const CFG_PADRAO = {
  ii_pct: 16, ipi_pct: 10, pis_pct: 2.1, cofins_pct: 9.65, icms_pct: 18, siscomex_brl: 154.23, afrmm_pct: 8, despesas_pct: 3,
  remessa_icms_pct: 17, remessa_ii_ate50_pct: 20, remessa_ii_acima50_pct: 60, remessa_deducao_usd: 20,
  spread_pct: 1, tarifa_fixa_brl: 0, iof_pct: 1.1, taxa_canal_pct: 16, cambio_manual: {},
};

// ---------- esquemas dos cadastros ----------
const f = (k, l, t = "text", x = {}) => ({ k, l, t, ...x });
const S = {
  produtos: { nome: "Produto", titulo: (d) => d.nome, campos: [
    f("nome", "Nome do produto", "text", { req: 1 }), f("nome_cn", "Nome em chinês / inglês"), f("link", "Link original", "url"),
    f("imagem", "Imagem (URL)", "url"), f("plataforma", "Plataforma", "select", { op: PLATAFORMAS }), f("fornecedor_id", "Fornecedor", "ref", { col: "fornecedores" }),
    f("pais", "País de origem", "text", { pad: "China" }), f("categoria", "Categoria"),
    f("preco_origem", "Preço observado (unidade)", "number"), f("moeda", "Moeda do preço", "select", { op: ["CNY", "USD", "EUR", "BRL"], pad: "CNY" }),
    f("moq", "Quantidade mínima (MOQ)", "number"), f("qtd_lote", "Quantidade do lote (planejada ou comprada)", "number"),
    f("frete_total", "Frete internacional do lote", "number"), f("frete_moeda", "Moeda do frete", "select", { op: ["USD", "CNY", "BRL"], pad: "USD" }),
    f("modal", "Modal", "select", { op: ["maritimo", "aereo", "courier"], pad: "maritimo" }), f("regime", "Regime de importação", "select", { op: ["formal", "remessa"], rot: { formal: "Importação formal (empresa)", remessa: "Remessa Conforme (pessoa física)" }, pad: "formal" }),
    f("ncm", "NCM"), f("ii_pct", "II específico do NCM (%) — vazio usa o padrão", "number"),
    f("preco_venda_br", "Preço de venda no Brasil (R$/un.)", "number"), f("link_ref_br", "Link do preço de referência no Brasil", "url"),
    f("status", "Status", "select", { op: STATUS, pad: "pesquisando" }), f("etapa", "Etapa da negociação"),
    f("proxima_tarefa", "Próxima tarefa"), f("lembrete", "Lembrete", "date"), f("tags", "Etiquetas (separe por vírgula)", "tags"),
    f("notas", "Anotações privadas", "textarea"), f("anexos", "Documentos anexados", "anexos"),
  ] },
  fornecedores: { nome: "Fornecedor", titulo: (d) => d.nome, campos: [
    f("nome", "Empresa", "text", { req: 1 }), f("contato_nome", "Nome do contato"), f("email", "E-mail"), f("whatsapp", "WhatsApp / telefone"),
    f("wechat", "WeChat"), f("pais", "País", "text", { pad: "China" }), f("cidade", "Cidade / província"),
    f("plataforma", "Plataforma", "select", { op: PLATAFORMAS }), f("link", "Link da loja", "url"), f("imagem", "Logo (URL)", "url"),
    f("anos", "Anos na plataforma", "number"), f("verificado", "Fornecedor verificado / Gold", "bool"), f("avaliacao", "Minha avaliação (1–5)", "number"),
    f("status", "Status", "select", { op: STATUS, pad: "pesquisando" }), f("tags", "Etiquetas", "tags"), f("notas", "Anotações privadas", "textarea"),
    f("anexos", "Documentos anexados", "anexos"),
  ] },
  contatos: { nome: "Contato registrado", titulo: (d) => d.resumo, campos: [
    f("data", "Data", "date", { pad: hoje, req: 1 }), f("fornecedor_id", "Fornecedor", "ref", { col: "fornecedores" }), f("produto_id", "Produto", "ref", { col: "produtos" }),
    f("canal", "Canal", "select", { op: ["WhatsApp", "WeChat", "E-mail", "Chat da plataforma", "Telefone", "Feira", "Outro"] }),
    f("direcao", "Quem falou", "select", { op: ["enviado", "recebido"], rot: { enviado: "Eu enviei", recebido: "Fornecedor respondeu" } }),
    f("resumo", "Resumo", "textarea", { req: 1 }),
  ] },
  tarefas: { nome: "Tarefa", titulo: (d) => d.titulo, campos: [
    f("titulo", "Tarefa", "text", { req: 1 }), f("prazo", "Prazo", "date"), f("produto_id", "Produto", "ref", { col: "produtos" }),
    f("fornecedor_id", "Fornecedor", "ref", { col: "fornecedores" }), f("feita", "Concluída", "bool"),
  ] },
  clientes: { nome: "Cliente", titulo: (d) => d.nome, campos: [
    f("nome", "Nome", "text", { req: 1 }), f("documento", "CPF / CNPJ"), f("email", "E-mail"), f("telefone", "Telefone / WhatsApp"),
    f("cidade", "Cidade / UF"), f("canal", "Origem", "select", { op: ["Mercado Livre", "Shopee", "Amazon", "Loja própria", "Instagram", "Atacado", "Outro"] }),
    f("notas", "Anotações", "textarea"),
  ] },
  vendas: { nome: "Venda", titulo: (d) => (nomeDe("produtos", d.produto_id) || "Venda") + " × " + (d.qtd || 0), campos: [
    f("data", "Data", "date", { pad: hoje, req: 1 }), f("produto_id", "Produto", "ref", { col: "produtos", req: 1 }), f("cliente_id", "Cliente", "ref", { col: "clientes" }),
    f("qtd", "Quantidade", "number", { req: 1, pad: 1 }), f("preco_unit", "Preço unitário (R$)", "number", { req: 1 }),
    f("canal", "Canal", "select", { op: ["Mercado Livre", "Shopee", "Amazon", "Loja própria", "Instagram", "Atacado", "Outro"] }),
    f("taxa_canal_pct", "Taxa do canal (%)", "number"), f("frete_brl", "Frete pago por você (R$)", "number"),
    f("status", "Status", "select", { op: ["orcamento", "pago", "enviado", "entregue", "cancelado"], rot: { orcamento: "Orçamento" }, pad: "pago" }),
    f("notas", "Anotações", "textarea"),
  ] },
  links: { nome: "Link", titulo: (d) => d.titulo || d.url, campos: [
    f("url", "Endereço (URL)", "url", { req: 1 }), f("titulo", "Título"), f("imagem", "Imagem (URL)", "url"),
    f("categoria", "Categoria", "select", { op: ["produtos", "fornecedores", "bolsas", "corretoras", "notícias", "pesquisas"] }),
    f("pasta", "Pasta"), f("tags", "Etiquetas", "tags"), f("favorito", "Favorito", "bool"), f("notas", "Anotações", "textarea"),
  ] },
  watchlist: { nome: "Ativo acompanhado", titulo: (d) => d.simbolo, campos: [
    f("simbolo", "Símbolo (ex.: PETR4, AAPL, BTC, USDBRL)", "text", { req: 1 }), f("classe", "Classe", "select", { op: Object.keys(CLASSES), rot: CLASSES }),
    f("alerta_acima", "Avisar acima de", "number"), f("alerta_abaixo", "Avisar abaixo de", "number"), f("notas", "Anotações", "textarea"),
  ] },
  carteira: { nome: "Posição", titulo: (d) => d.simbolo, campos: [
    f("simbolo", "Símbolo", "text", { req: 1 }), f("classe", "Classe", "select", { op: Object.keys(CLASSES), rot: CLASSES }),
    f("quantidade", "Quantidade", "number", { req: 1 }), f("preco_medio", "Preço médio", "number", { req: 1 }),
    f("moeda", "Moeda", "select", { op: ["BRL", "USD"], pad: "BRL" }), f("data", "Data da compra", "date"), f("corretora", "Corretora / carteira"),
    f("origem", "Origem", "select", { op: ["manual", "importada"], pad: "manual" }), f("notas", "Anotações", "textarea"),
  ] },
  alertas: { nome: "Alerta", titulo: (d) => d.nome || d.tipo, campos: [
    f("nome", "Nome do alerta"), f("tipo", "Condição", "select", { req: 1, op: ["preco_acima", "preco_abaixo", "variacao", "produto_preco", "tarefa_prazo"],
      rot: { preco_acima: "Preço acima de", preco_abaixo: "Preço abaixo de", variacao: "Variação do dia maior que (±%)", produto_preco: "Produto chinês com preço igual ou abaixo de", tarefa_prazo: "Tarefas do CRM vencendo (dias de antecedência)" } }),
    f("simbolo", "Ativo (para alertas de mercado)"), f("produto_id", "Produto (para alerta de preço de produto)", "ref", { col: "produtos" }),
    f("valor", "Valor de referência", "number", { req: 1 }),
    f("canal", "Avisar por", "select", { op: ["painel", "email", "whatsapp"], rot: { painel: "Painel", email: "E-mail (requer servidor)", whatsapp: "WhatsApp Business (requer servidor)" }, pad: "painel" }),
    f("ativo", "Ativo", "bool", { pad: true }),
  ] },
};
// valores padrão
function novoDoc(col) {
  const d = {};
  for (const c of S[col]?.campos || []) if (c.pad !== undefined) d[c.k] = typeof c.pad === "function" ? c.pad() : c.pad;
  return d;
}

// ---------- armazenamento ----------
const Store = {
  modo: "", dados: {}, db: null, escrevendo: new Map(), usuario: null, aviso: "", feed: new Map(), feedInfo: null,
  todos(col) { return [...(this.dados[col]?.values() || [])]; },
  um(col, id) { return this.dados[col]?.get(id); },
  async iniciar() {
    COLS.forEach((c) => (this.dados[c] = new Map()));
    if (NO_ARTEFATO) {
      const db = await cap("db");
      if (db) { this.modo = "claude"; this.db = db; this.assinar(); return; }
    }
    try {
      const r = await fetch("api/saude", { credentials: "same-origin" });
      if (r.ok && (await r.json()).app === "china-trade") { this.modo = "api"; return; }
    } catch { /* sem servidor */ }
    this.modo = "local";
    for (const c of COLS) {
      try { (JSON.parse(localStorage.getItem("ct:" + c) || "[]")).forEach((d) => this.dados[c].set(d.id, d)); } catch { /* armazenamento bloqueado */ }
    }
  },
  assinar() {
    const timer = setTimeout(() => { this.aviso = "O banco de dados ainda não respondeu. O que aparece pode estar desatualizado."; render(); }, 10000);
    for (const c of COLS) {
      this.db.collection(c).onSnapshot((snap) => {
        if (!snap.metadata.fromCache) { clearTimeout(timer); if (this.aviso) { this.aviso = ""; } }
        this.dados[c] = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
        mudou(c);
      }, (e) => { clearTimeout(timer); this.aviso = "Banco de dados indisponível (" + e.code + "). Suas alterações não serão salvas nesta visita."; render(); });
    }
    // cotações publicadas pelo servidor ou pela rotina de atualização: um documento por coleta, lemos o mais novo
    this.db.collection("cotacoes_feed").orderBy("gerado_em", "desc").limit(1).onSnapshot((snap) => {
      const d = snap.docs[0]?.data();
      marcarMudancas(d?.itens || []);
      this.feed = new Map((d?.itens || []).map((q) => [q.id, q]));
      this.feedInfo = d ? { gerado_em: d.gerado_em, origem: d.origem } : null;
      mudou("cotacoes");
    }, () => { /* sem feed: segue com cotações manuais */ });
  },
  async carregarApi() {
    const r = await api("GET", "api/colecoes");
    for (const [c, docs] of Object.entries(r)) { if (!this.dados[c]) this.dados[c] = new Map(); this.dados[c] = new Map(docs.map((d) => [d.id, d])); }
    const q = await api("GET", "api/cotacoes");
    this.feed = new Map(q.map((d) => [d.id, d]));
    this.feedInfo = { gerado_em: agora(), origem: "servidor" };
    abrirSocket();
  },
  persistirLocal(col) { try { localStorage.setItem("ct:" + col, JSON.stringify(this.todos(col))); } catch { toast("Não foi possível salvar neste navegador."); } },
  async salvar(col, doc, { auditar = true } = {}) {
    const antes = doc.id ? this.um(col, doc.id) : null;
    const d = { ...doc, id: doc.id || uid(), atualizado_em: agora() };
    if (!antes) d.criado_em = d.criado_em || agora();
    if (antes && auditar) {
      const alterados = Object.keys(d).filter((k) => !["atualizado_em", "_hist", "id"].includes(k) && JSON.stringify(d[k]) !== JSON.stringify(antes[k]));
      if (alterados.length) d._hist = [...(antes._hist || []), { quando: d.atualizado_em, campos: alterados }].slice(-30);
    }
    this.dados[col].set(d.id, d); mudou(col);
    await this.escrever(col, d.id, () => this.gravar(col, d));
    if (auditar && col !== "auditoria" && this.modo !== "api") this.salvar("auditoria", { acao: antes ? "alterou" : "criou", colecao: col, ref: d.id, titulo: tituloDe(col, d) }, { auditar: false });
    return d;
  },
  async excluir(col, id) {
    const antes = this.um(col, id);
    this.dados[col].delete(id); mudou(col);
    await this.escrever(col, id, () => (this.modo === "claude" ? this.db.collection(col).doc(id).delete() : this.modo === "api" ? api("DELETE", `api/colecoes/${col}/${encodeURIComponent(id)}`) : this.persistirLocal(col)));
    if (col !== "auditoria" && this.modo !== "api") this.salvar("auditoria", { acao: "excluiu", colecao: col, ref: id, titulo: antes ? tituloDe(col, antes) : id }, { auditar: false });
  },
  gravar(col, d) {
    if (this.modo === "claude") return this.db.collection(col).doc(d.id).set(JSON.parse(JSON.stringify(d)));
    if (this.modo === "api") return api("PUT", `api/colecoes/${col}/${encodeURIComponent(d.id)}`, d);
    this.persistirLocal(col);
  },
  // uma escrita por vez em cada documento
  async escrever(col, id, fn) {
    const chave = col + "/" + id;
    const anterior = this.escrevendo.get(chave) || Promise.resolve();
    const p = anterior.then(fn).catch((e) => { toast("Não salvou: " + (e?.message || e?.code || e)); });
    this.escrevendo.set(chave, p);
    return p;
  },
};
async function api(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CT": "1" }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 401 && !url.startsWith("api/auth/")) { Store.usuario = null; render(); throw new Error("sessão expirada"); }
  const j = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(j?.detail || r.statusText);
  return j;
}
let socket = null;
function abrirSocket() {
  if (socket) return;
  try {
    socket = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws");
    socket.onmessage = (ev) => { const q = JSON.parse(ev.data); if (q?.id) { marcarMudancas([q]); Store.feed.set(q.id, q); Store.feedInfo = { gerado_em: agora(), origem: "servidor (ao vivo)" }; mudou("cotacoes"); } };
    socket.onclose = () => { socket = null; setTimeout(() => Store.usuario && abrirSocket(), 5000); };
  } catch { socket = null; }
}
const cfg = () => ({ ...CFG_PADRAO, ...(Store.um("config", "geral") || {}) });
const nomeDe = (col, id) => (id ? tituloDe(col, Store.um(col, id) || {}) : "");
const tituloDe = (col, d) => (S[col]?.titulo ? S[col].titulo(d) : d.nome || d.titulo || d.simbolo || d.id) || "";

// ---------- cotações ----------
function cotacoes() {
  const m = new Map(UNIVERSO.map((u) => [u.id, { ...u }]));
  for (const w of Store.todos("watchlist")) { const id = w.simbolo.toUpperCase(); if (!m.has(id)) m.set(id, { id, simbolo: id, nome: id, classe: w.classe || "acao_br", moeda: "" }); }
  for (const q of Store.todos("cotacoes")) m.set(q.id, { ...(m.get(q.id) || {}), ...q });
  for (const q of Store.feed.values()) m.set(q.id, { ...(m.get(q.id) || {}), ...q });
  return [...m.values()];
}
const cot = (id) => { const k = String(id).toUpperCase(); const q = Store.feed.get(k) || Store.um("cotacoes", k); return q && q.preco != null ? q : null; };
function taxa(cur) {
  if (!cur || cur === "BRL") return { v: 1, fonte: "—", tipo: "fixa" };
  const q = cot(cur + "BRL");
  if (q) return { v: +q.preco, fonte: q.fonte, horario: q.horario, tipo: q.tipo };
  const m = n(cfg().cambio_manual?.[cur]);
  if (m) return { v: m, fonte: "cotação manual (Configurações)", tipo: "manual" };
  return null;
}
const emBRL = (v, cur) => { const t = taxa(cur); return t && v != null ? v * t.v : null; };
const pill = (tipo) => {
  const r = { tempo_real: "tempo real", atrasada: "atrasada", indicativa: "indicativa", manual: "manual" };
  return `<span class="pill ${esc(tipo || "sem")}">${esc(r[tipo] || "sem dados")}</span>`;
};

// ---------- ao vivo: o que mudou, selo no topo e dica dos gráficos ----------
const MUDOU = new Map();
function marcarMudancas(itens) {
  MUDOU.clear();
  if (!Store.feed.size) return; // primeira carga não pisca
  for (const q of itens) { const a = Store.feed.get(q.id); if (a && q.preco != null && a.preco !== q.preco) MUDOU.set(q.id, q.preco > a.preco ? "subiu" : "caiu"); }
  if (MUDOU.size) { toast(`Cotações atualizadas: ${MUDOU.size} ativo(s) mudaram.`); setTimeout(() => { MUDOU.clear(); $$(".piscou").forEach((e) => e.classList.remove("piscou", "subiu", "caiu")); }, 6000); }
}
function seloAoVivo() {
  const el = $("#aovivo"); if (!el) return;
  const g = Store.feedInfo?.gerado_em;
  if (!g) { el.hidden = true; return; }
  const min = Math.max(0, Math.round((Date.now() - new Date(g)) / 6e4));
  const quando = min < 1 ? "agora" : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} d`;
  el.hidden = false; el.dataset.estado = min <= 90 ? "vivo" : "parado";
  el.innerHTML = `<span class="ponto"></span>${min <= 90 ? "ao vivo" : "cotações"} · ${esc(quando)}`;
  el.title = "Origem: " + (Store.feedInfo.origem || "") + ". A página se atualiza sozinha quando chegam cotações novas.";
}
setInterval(seloAoVivo, 30000);
function dicaGrafico(ev) {
  const g = ev.target.closest(".grafico[data-pts]"); if (!g) return;
  const d = JSON.parse(g.dataset.pts); const svg = g.querySelector("svg"); const r = svg.getBoundingClientRect();
  const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (d.W / r.width);
  let i = 0; for (let k = 1; k < d.x.length; k++) if (Math.abs(d.x[k] - px) < Math.abs(d.x[i] - px)) i = k;
  const [linha, bola] = svg.querySelectorAll(".cursor");
  linha.setAttribute("x1", d.x[i]); linha.setAttribute("x2", d.x[i]); bola.setAttribute("cx", d.x[i]); bola.setAttribute("cy", d.y[i]);
  linha.setAttribute("visibility", "visible"); bola.setAttribute("visibility", "visible");
  const dica = g.querySelector(".dica"); dica.hidden = false;
  dica.textContent = `${fmtN(d.c[i], d.c[i] > 1000 ? 2 : 4)} · ${d.t[i].length > 10 ? dataBR(d.t[i]) : dataBR(d.t[i], false)}`;
  const esq = (d.x[i] / d.W) * r.width; dica.style.left = Math.min(Math.max(0, esq - 60), r.width - 130) + "px";
}
document.addEventListener("pointermove", dicaGrafico);
document.addEventListener("touchmove", dicaGrafico, { passive: true });
document.addEventListener("pointerleave", (ev) => { if (ev.target.closest?.(".grafico")) { /* mantém o último ponto visível */ } }, true);

// ---------- indicadores (mesmas fórmulas do backend: chinatrade/dominio/indicadores.py) ----------
const Ind = {
  sma(a, p) { return a.map((_, i) => (i < p - 1 ? null : a.slice(i - p + 1, i + 1).reduce((s, x) => s + x, 0) / p)); },
  ema(a, p) {
    const k = 2 / (p + 1); const out = []; let e = null;
    a.forEach((x, i) => {
      if (i < p - 1) { out.push(null); return; }
      e = i === p - 1 ? a.slice(0, p).reduce((s, y) => s + y, 0) / p : x * k + e * (1 - k);
      out.push(e);
    });
    return out;
  },
  rsi(a, p = 14) {
    if (a.length <= p) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= p; l /= p;
    for (let i = p + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  },
  macd(a) {
    const e12 = Ind.ema(a, 12), e26 = Ind.ema(a, 26);
    const linha = a.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
    const validos = linha.filter((x) => x != null);
    if (validos.length < 9) return null;
    const sinal = Ind.ema(validos, 9);
    const m = validos.at(-1), s = sinal.at(-1);
    return { macd: m, sinal: s, hist: m - s };
  },
  volatilidade(a, anual = 252) {
    const r = []; for (let i = 1; i < a.length; i++) if (a[i - 1] > 0 && a[i] > 0) r.push(Math.log(a[i] / a[i - 1]));
    const u = r.slice(-30); if (u.length < 5) return null;
    const m = u.reduce((s, x) => s + x, 0) / u.length;
    const v = u.reduce((s, x) => s + (x - m) ** 2, 0) / (u.length - 1);
    return Math.sqrt(v) * Math.sqrt(anual) * 100;
  },
  niveis(a, janela = 60) {
    const u = a.slice(-janela); const sup = [], res = [];
    for (let i = 2; i < u.length - 2; i++) {
      if (u[i] <= Math.min(u[i - 1], u[i - 2], u[i + 1], u[i + 2])) sup.push(u[i]);
      if (u[i] >= Math.max(u[i - 1], u[i - 2], u[i + 1], u[i + 2])) res.push(u[i]);
    }
    const p = a.at(-1);
    return { suporte: sup.filter((x) => x < p).sort((x, y) => y - x)[0] ?? Math.min(...u), resistencia: res.filter((x) => x > p).sort((x, y) => x - y)[0] ?? Math.max(...u) };
  },
  backtest(a, rapida = 9, lenta = 21, custoPct = 0.1) {
    if (a.length < lenta + 2) return null;
    const fa = Ind.sma(a, rapida), sl = Ind.sma(a, lenta);
    let caixa = 10000, qtd = 0, entrada = 0, pico = 10000, dd = 0; const ops = [];
    for (let i = lenta; i < a.length; i++) {
      const cruzouCima = fa[i - 1] <= sl[i - 1] && fa[i] > sl[i], cruzouBaixo = fa[i - 1] >= sl[i - 1] && fa[i] < sl[i];
      if (qtd === 0 && cruzouCima) { qtd = (caixa * (1 - custoPct / 100)) / a[i]; entrada = a[i]; caixa = 0; ops.push({ i, lado: "compra", preco: a[i] }); }
      else if (qtd > 0 && cruzouBaixo) { caixa = qtd * a[i] * (1 - custoPct / 100); ops.push({ i, lado: "venda", preco: a[i], ganho: a[i] / entrada - 1 }); qtd = 0; }
      const pat = caixa + qtd * a[i]; pico = Math.max(pico, pat); dd = Math.max(dd, 1 - pat / pico);
    }
    const final = caixa + qtd * a.at(-1);
    const vendas = ops.filter((o) => o.lado === "venda");
    return { retorno: (final / 10000 - 1) * 100, compraEMantem: (a.at(-1) / a[lenta] - 1) * 100, operacoes: ops.length, acerto: vendas.length ? (vendas.filter((o) => o.ganho > 0).length / vendas.length) * 100 : null, drawdown: dd * 100, ops };
  },
};

// ---------- custo de importação (mesmas fórmulas de chinatrade/dominio/importacao.py) ----------
function custoImportacao(p, c = cfg()) {
  const qtd = n(p.qtd_lote) || n(p.moq) || 1;
  const tProd = taxa(p.moeda || "CNY"), tFrete = taxa(p.frete_moeda || "USD"), tUsd = taxa("USD");
  const faltam = [];
  if (n(p.preco_origem) == null) faltam.push("preço observado");
  if (!tProd) faltam.push("cotação " + (p.moeda || "CNY") + "/BRL");
  if (n(p.frete_total) && !tFrete) faltam.push("cotação " + p.frete_moeda + "/BRL");
  if (!tUsd) faltam.push("cotação USD/BRL");
  if (faltam.length) return { erro: "Faltam: " + faltam.join(", ") + ". Cadastre a cotação em Moedas e Câmbio ou em Configurações.", qtd };
  const sp = 1 + (n(c.spread_pct) || 0) / 100;
  const fob = n(p.preco_origem) * qtd * tProd.v * sp;
  const frete = (n(p.frete_total) || 0) * tFrete.v * sp;
  const linhas = [["Mercadoria (FOB) em R$", fob], ["Frete internacional em R$", frete]];
  let total;
  if ((p.regime || "formal") === "remessa") {
    const vaUsd = (fob + frete) / tUsd.v;
    const va = fob + frete;
    let ii;
    if (vaUsd <= 50) ii = va * (n(c.remessa_ii_ate50_pct) / 100);
    else ii = Math.max(0, va * (n(c.remessa_ii_acima50_pct) / 100) - n(c.remessa_deducao_usd) * tUsd.v);
    const aliq = n(c.remessa_icms_pct) / 100;
    const icms = ((va + ii) / (1 - aliq)) * aliq;
    linhas.push([`Imposto de Importação (${vaUsd <= 50 ? c.remessa_ii_ate50_pct + "%" : c.remessa_ii_acima50_pct + "% − US$ " + c.remessa_deducao_usd})`, ii], [`ICMS ${c.remessa_icms_pct}% (por dentro)`, icms]);
    total = va + ii + icms;
  } else {
    const va = fob + frete;
    const iiPct = n(p.ii_pct) ?? n(c.ii_pct);
    const ii = va * iiPct / 100, ipi = (va + ii) * n(c.ipi_pct) / 100, pis = va * n(c.pis_pct) / 100, cof = va * n(c.cofins_pct) / 100;
    const sis = n(c.siscomex_brl) || 0, afrmm = p.modal === "maritimo" ? frete * n(c.afrmm_pct) / 100 : 0;
    const desp = va * (n(c.despesas_pct) || 0) / 100;
    const aliq = n(c.icms_pct) / 100;
    const icms = ((va + ii + ipi + pis + cof + sis + afrmm) / (1 - aliq)) * aliq;
    linhas.push([`II ${fmtN(iiPct, 2)}%`, ii], [`IPI ${c.ipi_pct}%`, ipi], [`PIS-Importação ${c.pis_pct}%`, pis], [`COFINS-Importação ${c.cofins_pct}%`, cof],
      ["Taxa Siscomex", sis], [`AFRMM ${c.afrmm_pct}% do frete marítimo`, afrmm], [`ICMS ${c.icms_pct}% (por dentro)`, icms], [`Despesas (despachante, armazenagem) ${c.despesas_pct}%`, desp]);
    total = va + ii + ipi + pis + cof + sis + afrmm + icms + desp;
  }
  const unit = total / qtd;
  const pv = n(p.preco_venda_br);
  const liquido = pv != null ? pv * (1 - n(c.taxa_canal_pct) / 100) : null;
  const margem = pv ? ((liquido - unit) / pv) * 100 : null;
  return { qtd, linhas, total, unit, pv, liquido, margem, cambio: { prod: tProd, frete: tFrete, usd: tUsd }, precoBRLorigem: n(p.preco_origem) * tProd.v };
}

// ---------- vendas ----------
function resumoVenda(v) {
  const p = Store.um("produtos", v.produto_id) || {};
  const ci = custoImportacao(p);
  const receita = (n(v.qtd) || 0) * (n(v.preco_unit) || 0);
  const taxaCanal = receita * (n(v.taxa_canal_pct) ?? n(cfg().taxa_canal_pct)) / 100;
  const custo = ci.erro ? null : ci.unit * (n(v.qtd) || 0);
  const lucro = custo == null ? null : receita - taxaCanal - (n(v.frete_brl) || 0) - custo;
  return { receita, taxaCanal, custo, lucro, margem: lucro != null && receita ? (lucro / receita) * 100 : null };
}
const vendasValidas = () => Store.todos("vendas").filter((v) => !["cancelado", "orcamento"].includes(v.status));
function estoque(prodId) {
  const p = Store.um("produtos", prodId); if (!p || p.status !== "comprado") return null;
  const vendido = vendasValidas().filter((v) => v.produto_id === prodId).reduce((s, v) => s + (n(v.qtd) || 0), 0);
  return (n(p.qtd_lote) || 0) - vendido;
}

// ---------- gráficos SVG ----------
function grafico(pontos, { altura = 200, cor = "var(--acento)", rotuloY = (v) => fmtN(v), linhas = [] } = {}) {
  const pts = (pontos || []).filter((p) => p && p.c != null);
  if (pts.length < 2) return `<div class="vazio">Sem histórico suficiente para o gráfico.</div>`;
  const W = 640, H = altura, ml = 8, mr = 70, mt = 12, mb = 24;
  const vs = pts.map((p) => +p.c).concat(linhas.map((l) => l.v).filter((v) => v != null));
  let mn = Math.min(...vs), mx = Math.max(...vs); if (mn === mx) { mn -= 1; mx += 1; }
  const x = (i) => ml + (i / (pts.length - 1)) * (W - ml - mr), y = (v) => mt + (1 - (v - mn) / (mx - mn)) * (H - mt - mb);
  const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(+p.c).toFixed(1)).join(" ");
  const area = d + ` L${x(pts.length - 1).toFixed(1)} ${H - mb} L${x(0)} ${H - mb} Z`;
  const ticks = [mn, (mn + mx) / 2, mx];
  const ult = pts.at(-1);
  const curto = new Date(ult.t) - new Date(pts[0].t) < 3 * 864e5;
  const rot = (t) => (curto ? dataBR(t.length === 10 ? t + "T12:00:00Z" : t) : dataBR(t, false));
  const dados = esc(JSON.stringify({ x: pts.map((_, i) => +x(i).toFixed(1)), y: pts.map((p) => +y(+p.c).toFixed(1)), c: pts.map((p) => +p.c), t: pts.map((p) => p.t), W, H, mt, mb }));
  return `<div class="grafico" data-pts="${dados}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico histórico, toque para ver os valores">
    ${ticks.map((t) => `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--linha)" stroke-width="1"/><text x="${W - mr + 6}" y="${y(t) + 4}" font-size="11" fill="var(--suave)" font-family="var(--f-mono)">${esc(rotuloY(t))}</text>`).join("")}
    ${linhas.filter((l) => l.v != null).map((l) => `<line x1="${ml}" x2="${W - mr}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.cor}" stroke-dasharray="4 4" stroke-width="1"/><text x="${ml + 4}" y="${y(l.v) - 4}" font-size="10" fill="${l.cor}">${esc(l.r)}</text>`).join("")}
    <path d="${area}" fill="${cor}" opacity=".10"/><path d="${d}" fill="none" stroke="${cor}" stroke-width="2"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(+ult.c)}" r="4" fill="${cor}"/>
    <text x="${ml}" y="${H - 6}" font-size="11" fill="var(--suave)">${esc(rot(pts[0].t))}</text>
    <text x="${W - mr}" y="${H - 6}" font-size="11" fill="var(--suave)" text-anchor="end">${esc(rot(ult.t))}</text>
    <line class="cursor" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--suave)" stroke-width="1" visibility="hidden"/><circle class="cursor" r="4" fill="var(--papel)" stroke="${cor}" stroke-width="2" visibility="hidden"/>
  </svg><div class="dica" hidden></div><p class="suave" style="margin:4px 0 0;font-size:.76rem">${pts.length} pontos · toque ou passe o dedo no gráfico para ver cada valor</p></div>`;
}
function barras(itens, fmt = (v) => moeda(v)) {
  if (!itens.length) return `<div class="vazio">Sem dados no período.</div>`;
  const mx = Math.max(...itens.map((i) => Math.abs(i.v)), 1);
  return `<div style="display:flex;flex-direction:column;gap:6px">${itens.map((i) => `<div style="display:grid;grid-template-columns:minmax(70px,120px) 1fr auto;gap:8px;align-items:center;font-size:.84rem">
    <span class="suave">${esc(i.r)}</span><span style="height:14px;border-radius:4px;background:${i.v < 0 ? "var(--queda)" : "var(--acento)"};width:${Math.max(2, (Math.abs(i.v) / mx) * 100)}%"></span><span class="num">${esc(fmt(i.v))}</span></div>`).join("")}</div>`;
}
function spark(hist) {
  const a = (hist || []).map((p) => +p.c).filter((v) => !isNaN(v)).slice(-30);
  if (a.length < 2) return "";
  const mn = Math.min(...a), mx = Math.max(...a) || 1, W = 90, H = 24;
  const d = a.map((v, i) => (i ? "L" : "M") + ((i / (a.length - 1)) * W).toFixed(1) + " " + (H - ((v - mn) / (mx - mn || 1)) * H).toFixed(1)).join(" ");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${a.at(-1) >= a[0] ? "var(--alta)" : "var(--queda)"}" stroke-width="1.5"/></svg>`;
}

// ---------- tabelas genéricas ----------
const UI = { filtros: {}, ordem: {}, aba: {}, resultadoIA: {}, scanner: null, ativo: "PETR4", calc: [] };
const TABELAS = {};
function tabela(id, linhas, colunas, { vazio = "Nada cadastrado ainda.", acao = "" } = {}) {
  TABELAS[id] = { linhas, colunas, vazio, acao };
  return `<div class="tabela" id="tb-${id}">${corpoTabela(id)}</div>`;
}
function corpoTabela(id) {
  const { linhas, colunas, vazio, acao } = TABELAS[id];
  const termo = (UI.filtros[id] || "").toLowerCase();
  let ls = termo ? linhas.filter((l) => JSON.stringify(l).toLowerCase().includes(termo)) : [...linhas];
  const o = UI.ordem[id];
  if (o) {
    const c = colunas[o.i];
    const val = (l) => (c.ord ? c.ord(l) : c.v ? c.v(l) : l[c.k]);
    ls.sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "pt-BR"); return o.dir * r; });
  }
  if (!ls.length) return `<div class="vazio">${termo ? "Nenhum resultado para o filtro." : vazio}${!termo && acao ? acao : ""}</div>`;
  return `<table><thead><tr>${colunas.map((c, i) => `<th class="${c.num ? "n" : ""}" data-a="ordenar" data-t="${id}" data-i="${i}">${esc(c.l)}${o?.i === i ? (o.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${ls.map((l) => `<tr>${colunas.map((c) => `<td class="${c.num ? "n" : ""}">${c.h ? c.h(l) : esc(c.v ? c.v(l) : l[c.k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const filtro = (id, ph = "Filtrar…") => `<input type="search" id="f-${id}" data-filtro="${id}" placeholder="${esc(ph)}" value="${esc(UI.filtros[id] || "")}">`;
const acoesLinha = (col, d, extra = "") => `<span class="acoes">${extra}<button class="btn mini" data-a="editar" data-c="${col}" data-id="${esc(d.id)}">Editar</button><button class="btn mini perigo" data-a="excluir" data-c="${col}" data-id="${esc(d.id)}">Excluir</button></span>`;
const abrirLink = (u, r = "Abrir ↗") => (linkSeguro(u) ? `<a class="btn mini" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${r}</a>` : "");
const exemplo = (d) => (d.exemplo ? ` <span class="pill exemplo">exemplo</span>` : "");

// ---------- formulário genérico ----------
let formAberto = null;
function abrirForm(col, id, pre = {}) {
  const sc = S[col]; const d = id ? { ...Store.um(col, id) } : { ...novoDoc(col), ...pre };
  formAberto = { col, id: d.id };
  const campo = (c) => {
    const v = d[c.k]; const nm = `id="fm-${c.k}" name="${c.k}"`;
    if (c.t === "textarea") return `<label class="campo" style="grid-column:1/-1">${esc(c.l)}<textarea ${nm}>${esc(v)}</textarea></label>`;
    if (c.t === "bool") return `<label class="campo" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" ${nm} ${v ? "checked" : ""}> ${esc(c.l)}</label>`;
    if (c.t === "select") return `<label class="campo">${esc(c.l)}<select ${nm}><option value="">—</option>${c.op.map((o) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(c.rot?.[o] || o)}</option>`).join("")}</select></label>`;
    if (c.t === "ref") return `<label class="campo">${esc(c.l)}<select ${nm}><option value="">—</option>${Store.todos(c.col).sort((a, b) => tituloDe(c.col, a).localeCompare(tituloDe(c.col, b))).map((o) => `<option value="${esc(o.id)}" ${o.id === v ? "selected" : ""}>${esc(tituloDe(c.col, o))}</option>`).join("")}</select></label>`;
    if (c.t === "anexos") return `<div class="campo" style="grid-column:1/-1"><span>${esc(c.l)}</span><div id="anexos-lista" class="chips">${(v || []).map((a, i) => `<span class="chip"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nome)}</a> <button class="btn mini" type="button" data-a="tirar-anexo" data-i="${i}">×</button></span>`).join("") || '<span class="suave">Nenhum documento.</span>'}</div>
      <input type="file" id="fm-anexo" ${Store.modo === "local" ? "disabled" : ""}><small class="suave">${Store.modo === "local" ? "Anexos ficam disponíveis no claude.ai ou com o servidor." : "PDF, imagem ou planilha até 20 MB."}</small></div>`;
    const tipo = c.t === "number" ? 'type="number" step="any" inputmode="decimal"' : c.t === "date" ? 'type="date"' : c.t === "url" ? 'type="url" placeholder="https://"' : 'type="text"';
    const val = c.t === "tags" ? (v || []).join(", ") : v ?? "";
    return `<label class="campo">${esc(c.l)}${c.req ? " *" : ""}<input ${tipo} ${nm} value="${esc(val)}" ${c.req ? "required" : ""}></label>`;
  };
  const hist = (d._hist || []).slice(-6).reverse();
  $("#janela-raiz").innerHTML = `<div class="veu" data-a="fechar-veu"><form class="janela" id="form-crud" novalidate>
    <header><h2>${id ? "Editar" : "Novo"} ${esc(sc.nome.toLowerCase())}</h2><button type="button" class="btn" data-a="fechar">Fechar</button></header>
    ${col === "links" ? `<div class="nota">O título e a imagem não podem ser lidos automaticamente daqui (o navegador bloqueia acesso a outros sites). Cole o título; o domínio é preenchido sozinho. Com o servidor ligado, use “Capturar título”.</div>` : ""}
    <div class="grade l2">${sc.campos.map(campo).join("")}</div>
    <div id="form-dup"></div>
    ${hist.length ? `<details><summary class="suave">Histórico de alterações</summary><ul>${hist.map((h) => `<li class="suave">${esc(dataBR(h.quando))}: ${esc(h.campos.join(", "))}</li>`).join("")}</ul></details>` : ""}
    <div class="acoes"><button class="btn pri" type="submit">Salvar</button>${col === "links" && Store.modo === "api" ? '<button type="button" class="btn" data-a="capturar-titulo">Capturar título</button>' : ""}<button type="button" class="btn" data-a="fechar">Cancelar</button></div>
  </form></div>`;
  formAberto.anexos = d.anexos || [];
  $("#form-crud").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target); const novo = { ...(id ? Store.um(col, id) : {}), ...(id ? {} : pre) };
    for (const c of sc.campos) {
      if (c.t === "anexos") { novo.anexos = formAberto.anexos; continue; }
      if (c.t === "bool") { novo[c.k] = !!fd.get(c.k); continue; }
      let v = fd.get(c.k); v = typeof v === "string" ? v.trim() : v;
      if (c.req && !v) { toast(`Preencha “${c.l}”.`); $(`#fm-${c.k}`)?.focus(); return; }
      if (c.t === "number") v = v === "" ? null : +String(v).replace(",", ".");
      if (c.t === "tags") v = v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (c.t === "url" && v && !/^https?:\/\//i.test(v)) v = "https://" + v;
      novo[c.k] = v;
    }
    if (col === "links" && !novo.titulo) novo.titulo = dominio(novo.url);
    if (col === "watchlist" || col === "carteira") novo.simbolo = novo.simbolo.toUpperCase();
    const salvo = await Store.salvar(col, novo);
    fecharJanela(); toast(`${sc.nome} salvo.`);
    if (col === "produtos" && pre._depois) pre._depois(salvo);
  });
  if (col === "links") $("#fm-url").addEventListener("input", (e) => {
    const u = e.target.value.trim().replace(/\/$/, "");
    const dup = Store.todos("links").find((l) => l.id !== d.id && l.url?.replace(/\/$/, "") === u);
    $("#form-dup").innerHTML = dup ? `<div class="nota"><b>Link duplicado:</b> já existe “${esc(dup.titulo)}” na pasta ${esc(dup.pasta || "—")}.</div>` : "";
  });
  const arq = $("#fm-anexo");
  if (arq) arq.addEventListener("change", async () => {
    const file = arq.files[0]; if (!file) return;
    try {
      let item;
      if (Store.modo === "claude") {
        const assets = await cap("assets"); if (!assets) throw new Error("anexos indisponíveis para este acesso");
        const r = await assets.upload(file); item = { id: r.id, url: r.url, nome: file.name };
      } else {
        const fd = new FormData(); fd.append("arquivo", file);
        const r = await fetch("api/anexos", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CT": "1" } });
        if (!r.ok) throw new Error((await r.json()).detail); const j = await r.json(); item = { id: j.id, url: j.url, nome: file.name };
      }
      formAberto.anexos = [...formAberto.anexos, item];
      $("#anexos-lista").insertAdjacentHTML("beforeend", `<span class="chip">${esc(item.nome)}</span>`); toast("Documento anexado. Salve para gravar.");
    } catch (e) { toast("Não anexou: " + (e.message || e.code)); }
    arq.value = "";
  });
  setTimeout(() => $("#form-crud input, #form-crud select")?.focus(), 30);
}
function fecharJanela() { const tinha = !!formAberto; $("#janela-raiz").innerHTML = ""; formAberto = null; if (tinha) { clearTimeout(pendente); pendente = setTimeout(render, 30); } }
function confirmar(msg, aoConfirmar) {
  $("#janela-raiz").innerHTML = `<div class="veu" data-a="fechar-veu"><div class="janela" style="max-width:420px"><h2>Confirmar</h2><p>${esc(msg)}</p>
    <div class="acoes"><button class="btn perigo" id="sim">Sim, continuar</button><button class="btn" data-a="fechar">Cancelar</button></div></div></div>`;
  $("#sim").onclick = async () => { fecharJanela(); await aoConfirmar(); };
}

// ---------- IA (Claude, pelo claude.ai) ----------
async function perguntarIA(chave, prompt, { json = false, tier = "default" } = {}) {
  const sample = await cap("sample");
  if (!sample) { UI.resultadoIA[chave] = { erro: "A análise por IA está disponível quando a página é aberta no claude.ai." }; render(); return null; }
  UI.resultadoIA[chave] = { texto: "Analisando…" }; render();
  try {
    if (json) { const r = await sample.json(prompt, { modelTier: tier }); UI.resultadoIA[chave] = { dados: r }; render(); return r; }
    const r = await sample(prompt, { modelTier: tier, onText: ({ text }) => { UI.resultadoIA[chave] = { texto: text }; const el = $(`#ia-${chave}`); if (el) el.textContent = text; } });
    UI.resultadoIA[chave] = { texto: r.text }; render(); return r.text;
  } catch (e) {
    UI.resultadoIA[chave] = { erro: e.code === "not_granted" ? "Você não autorizou a IA nesta página." : e.code === "rate_limited" ? "Limite de uso atingido. Tente em alguns minutos." : "A IA não respondeu: " + (e.message || e.code) };
    render(); return null;
  }
}
const caixaIA = (chave) => {
  const r = UI.resultadoIA[chave]; if (!r) return "";
  if (r.erro) return `<div class="nota">${esc(r.erro)}</div>`;
  return `<div class="saida-ia" id="ia-${chave}">${esc(r.texto ?? JSON.stringify(r.dados, null, 2))}</div>`;
};
async function registrarAgente(agente, entrada, resultado, fontes, limitacoes) {
  return Store.salvar("agentes_log", { agente, entrada, resultado: String(resultado).slice(0, 4000), fontes, limitacoes }, { auditar: false });
}

// ---------- menu e rotas ----------
const MENU = [
  ["dashboard", "Dashboard"], ["bolsa", "Bolsa de Valores", "Mercados"], ["cripto", "Criptomoedas"], ["cambio", "Moedas e Câmbio"], ["trade", "Trade Intelligence"],
  ["china", "Importações da China", "China e vendas"], ["alta", "Produtos em Alta"], ["fornecedores", "Fornecedores"], ["crm", "CRM"], ["vendas", "Vendas e Clientes"],
  ["links", "Meus Links", "Organização"], ["carteira", "Carteira e Watchlist"], ["alertas", "Alertas"], ["relatorios", "Relatórios e Exportar"],
  ["admin", "Administração", "Sistema"], ["configuracoes", "Configurações"],
];
const rota = () => { const h = location.hash.slice(1); return MENU.some((m) => m[0] === h) ? h : "dashboard"; };
function desenharMenu() {
  const r = rota();
  $("#menu").innerHTML = `<div class="marca"><span class="selo">中贸</span><div><b>China Trade &amp; Market Intelligence</b><span>importação · mercado · vendas</span></div></div>` +
    MENU.map(([id, nome, grupo], i) => `${grupo ? `<div class="grupo rotulo">${esc(grupo)}</div>` : ""}<a href="#${id}" ${id === r ? 'aria-current="page"' : ""}><span class="ix">${String(i + 1).padStart(2, "0")}</span>${esc(nome)}</a>`).join("");
}

// ---------- telas ----------
const T = {};
const cab = (titulo, sub, acoes = "") => `<div class="cab"><div><h1>${esc(titulo)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="acoes">${acoes}</div></div>`;
const avisoFonte = () => Store.todos("cotacoes").length || Store.feed.size ? (Store.feedInfo ? `<p class="suave" style="margin:0;font-size:.82rem">Cotações atualizadas em ${esc(dataBR(Store.feedInfo.gerado_em))} · origem: ${esc(Store.feedInfo.origem || "")}. A fonte de cada valor aparece na tabela.</p>` : "") : `<div class="nota"><b>Ainda não há cotações carregadas.</b> Nada aqui é inventado: os preços chegam do servidor (Binance, Yahoo Finance, AwesomeAPI e outras fontes configuráveis), da rotina de atualização do claude.ai ou de um lançamento manual em Configurações. Veja o estado das fontes em Administração.</div>`;

T.dashboard = () => {
  const mes = hoje().slice(0, 7);
  const vm = vendasValidas().filter((v) => (v.data || "").startsWith(mes)).map(resumoVenda);
  const fat = vm.reduce((s, r) => s + r.receita, 0), luc = vm.reduce((s, r) => s + (r.lucro || 0), 0);
  const prods = Store.todos("produtos");
  const ativas = prods.filter((p) => ["negociando", "cotado", "aprovado"].includes(p.status)).length;
  const tarefas = Store.todos("tarefas").filter((t) => !t.feita).sort((a, b) => (a.prazo || "9").localeCompare(b.prazo || "9"));
  const venc = tarefas.filter((t) => t.prazo && t.prazo <= hoje()).length;
  const disp = Store.todos("alertas_log").filter((a) => Date.now() - new Date(a.criado_em) < 864e5).length;
  const faixa = ["USDBRL", "CNYBRL", "EURBRL", "BTC", "IBOV", "SPX"].map((id) => cotacoes().find((q) => q.id === id));
  return cab("Painel do dia", `Resumo de vendas, importações e mercado. Atualizado ${dataBR(agora())}.`, `<a class="btn pri" href="#china">Pesquisar produto</a><button class="btn" data-a="novo" data-c="vendas">Registrar venda</button>`) +
    (Store.aviso ? `<div class="nota">${esc(Store.aviso)}</div>` : "") +
    `<div class="kpis">
      <div class="kpi"><span class="rotulo">Faturamento no mês</span><b>${moeda(fat)}</b><small>${vm.length} vendas</small></div>
      <div class="kpi"><span class="rotulo">Lucro estimado no mês</span><b class="${cls(luc)}">${moeda(luc)}</b><small>margem ${fat ? pct((luc / fat) * 100, 1) : "—"}</small></div>
      <div class="kpi"><span class="rotulo">Produtos pesquisados</span><b>${prods.length}</b><small>${ativas} em negociação</small></div>
      <div class="kpi"><span class="rotulo">Fornecedores</span><b>${Store.todos("fornecedores").length}</b><small>${Store.todos("contatos").length} contatos registrados</small></div>
      <div class="kpi"><span class="rotulo">Tarefas</span><b class="${venc ? "queda" : ""}">${tarefas.length}</b><small>${venc} vencidas ou para hoje</small></div>
      <div class="kpi"><span class="rotulo">Alertas em 24 h</span><b>${disp}</b><small>${Store.todos("alertas").filter((a) => a.ativo).length} regras ativas</small></div>
    </div>
    <section class="painel"><header><h2>Mercado agora</h2><a href="#bolsa" class="btn mini">Ver tudo</a></header>
      <div class="kpis">${faixa.map((q) => `<a class="kpi" href="#${q.classe === "moeda" ? "cambio" : q.classe === "cripto" ? "cripto" : "bolsa"}" style="text-decoration:none;color:inherit"><span class="rotulo">${esc(q.nome)}</span><b>${q.preco != null ? (q.classe === "indice" ? fmtN(q.preco, 0) : moeda(q.preco, q.moeda === "pts" ? "BRL" : q.moeda || "BRL")) : "—"}</b><small><span class="${cls(q.variacao_pct)}">${pct(q.variacao_pct)}</span> · ${pill(q.tipo)}</small>${spark(q.historico)}</a>`).join("")}</div>
      ${avisoFonte()}
    </section>
    <div class="grade l2">
      <section class="painel"><header><h2>Funil de negociações</h2><a href="#crm" class="btn mini">Abrir CRM</a></header>
        ${barras(STATUS.map((s) => ({ r: s, v: prods.filter((p) => (p.status || "pesquisando") === s).length })), (v) => String(v))}</section>
      <section class="painel"><header><h2>Próximas tarefas</h2><button class="btn mini" data-a="novo" data-c="tarefas">Nova tarefa</button></header>
        ${tarefas.length ? `<ul style="margin:0;padding-left:18px">${tarefas.slice(0, 6).map((t) => `<li><span class="${t.prazo && t.prazo <= hoje() ? "queda" : ""}">${esc(dataBR(t.prazo, false))}</span> — ${esc(t.titulo)} <span class="suave">${esc(nomeDe("produtos", t.produto_id))}</span></li>`).join("")}</ul>` : `<div class="vazio">Sem tarefas abertas.</div>`}</section>
    </div>`;
};

function telaMercado(classes, titulo, sub) {
  const lista = cotacoes().filter((q) => classes.includes(q.classe));
  const id = "mk-" + classes[0];
  const sel = UI.ativo && lista.find((q) => q.id === UI.ativo) ? UI.ativo : lista.find((q) => q.historico?.length)?.id || lista[0]?.id;
  const q = lista.find((x) => x.id === sel);
  const usd = taxa("USD");
  return cab(titulo, sub, `<button class="btn" data-a="novo" data-c="watchlist">Acompanhar ativo</button><button class="btn" data-a="cotacao-manual">Lançar cotação manual</button>`) + avisoFonte() +
    `<div class="filtros">${filtro(id, "Filtrar ativos…")}</div>` +
    tabela(id, lista, [
      { l: "Ativo", h: (q) => `<button class="btn mini" data-a="ver-ativo" data-id="${esc(q.id)}">${esc(q.simbolo)}</button> <span class="suave">${esc(q.nome)}</span>`, ord: (q) => q.simbolo },
      { l: "Classe", v: (q) => CLASSES[q.classe] || q.classe },
      { l: "Preço", num: 1, h: (q) => q.preco == null ? "—" : `<span class="num ${MUDOU.has(q.id) ? "piscou " + MUDOU.get(q.id) : ""}">${q.moeda === "pts" ? fmtN(q.preco, 0) : moeda(q.preco, q.moeda || "BRL")}</span>`, ord: (q) => q.preco ?? -1 },
      ...(classes.includes("cripto") ? [{ l: "Em reais", num: 1, h: (q) => (q.preco != null && usd ? `<span class="num">${moeda(q.preco * usd.v)}</span>` : "—") }] : []),
      { l: "Variação", num: 1, h: (q) => `<span class="num ${cls(q.variacao_pct)}">${pct(q.variacao_pct)}</span>`, ord: (q) => q.variacao_pct ?? -999 },
      { l: "30 dias", h: (q) => spark(q.historico) },
      { l: "Horário", v: (q) => (q.horario ? dataBR(q.horario) : "—") },
      { l: "Fonte", v: (q) => q.fonte || "—" },
      { l: "Dados", h: (q) => pill(q.tipo), ord: (q) => q.tipo || "z" },
    ]) +
    (q ? `<section class="painel"><header><h2>${esc(q.simbolo)} · ${esc(q.nome)}</h2><span>${pill(q.tipo)} <span class="suave">${esc(q.fonte || "")}</span></span></header>
      ${grafico(q.historico, { rotuloY: (v) => fmtN(v, v > 1000 ? 0 : 2) })}
      <div class="acoes"><a class="btn mini" href="#trade" data-a="ver-ativo" data-id="${esc(q.id)}">Analisar no Trade Intelligence</a></div></section>` : "");
}
T.bolsa = () => telaMercado(["acao_br", "acao_us", "indice", "etf"], "Bolsa de Valores", "B3, mercado americano, índices e ETFs. Cada linha mostra a fonte, o horário e se o dado é em tempo real, atrasado ou indicativo.");
T.cripto = () => telaMercado(["cripto"], "Criptomoedas", "Bitcoin, Ethereum, Solana, BNB, XRP e outras que você acompanhar. Preços em dólar (par USDT) convertidos para reais pela cotação do dólar disponível.");
T.cambio = () => {
  const c = cfg(); const hist = Store.todos("conversoes").sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 12);
  return telaMercado(["moeda"], "Moedas e Câmbio", "Dólar, euro, yuan, libra, iene e outras. O câmbio daqui alimenta o custo nacionalizado dos produtos.") +
    `<section class="painel"><header><h2>Calculadora de moedas</h2><span class="suave">spread e tarifas em Configurações</span></header>
      <div class="grade">
        <label class="campo">Valor<input id="cv-valor" type="number" step="any" value="1000"></label>
        <label class="campo">De<select id="cv-de">${MOEDAS.map((m) => `<option ${m === "CNY" ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="campo">Para<select id="cv-para">${MOEDAS.map((m) => `<option ${m === "BRL" ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="campo">Spread (%)<input id="cv-spread" type="number" step="any" value="${esc(c.spread_pct)}"></label>
        <label class="campo">IOF (%)<input id="cv-iof" type="number" step="any" value="${esc(c.iof_pct)}"></label>
        <label class="campo">Tarifa fixa (R$)<input id="cv-tarifa" type="number" step="any" value="${esc(c.tarifa_fixa_brl)}"></label>
      </div>
      <div id="cv-res" class="linhas-calc">${linhasConversao()}</div>
      <div class="acoes"><button class="btn pri" data-a="salvar-conversao">Guardar no histórico</button></div>
      ${hist.length ? tabela("conv", hist, [{ l: "Quando", v: (h) => dataBR(h.criado_em) }, { l: "Origem", num: 1, v: (h) => moeda(h.valor, h.de) }, { l: "Resultado", num: 1, v: (h) => moeda(h.resultado, h.para) }, { l: "Cotação usada", num: 1, v: (h) => fmtN(h.cotacao, 4) }, { l: "Fonte", v: (h) => h.fonte }]) : ""}
    </section>`;
};
function conversao() {
  const g = (id, pad) => ($("#" + id) ? $("#" + id).value : pad);
  const valor = n(g("cv-valor", 1000)) || 0, de = g("cv-de", "CNY"), para = g("cv-para", "BRL");
  const td = taxa(de), tp = taxa(para);
  if (!td || !tp) return { erro: `Sem cotação de ${!td ? de : para}/BRL. Lance uma cotação manual ou ligue uma fonte.` };
  const cotacao = td.v / tp.v;
  const bruto = valor * cotacao, spread = bruto * (n(g("cv-spread", 0)) || 0) / 100, iof = bruto * (n(g("cv-iof", 0)) || 0) / 100, tarifa = (n(g("cv-tarifa", 0)) || 0) / tp.v;
  const destinoBRL = para === "BRL";
  const resultado = destinoBRL ? bruto + spread + iof + tarifa : bruto - spread - iof - tarifa;
  return { valor, de, para, cotacao, bruto, spread, iof, tarifa, resultado, fonte: [td.fonte, tp.fonte].filter((x) => x !== "—").join(" / ") || "—", horario: td.horario || tp.horario };
}
function linhasConversao() {
  const r = conversao(); if (r.erro) return `<span class="suave" style="grid-column:1/-1">${esc(r.erro)}</span>`;
  return `<span>Cotação ${r.de}→${r.para}</span><span class="num">${fmtN(r.cotacao, 6)}</span><span>Valor convertido</span><span class="num">${moeda(r.bruto, r.para)}</span>
    <span>Spread</span><span class="num">${moeda(r.spread, r.para)}</span><span>IOF</span><span class="num">${moeda(r.iof, r.para)}</span><span>Tarifa</span><span class="num">${moeda(r.tarifa, r.para)}</span>
    <span class="t">${r.para === "BRL" ? "Custo total em reais" : "Você recebe"}</span><span class="t num">${moeda(r.resultado, r.para)}</span>
    <span class="suave" style="grid-column:1/-1">Fonte: ${esc(r.fonte)}${r.horario ? " · " + esc(dataBR(r.horario)) : ""}</span>`;
}

T.trade = () => {
  const lista = cotacoes().filter((q) => q.historico?.length);
  const q = lista.find((x) => x.id === UI.ativo) || lista[0];
  const aba = UI.aba.trade || "analise";
  const abas = `<div class="ab" role="tablist">${[["analise", "Análise técnica"], ["backtest", "Backtesting"], ["paper", "Paper trading"], ["agentes", "Agentes"]].map(([k, r]) => `<button role="tab" aria-selected="${aba === k}" data-a="aba" data-t="trade" data-k="${k}">${r}</button>`).join("")}</div>`;
  const seletor = `<label class="campo" style="max-width:320px">Ativo<select id="tr-ativo" data-a2="trocar-ativo">${lista.map((x) => `<option value="${esc(x.id)}" ${x.id === q?.id ? "selected" : ""}>${esc(x.simbolo)} · ${esc(x.nome)}</option>`).join("")}</select></label>`;
  let corpo = "";
  if (aba === "agentes") corpo = telaAgentes();
  else if (aba === "paper") corpo = telaPaper();
  else if (!q) corpo = `<div class="vazio">MARKET WATCH AI precisa de histórico de preços. Assim que as cotações chegarem com histórico (servidor ou rotina de atualização), a análise aparece aqui.</div>`;
  else {
    const a = q.historico.map((p) => +p.c);
    if (aba === "analise") {
      const rsi = Ind.rsi(a), macd = Ind.macd(a), s20 = Ind.sma(a, 20).at(-1), s50 = Ind.sma(a, 50).at(-1), vol = Ind.volatilidade(a, q.classe === "cripto" ? 365 : 252), nv = Ind.niveis(a);
      const sinais = [];
      if (rsi != null) sinais.push(rsi > 70 ? "RSI acima de 70: sobrecompra" : rsi < 30 ? "RSI abaixo de 30: sobrevenda" : "RSI em zona neutra");
      if (macd) sinais.push(macd.hist > 0 ? "MACD acima da linha de sinal (momento positivo)" : "MACD abaixo da linha de sinal (momento negativo)");
      if (s20 && s50) sinais.push(s20 > s50 ? "Média de 20 acima da de 50 (tendência de alta)" : "Média de 20 abaixo da de 50 (tendência de baixa)");
      const ultVar = a.length > 1 ? (a.at(-1) / a.at(-2) - 1) * 100 : null;
      if (ultVar != null && vol && Math.abs(ultVar) > (vol / Math.sqrt(252)) * 2) sinais.push(`Movimento relevante: ${pct(ultVar)} no último período, mais de 2 desvios da volatilidade recente`);
      UI.ultimaAnalise = { q, rsi, macd, s20, s50, vol, nv, sinais, n: a.length };
      corpo = `${seletor}<div class="kpis">
        <div class="kpi"><span class="rotulo">Último preço</span><b>${fmtN(a.at(-1))}</b><small>${pill(q.tipo)} ${esc(dataBR(q.horario))}</small></div>
        <div class="kpi"><span class="rotulo">RSI 14</span><b>${fmtN(rsi, 1)}</b><small>Wilder</small></div>
        <div class="kpi"><span class="rotulo">MACD 12/26/9</span><b class="${cls(macd?.hist)}">${fmtN(macd?.hist, 3)}</b><small>histograma</small></div>
        <div class="kpi"><span class="rotulo">MM20 / MM50</span><b>${fmtN(s20)}</b><small>${fmtN(s50)}</small></div>
        <div class="kpi"><span class="rotulo">Volatilidade anual</span><b>${fmtN(vol, 1)}%</b><small>30 retornos</small></div>
        <div class="kpi"><span class="rotulo">Suporte / resistência</span><b>${fmtN(nv.suporte)}</b><small>${fmtN(nv.resistencia)}</small></div></div>
        ${grafico(q.historico, { linhas: [{ v: nv.suporte, cor: "var(--alta)", r: "suporte" }, { v: nv.resistencia, cor: "var(--queda)", r: "resistência" }] })}
        <section class="painel"><header><h2>Sinais calculados</h2><span class="suave">${a.length} pontos de histórico · ${esc(q.fonte || "")}</span></header>
          <ul style="margin:0;padding-left:18px">${sinais.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>Histórico curto demais para sinais.</li>"}</ul>
          <div class="nota ia"><b>MARKET WATCH AI</b> escreve a leitura com fundamentos, dados usados, cenário alternativo e grau de incerteza. Não promete acerto nem executa ordens.</div>
          <div class="acoes"><button class="btn ia" data-a="ia-analise">Pedir análise ao MARKET WATCH AI</button><button class="btn" data-a="novo-alerta-ativo" data-id="${esc(q.id)}">Criar alerta para ${esc(q.simbolo)}</button></div>
          ${caixaIA("analise")}</section>`;
    } else {
      const r = UI.bt || { rapida: 9, lenta: 21, custo: 0.1 };
      const b = Ind.backtest(a, r.rapida, r.lenta, r.custo);
      corpo = `${seletor}<section class="painel"><header><h2>Cruzamento de médias móveis</h2><span class="pill sim">simulação histórica</span></header>
        <div class="grade"><label class="campo">Média rápida<input id="bt-rapida" type="number" value="${r.rapida}"></label><label class="campo">Média lenta<input id="bt-lenta" type="number" value="${r.lenta}"></label><label class="campo">Custo por operação (%)<input id="bt-custo" type="number" step="any" value="${r.custo}"></label></div>
        <div class="acoes"><button class="btn pri" data-a="rodar-bt">Rodar backtest</button></div>
        ${b ? `<div class="kpis"><div class="kpi"><span class="rotulo">Retorno da estratégia</span><b class="${cls(b.retorno)}">${pct(b.retorno)}</b></div><div class="kpi"><span class="rotulo">Comprar e manter</span><b class="${cls(b.compraEMantem)}">${pct(b.compraEMantem)}</b></div>
          <div class="kpi"><span class="rotulo">Operações</span><b>${b.operacoes}</b><small>acerto ${b.acerto == null ? "—" : fmtN(b.acerto, 0) + "%"}</small></div><div class="kpi"><span class="rotulo">Maior queda</span><b class="queda">-${fmtN(b.drawdown, 1)}%</b></div></div>
          <div class="nota">Resultado passado de uma regra simples sobre ${a.length} pontos de ${esc(q.fonte || "fonte desconhecida")}. Não indica resultado futuro. Custos, impostos e deslizamento reais podem ser maiores.</div>` : `<div class="vazio">Histórico menor que a média lenta + 2 pontos.</div>`}
      </section>`;
    }
  }
  return cab("Trade Intelligence", "MARKET WATCH AI: indicadores, suportes e resistências, backtesting, paper trading e relatórios de risco. Nada aqui é recomendação de investimento.") + abas + corpo;
};
function telaPaper() {
  const ops = Store.todos("paper").sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const pos = {};
  for (const o of [...ops].reverse()) {
    const p = (pos[o.simbolo] ||= { qtd: 0, custo: 0, realizado: 0 });
    if (o.lado === "compra") { p.custo += o.qtd * o.preco; p.qtd += o.qtd; }
    else { const pm = p.qtd ? p.custo / p.qtd : 0; p.realizado += (o.preco - pm) * o.qtd; p.custo -= pm * o.qtd; p.qtd -= o.qtd; }
  }
  return `<div class="nota"><b>Paper trading:</b> ordens fictícias para testar estratégias. Não são investimentos reais e não aparecem na sua carteira.</div>
    <section class="painel"><header><h2>Nova ordem simulada</h2><span class="pill sim">simulação</span></header>
    <div class="grade"><label class="campo">Ativo<select id="pp-ativo">${cotacoes().map((q) => `<option value="${esc(q.id)}">${esc(q.simbolo)}</option>`).join("")}</select></label>
      <label class="campo">Lado<select id="pp-lado"><option value="compra">Compra</option><option value="venda">Venda</option></select></label>
      <label class="campo">Quantidade<input id="pp-qtd" type="number" step="any" value="1"></label>
      <label class="campo">Preço (vazio = cotação atual)<input id="pp-preco" type="number" step="any"></label></div>
    <div class="acoes"><button class="btn pri" data-a="paper-ordem">Registrar ordem simulada</button></div></section>
    ${tabela("paper-pos", Object.entries(pos).filter(([, p]) => p.qtd || p.realizado).map(([s, p]) => ({ s, ...p })), [
      { l: "Ativo", v: (p) => p.s }, { l: "Quantidade", num: 1, v: (p) => fmtN(p.qtd, 4) }, { l: "Preço médio", num: 1, v: (p) => fmtN(p.qtd ? p.custo / p.qtd : null) },
      { l: "Preço atual", num: 1, v: (p) => fmtN(cot(p.s)?.preco) }, { l: "Resultado aberto", num: 1, h: (p) => { const c = cot(p.s); const r = c && p.qtd ? c.preco * p.qtd - p.custo : null; return `<span class="num ${cls(r)}">${fmtN(r)}</span>`; } },
      { l: "Realizado", num: 1, h: (p) => `<span class="num ${cls(p.realizado)}">${fmtN(p.realizado)}</span>` }, { l: "", h: () => `<span class="pill sim">simulado</span>` },
    ], { vazio: "Nenhuma posição simulada." })}
    ${tabela("paper-ops", ops, [{ l: "Data", v: (o) => dataBR(o.data) }, { l: "Ativo", k: "simbolo" }, { l: "Lado", k: "lado" }, { l: "Qtd.", num: 1, v: (o) => fmtN(o.qtd, 4) }, { l: "Preço", num: 1, v: (o) => fmtN(o.preco) }, { l: "Fonte do preço", k: "fonte" }, { l: "", h: (o) => `<button class="btn mini perigo" data-a="excluir" data-c="paper" data-id="${esc(o.id)}">Excluir</button>` }], { vazio: "Nenhuma ordem simulada." })}`;
}

// ---------- agentes ----------
const AGENTES = [
  { id: "market_watch", nome: "MARKET WATCH", faz: "Monitora ações e índices da sua watchlist e aponta movimentos relevantes de preço.", fontes: "cotações carregadas (servidor/rotina)" },
  { id: "crypto_radar", nome: "CRYPTO RADAR", faz: "Ordena criptomoedas por variação e volatilidade.", fontes: "Binance (via servidor/rotina)" },
  { id: "forex_monitor", nome: "FOREX MONITOR", faz: "Mostra o câmbio e quanto a variação do yuan e do dólar muda o custo dos seus produtos.", fontes: "AwesomeAPI / Banco Central (via servidor)" },
  { id: "china_scanner", nome: "CHINA SCANNER", faz: "Traduz a busca para chinês e abre a pesquisa nas 7 plataformas chinesas e no Brasil.", fontes: "links de busca públicos; tradução por IA ou Aliyun Machine Translation" },
  { id: "trend_hunter", nome: "TREND HUNTER", faz: "Ranqueia produtos por margem e interesse de busca e sugere ideias para validar.", fontes: "seu catálogo; Google Trends (pytrends) via servidor" },
  { id: "import_analyst", nome: "IMPORT ANALYST", faz: "Calcula custo nacionalizado e a sensibilidade ao câmbio (±5%).", fontes: "seu catálogo, câmbio e tributos de Configurações" },
  { id: "crm_assistant", nome: "CRM ASSISTANT", faz: "Aponta tarefas vencidas, negociações paradas, links duplicados e fornecedores sem contato.", fontes: "seus cadastros" },
];
function telaAgentes() {
  const log = Store.todos("agentes_log").sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  return `<div class="grade l2">${AGENTES.map((g) => `<section class="painel"><header><h3>${esc(g.nome)}</h3><button class="btn mini pri" data-a="rodar-agente" data-id="${g.id}">Executar</button></header>
    <p style="margin:0">${esc(g.faz)}</p><small class="suave">Fontes: ${esc(g.fontes)}</small>${UI.resultadoIA["ag-" + g.id] ? caixaIA("ag-" + g.id) : ""}</section>`).join("")}</div>
    <h2>Histórico de execuções</h2>
    ${tabela("aglog", log, [{ l: "Quando", v: (r) => dataBR(r.criado_em) }, { l: "Agente", k: "agente" }, { l: "Resultado", h: (r) => `<details><summary>${esc(String(r.resultado).slice(0, 80))}…</summary><div class="saida-ia">${esc(r.resultado)}</div><small class="suave">Fontes: ${esc(r.fontes)} · Limitações: ${esc(r.limitacoes)}</small></details>` }], { vazio: "Nenhum agente executado ainda." })}`;
}
const AG = {
  market_watch() {
    const alvos = new Set([...Store.todos("watchlist").map((w) => w.simbolo), "IBOV", "SPX", "PETR4", "VALE3", "AAPL", "NVDA"]);
    const qs = cotacoes().filter((q) => alvos.has(q.id) && q.preco != null);
    if (!qs.length) return { r: "Sem cotações carregadas para os ativos monitorados.", lim: "Nenhuma fonte de mercado ativa." };
    const rel = qs.map((q) => { const a = (q.historico || []).map((p) => +p.c); const vol = Ind.volatilidade(a); const rsi = Ind.rsi(a);
      const forte = vol && q.variacao_pct != null && Math.abs(q.variacao_pct) > (vol / Math.sqrt(252)) * 2;
      return `${q.simbolo}: ${fmtN(q.preco)} (${pct(q.variacao_pct)}) RSI ${fmtN(rsi, 0)}${forte ? " ⚠ movimento acima de 2 desvios" : ""} [${q.tipo || "?"}, ${q.fonte || "?"}]`; });
    return { r: rel.join("\n"), lim: "Indicadores dependem do tamanho do histórico; dados atrasados não servem para operar no curto prazo." };
  },
  crypto_radar() {
    const qs = cotacoes().filter((q) => q.classe === "cripto" && q.preco != null).sort((a, b) => Math.abs(b.variacao_pct || 0) - Math.abs(a.variacao_pct || 0));
    if (!qs.length) return { r: "Sem cotações de criptomoedas carregadas.", lim: "Fonte Binance não ativa." };
    return { r: qs.map((q) => `${q.simbolo}: US$ ${fmtN(q.preco)} (${pct(q.variacao_pct)}) vol. anual ${fmtN(Ind.volatilidade((q.historico || []).map((p) => +p.c), 365), 0)}%`).join("\n"), lim: "Criptomoedas negociam 24 h; a variação é das últimas 24 h na Binance." };
  },
  forex_monitor() {
    const fx = cotacoes().filter((q) => q.classe === "moeda" && q.preco != null);
    const prods = Store.todos("produtos").filter((p) => p.preco_origem);
    const linhas = fx.map((q) => `${q.simbolo}: ${fmtN(q.preco, 4)} (${pct(q.variacao_pct)}) [${q.fonte}]`);
    const cny = taxa("CNY");
    if (cny && prods.length) {
      const base = prods.map((p) => ({ p, c: custoImportacao(p) })).filter((x) => !x.c.erro);
      const tot = base.reduce((s, x) => s + x.c.total, 0);
      linhas.push(`\nCusto total dos ${base.length} produtos com dados: ${moeda(tot)}. Cada 1% de alta do yuan e do dólar aumenta esse custo em cerca de ${moeda(tot * 0.01)}.`);
    }
    return { r: linhas.join("\n") || "Sem cotações de câmbio carregadas.", lim: "Estimativa linear; tributos com parcelas fixas (Siscomex) não variam com o câmbio." };
  },
  async china_scanner() { location.hash = "china"; return { r: "Abra a busca em Importações da China e digite o produto.", lim: "Busca feita nos sites oficiais por link; preços precisam ser conferidos no anúncio." }; },
  async trend_hunter() {
    const rk = rankingProdutos().slice(0, 8);
    const base = rk.map((x, i) => `${i + 1}. ${x.p.nome}: margem ${pct(x.c.margem, 1)}, custo ${moeda(x.c.unit)}, venda ${moeda(x.c.pv)}`).join("\n") || "Sem produtos com preço de origem, câmbio e preço de venda.";
    const tend = Store.todos("tendencias").map((t) => `${t.termo}: interesse recente ${t.serie?.at(-1)?.valor ?? "?"} (${t.fonte})`).join("\n");
    const txt = await perguntarIA("ag-trend_hunter", `Você é o TREND HUNTER de um importador brasileiro que compra da China e revende no Brasil. Com base APENAS nos dados abaixo, sugira até 6 ideias de produtos ou ajustes no mix para validar. Para cada ideia: por que, que dado sustenta, risco e como validar (ex.: Google Trends, Mercado Livre). Diga claramente que são hipóteses, não dados de demanda. Não invente números de vendas nem preços.\n\nRanking por margem:\n${base}\n\nTendências coletadas:\n${tend || "nenhuma"}\n\nResponda em português, em texto simples.`);
    if (!txt) UI.resultadoIA["ag-trend_hunter"] = { texto: base + "\n\n(IA indisponível neste acesso: mostrando só o ranking por margem.)" };
    return { r: txt || base, lim: "Ideias são hipóteses da IA a partir do seu catálogo; confirme a demanda antes de comprar." };
  },
  import_analyst() {
    const ps = Store.todos("produtos").map((p) => ({ p, c: custoImportacao(p) }));
    const ok = ps.filter((x) => !x.c.erro);
    const lin = ok.map((x) => { const p5 = x.c.unit * 1.05; return `${x.p.nome}: custo ${moeda(x.c.unit)}/un. (lote ${x.c.qtd}); com câmbio +5% ≈ ${moeda(p5)}; margem ${pct(x.c.margem, 1)}`; });
    const faltam = ps.filter((x) => x.c.erro).map((x) => `${x.p.nome}: ${x.c.erro}`);
    return { r: [...lin, ...(faltam.length ? ["\nSem cálculo:", ...faltam] : [])].join("\n") || "Nenhum produto cadastrado.", lim: "Tributos são estimativas com as alíquotas de Configurações; confirme NCM, ex-tarifário e regime com um despachante." };
  },
  crm_assistant() {
    const h = hoje(), sete = new Date(Date.now() - 7 * 864e5).toISOString();
    const venc = Store.todos("tarefas").filter((t) => !t.feita && t.prazo && t.prazo <= h).map((t) => `Tarefa vencida: ${t.titulo} (${dataBR(t.prazo, false)})`);
    const lemb = Store.todos("produtos").filter((p) => p.lembrete && p.lembrete <= h && !["comprado", "descartado"].includes(p.status)).map((p) => `Lembrete: ${p.nome} — ${p.proxima_tarefa || "sem tarefa"}`);
    const parados = Store.todos("produtos").filter((p) => ["negociando", "cotado"].includes(p.status) && (p.atualizado_em || "") < sete).map((p) => `Negociação parada há mais de 7 dias: ${p.nome}`);
    const urls = {}; const dups = [];
    for (const l of Store.todos("links")) { const u = (l.url || "").replace(/\/$/, ""); if (urls[u]) dups.push(`Link duplicado: ${l.titulo || u}`); urls[u] = 1; }
    const comContato = new Set(Store.todos("contatos").map((c) => c.fornecedor_id));
    const sem = Store.todos("fornecedores").filter((f) => !comContato.has(f.id)).map((f) => `Fornecedor sem contato registrado: ${f.nome}`);
    const tudo = [...venc, ...lemb, ...parados, ...dups, ...sem];
    return { r: tudo.join("\n") || "Tudo em dia: nenhuma pendência encontrada.", lim: "Analisa só o que está cadastrado; respostas de fornecedores fora do sistema não aparecem." };
  },
};
async function rodarAgente(id) {
  const g = AGENTES.find((a) => a.id === id);
  const out = await AG[id]();
  if (!UI.resultadoIA["ag-" + id] || !["trend_hunter"].includes(id)) UI.resultadoIA["ag-" + id] = { texto: out.r };
  await registrarAgente(g.nome, "execução manual", out.r, g.fontes, out.lim);
  render();
}

// ---------- China ----------
const GLOSSARIO = { "fone de ouvido": ["耳机", "earphones"], "fone bluetooth": ["蓝牙耳机", "bluetooth earbuds"], "luminária": ["台灯", "lamp"], "led": ["LED灯", "led light"], "garrafa térmica": ["保温杯", "thermos bottle"],
  "capinha de celular": ["手机壳", "phone case"], "carregador": ["充电器", "charger"], "relógio inteligente": ["智能手表", "smart watch"], "mochila": ["背包", "backpack"], "brinquedo": ["玩具", "toy"],
  "roupa": ["服装", "clothing"], "tênis": ["运动鞋", "sneakers"], "bolsa feminina": ["女包", "women handbag"], "maquiagem": ["化妆品", "makeup"], "ferramenta": ["工具", "tools"], "cabo usb": ["数据线", "usb cable"],
  "caixa de som": ["音箱", "speaker"], "câmera": ["摄像头", "camera"], "panela": ["锅", "cookware"], "organizador": ["收纳盒", "organizer"], "óculos de sol": ["太阳镜", "sunglasses"], "pet": ["宠物用品", "pet supplies"] };
function linksBusca(pt, zh, en) {
  const e = encodeURIComponent, enQ = en || pt, zhQ = zh || enQ;
  return [
    ["1688", `https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=${e(zhQ)}`, "atacado chinês, preço em yuan, busca em chinês"],
    ["Alibaba", `https://www.alibaba.com/trade/search?SearchText=${e(enQ)}`, "atacado internacional, preço em US$, MOQ"],
    ["AliExpress", `https://pt.aliexpress.com/wholesale?SearchText=${e(enQ)}`, "varejo com envio ao Brasil"],
    ["Made-in-China", `https://www.made-in-china.com/multi-search/${e(enQ)}/F1/1.html`, "fabricantes verificados"],
    ["Global Sources", `https://www.globalsources.com/searchList/products?keyWord=${e(enQ)}`, "fornecedores para importadores"],
    ["DHgate", `https://www.dhgate.com/wholesale/search.do?searchkey=${e(enQ)}`, "pequenos lotes"],
    ["Taobao", `https://s.taobao.com/search?q=${e(zhQ)}`, "varejo chinês, busca em chinês"],
    ["Mercado Livre (BR)", `https://lista.mercadolivre.com.br/${e(pt.trim().replace(/\s+/g, "-"))}`, "preço de venda no Brasil"],
    ["Shopee (BR)", `https://shopee.com.br/search?keyword=${e(pt)}`, "preço de venda no Brasil"],
    ["Google Trends (BR)", `https://trends.google.com.br/trends/explore?geo=BR&q=${e(pt)}`, "interesse de busca no Brasil"],
  ];
}
T.china = () => {
  const sc = UI.scanner;
  const prods = Store.todos("produtos");
  return cab("Importações da China", "CHINA PRODUCT INTELLIGENCE: pesquise nas plataformas chinesas, salve o produto com preço em yuan e veja o custo nacionalizado e a margem no Brasil.", `<button class="btn pri" data-a="novo" data-c="produtos">Cadastrar produto</button>`) +
    `<section class="painel"><header><h2>CHINA SCANNER</h2><span class="suave">1688 · Alibaba · AliExpress · Made-in-China · Global Sources · DHgate · Taobao</span></header>
      <div class="filtros"><input type="search" id="sc-termo" placeholder="O que você quer importar? ex.: garrafa térmica inox" value="${esc(sc?.pt || "")}"><button class="btn pri" data-a="scanner">Pesquisar</button></div>
      ${sc ? `<div class="chips"><span class="chip">PT: ${esc(sc.pt)}</span><span class="chip">中文: ${esc(sc.zh || "—")}</span><span class="chip">EN: ${esc(sc.en || "—")}</span><span class="suave" style="font-size:.78rem">${esc(sc.origem)}</span></div>
        ${sc.variantes?.length ? `<div class="chips">${sc.variantes.map((v) => `<span class="chip">${esc(v)}</span>`).join("")}</div>` : ""}
        <div class="tabela"><table><thead><tr><th>Plataforma</th><th>Para quê</th><th></th></tr></thead><tbody>${linksBusca(sc.pt, sc.zh, sc.en).map(([p, u, d]) => `<tr><td><b>${esc(p)}</b></td><td class="suave">${esc(d)}</td><td><span class="acoes"><a class="btn mini" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Abrir busca ↗</a>${PLATAFORMAS.includes(p) ? `<button class="btn mini" data-a="salvar-da-busca" data-p="${esc(p)}">Salvar produto daqui</button>` : ""}</span></td></tr>`).join("")}</tbody></table></div>
        <div class="nota">As plataformas não oferecem API pública gratuita de busca; por isso a pesquisa abre o site oficial. Copie preço, MOQ e link do anúncio para “Salvar produto”. Com credenciais da Open Platform do 1688/Alibaba, o servidor traz os resultados direto (veja Administração).</div>` : ""}
    </section>
    <div class="filtros">${filtro("prod", "Filtrar produtos…")}</div>` +
    tabela("prod", prods, [
      { l: "", h: (p) => (linkSeguro(p.imagem) ? `<img class="thumb" src="${esc(p.imagem)}" alt="" loading="lazy">` : `<span class="thumb" style="display:inline-block"></span>`) },
      { l: "Produto", h: (p) => `<b>${esc(p.nome)}</b>${exemplo(p)}<br><small class="suave">${esc(p.nome_cn || "")} ${p.plataforma ? "· " + esc(p.plataforma) : ""}</small>`, ord: (p) => p.nome },
      { l: "Fornecedor", v: (p) => nomeDe("fornecedores", p.fornecedor_id) || "—" },
      { l: "Preço origem", num: 1, v: (p) => moeda(p.preco_origem, p.moeda || "CNY"), ord: (p) => +p.preco_origem || 0 },
      { l: "Em reais", num: 1, v: (p) => moeda(emBRL(n(p.preco_origem), p.moeda || "CNY")) },
      { l: "MOQ", num: 1, v: (p) => fmtN(p.moq, 0) },
      { l: "Custo nacionalizado/un.", num: 1, h: (p) => { const c = custoImportacao(p); return c.erro ? `<span class="suave" title="${esc(c.erro)}">faltam dados</span>` : `<span class="num">${moeda(c.unit)}</span>`; }, ord: (p) => custoImportacao(p).unit ?? 1e12 },
      { l: "Venda BR", num: 1, v: (p) => moeda(p.preco_venda_br) },
      { l: "Margem", num: 1, h: (p) => { const c = custoImportacao(p); return `<span class="num ${cls(c.margem)}">${pct(c.margem, 1)}</span>`; }, ord: (p) => custoImportacao(p).margem ?? -999 },
      { l: "Status", h: (p) => `<span class="pill st-${esc(p.status || "pesquisando")}">${esc(p.status || "pesquisando")}</span>` },
      { l: "", h: (p) => acoesLinha("produtos", p, `<button class="btn mini" data-a="ver-custo" data-id="${esc(p.id)}">Custo</button>${abrirLink(p.link)}`) },
    ], { vazio: "Nenhum produto ainda. Use o CHINA SCANNER acima ou cadastre direto.", acao: ` <button class="btn pri" data-a="novo" data-c="produtos">Cadastrar produto</button>` });
};
function janelaCusto(id) {
  const p = Store.um("produtos", id); const c = custoImportacao(p);
  $("#janela-raiz").innerHTML = `<div class="veu" data-a="fechar-veu"><div class="janela"><header><h2>Custo nacionalizado · ${esc(p.nome)}</h2><button class="btn" data-a="fechar">Fechar</button></header>
    ${c.erro ? `<div class="nota">${esc(c.erro)}</div>` : `<div class="linhas-calc">${c.linhas.map(([r, v]) => `<span>${esc(r)}</span><span class="num">${moeda(v)}</span>`).join("")}
      <span class="t">Custo total do lote (${c.qtd} un.)</span><span class="t num">${moeda(c.total)}</span><span class="t">Custo por unidade</span><span class="t num">${moeda(c.unit)}</span>
      ${c.pv != null ? `<span>Preço de venda no Brasil</span><span class="num">${moeda(c.pv)}</span><span>Líquido após taxa do canal (${cfg().taxa_canal_pct}%)</span><span class="num">${moeda(c.liquido)}</span><span class="t">Margem estimada</span><span class="t num ${cls(c.margem)}">${pct(c.margem, 1)}</span>` : ""}</div>
      <p class="suave" style="font-size:.82rem;margin:0">Câmbio: ${esc(p.moeda || "CNY")} ${fmtN(c.cambio.prod.v, 4)} (${esc(c.cambio.prod.fonte)}) · USD ${fmtN(c.cambio.usd.v, 4)} (${esc(c.cambio.usd.fonte)}) · spread ${cfg().spread_pct}%. Regime: ${p.regime === "remessa" ? "Remessa Conforme" : "importação formal"}. Estimativa: confirme NCM, alíquotas e regime com despachante.</p>`}
  </div></div>`;
}

function rankingProdutos() {
  return Store.todos("produtos").filter((p) => p.status !== "descartado").map((p) => ({ p, c: custoImportacao(p) })).filter((x) => !x.c.erro && x.c.margem != null).sort((a, b) => b.c.margem - a.c.margem);
}
T.alta = () => {
  const rk = rankingProdutos();
  const novos = Store.todos("produtos").sort((a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")).slice(0, 6);
  const atacado = rk.filter((x) => n(x.p.moq) >= 50).slice(0, 6);
  const tend = Store.todos("tendencias");
  return cab("Produtos em Alta", "TREND HUNTER: ranking por margem estimada, novidades, oportunidades de atacado e interesse de busca (Google Trends via pytrends no servidor).", `<button class="btn ia" data-a="rodar-agente" data-id="trend_hunter">Pedir ideias ao TREND HUNTER</button>`) +
    (UI.resultadoIA["ag-trend_hunter"] ? `<section class="painel"><header><h2>Ideias para validar</h2><span class="pill sim">hipóteses da IA</span></header>${caixaIA("ag-trend_hunter")}</section>` : "") +
    `<div class="grade l2"><section class="painel"><header><h2>Maiores margens</h2></header>${rk.length ? barras(rk.slice(0, 8).map((x) => ({ r: x.p.nome, v: x.c.margem })), (v) => pct(v, 1)) : `<div class="vazio">Cadastre produtos com preço de origem, câmbio e preço de venda no Brasil.</div>`}</section>
     <section class="painel"><header><h2>Oportunidades de atacado</h2><span class="suave">MOQ ≥ 50</span></header>${atacado.length ? `<ul style="margin:0;padding-left:18px">${atacado.map((x) => `<li>${esc(x.p.nome)} — MOQ ${fmtN(x.p.moq, 0)}, custo ${moeda(x.c.unit)}, margem <span class="${cls(x.c.margem)}">${pct(x.c.margem, 1)}</span></li>`).join("")}</ul>` : `<div class="vazio">Nenhum produto com MOQ de atacado e margem calculada.</div>`}</section>
     <section class="painel"><header><h2>Novidades no seu catálogo</h2></header>${novos.length ? `<ul style="margin:0;padding-left:18px">${novos.map((p) => `<li>${esc(p.nome)} <span class="suave">${esc(dataBR(p.criado_em, false))}</span></li>`).join("")}</ul>` : `<div class="vazio">Sem produtos.</div>`}</section>
     <section class="painel"><header><h2>Interesse de busca no Brasil</h2><span class="suave">Google Trends</span></header>
       ${tend.length ? tend.map((t) => `<div><b>${esc(t.termo)}</b> <small class="suave">${esc(t.fonte)} · ${esc(dataBR(t.coletado_em))}</small>${grafico((t.serie || []).map((s) => ({ t: s.data, c: s.valor })), { altura: 140, rotuloY: (v) => fmtN(v, 0) })}</div>`).join("") : `<div class="vazio">Nenhuma série coletada. O servidor coleta com pytrends (Google Trends) para os termos que você definir; ou abra o Google Trends pelo CHINA SCANNER.</div>`}</section></div>`;
};

T.fornecedores = () => {
  const fs = Store.todos("fornecedores");
  const grupos = {};
  for (const p of Store.todos("produtos")) { const k = (p.categoria || p.nome || "").toLowerCase().trim(); if (!k) continue; (grupos[k] ||= []).push(p); }
  const comparaveis = Object.entries(grupos).filter(([, ps]) => new Set(ps.map((p) => p.fornecedor_id).filter(Boolean)).size > 1);
  return cab("Fornecedores", "Contatos, plataforma, verificação e histórico de cada fornecedor.", `<button class="btn pri" data-a="novo" data-c="fornecedores">Novo fornecedor</button><button class="btn" data-a="novo" data-c="contatos">Registrar contato</button>`) +
    `<div class="filtros">${filtro("forn", "Filtrar fornecedores…")}</div>` +
    tabela("forn", fs, [
      { l: "Empresa", h: (f) => `<b>${esc(f.nome)}</b>${exemplo(f)}${f.verificado ? ' <span class="pill real">verificado</span>' : ""}<br><small class="suave">${esc([f.cidade, f.pais].filter(Boolean).join(", "))}</small>`, ord: (f) => f.nome },
      { l: "Contato", h: (f) => `${esc(f.contato_nome || "")}<br><small class="suave">${esc([f.email, f.whatsapp, f.wechat && "WeChat " + f.wechat].filter(Boolean).join(" · "))}</small>` },
      { l: "Plataforma", k: "plataforma" }, { l: "Avaliação", num: 1, v: (f) => (f.avaliacao ? "★".repeat(Math.min(5, f.avaliacao)) : "—") },
      { l: "Produtos", num: 1, v: (f) => Store.todos("produtos").filter((p) => p.fornecedor_id === f.id).length },
      { l: "Último contato", v: (f) => dataBR(Store.todos("contatos").filter((c) => c.fornecedor_id === f.id).map((c) => c.data).sort().at(-1), false) },
      { l: "", h: (f) => acoesLinha("fornecedores", f, abrirLink(f.link, "Loja ↗")) },
    ], { vazio: "Nenhum fornecedor cadastrado." }) +
    `<section class="painel"><header><h2>Comparar fornecedores do mesmo produto</h2><span class="suave">agrupado por categoria</span></header>
      ${comparaveis.length ? comparaveis.map(([k, ps]) => `<h3>${esc(k)}</h3>` + tabela("cmp-" + k.replace(/\W/g, ""), ps, [
        { l: "Fornecedor", v: (p) => nomeDe("fornecedores", p.fornecedor_id) || "—" }, { l: "Produto", k: "nome" }, { l: "Preço", num: 1, v: (p) => moeda(p.preco_origem, p.moeda || "CNY") },
        { l: "MOQ", num: 1, v: (p) => fmtN(p.moq, 0) }, { l: "Custo/un.", num: 1, v: (p) => moeda(custoImportacao(p).unit) }, { l: "Margem", num: 1, h: (p) => `<span class="${cls(custoImportacao(p).margem)}">${pct(custoImportacao(p).margem, 1)}</span>` },
      ])).join("") : `<div class="vazio">Quando dois fornecedores tiverem produtos com a mesma categoria, a comparação aparece aqui.</div>`}</section>
    <section class="painel"><header><h2>Histórico de contatos</h2></header>${tabela("cont", Store.todos("contatos").sort((a, b) => (b.data || "").localeCompare(a.data || "")), [
      { l: "Data", v: (c) => dataBR(c.data, false) }, { l: "Fornecedor", v: (c) => nomeDe("fornecedores", c.fornecedor_id) }, { l: "Produto", v: (c) => nomeDe("produtos", c.produto_id) },
      { l: "Canal", k: "canal" }, { l: "", v: (c) => (c.direcao === "recebido" ? "respondeu" : "enviado") }, { l: "Resumo", k: "resumo" }, { l: "", h: (c) => acoesLinha("contatos", c) }], { vazio: "Nenhum contato registrado." })}</section>`;
};

T.crm = () => {
  const prods = Store.todos("produtos");
  const tarefas = Store.todos("tarefas").sort((a, b) => (a.prazo || "9").localeCompare(b.prazo || "9"));
  return cab("CRM de negociações", "Funil visual dos produtos e fornecedores: mova cada cartão de etapa, registre contatos e tarefas.", `<button class="btn pri" data-a="novo" data-c="produtos">Nova negociação</button><button class="btn" data-a="novo" data-c="tarefas">Nova tarefa</button>`) +
    `<div class="funil">${STATUS.map((s, i) => { const ps = prods.filter((p) => (p.status || "pesquisando") === s);
      return `<div class="coluna"><h3><span class="pill st-${s}">${esc(s)}</span><span class="suave">${ps.length}</span></h3>${ps.map((p) => { const c = custoImportacao(p);
        return `<div class="cartao"><b>${esc(p.nome)}</b>${exemplo(p)}<span class="suave">${esc(nomeDe("fornecedores", p.fornecedor_id) || "sem fornecedor")}</span>
          <div class="linha"><span class="num">${moeda(p.preco_origem, p.moeda || "CNY")}</span><span class="num ${cls(c.margem)}">${pct(c.margem, 1)}</span></div>
          ${p.proxima_tarefa ? `<span>→ ${esc(p.proxima_tarefa)} ${p.lembrete ? `<span class="${p.lembrete <= hoje() ? "queda" : "suave"}">${esc(dataBR(p.lembrete, false))}</span>` : ""}</span>` : ""}
          <div class="linha"><span class="acoes">${i > 0 ? `<button class="btn mini" data-a="mover" data-id="${esc(p.id)}" data-s="${STATUS[i - 1]}" aria-label="Voltar etapa">←</button>` : ""}${i < STATUS.length - 1 ? `<button class="btn mini" data-a="mover" data-id="${esc(p.id)}" data-s="${STATUS[i + 1]}" aria-label="Avançar etapa">→</button>` : ""}</span>
          <span class="acoes"><button class="btn mini" data-a="contato-de" data-id="${esc(p.id)}">Contato</button><button class="btn mini" data-a="editar" data-c="produtos" data-id="${esc(p.id)}">Abrir</button></span></div></div>`; }).join("")}</div>`; }).join("")}</div>
    <section class="painel"><header><h2>Tarefas e lembretes</h2></header>${tabela("tar", tarefas, [
      { l: "", h: (t) => `<input type="checkbox" aria-label="Concluída" data-a="feita" data-id="${esc(t.id)}" ${t.feita ? "checked" : ""}>` },
      { l: "Prazo", h: (t) => `<span class="${!t.feita && t.prazo && t.prazo <= hoje() ? "queda" : ""}">${esc(dataBR(t.prazo, false))}</span>`, ord: (t) => t.prazo || "9" },
      { l: "Tarefa", h: (t) => `<span style="${t.feita ? "text-decoration:line-through;color:var(--suave)" : ""}">${esc(t.titulo)}</span>` },
      { l: "Produto", v: (t) => nomeDe("produtos", t.produto_id) }, { l: "Fornecedor", v: (t) => nomeDe("fornecedores", t.fornecedor_id) }, { l: "", h: (t) => acoesLinha("tarefas", t) }], { vazio: "Nenhuma tarefa." })}</section>`;
};

T.vendas = () => {
  const vs = Store.todos("vendas").sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const val = vendasValidas().map((v) => ({ v, r: resumoVenda(v) }));
  const porMes = {}; for (const { v, r } of val) { const m = (v.data || "").slice(0, 7); porMes[m] = (porMes[m] || 0) + r.receita; }
  const porCanal = {}; for (const { v, r } of val) porCanal[v.canal || "—"] = (porCanal[v.canal || "—"] || 0) + (r.lucro || 0);
  const fat = val.reduce((s, x) => s + x.r.receita, 0), luc = val.reduce((s, x) => s + (x.r.lucro || 0), 0);
  const comprados = Store.todos("produtos").filter((p) => p.status === "comprado");
  const aba = UI.aba.vendas || "vendas";
  return cab("Vendas e Clientes", "Registre vendas dos produtos importados. O lucro usa o custo nacionalizado de cada produto e a taxa do canal.", `<button class="btn pri" data-a="novo" data-c="vendas">Registrar venda</button><button class="btn" data-a="novo" data-c="clientes">Novo cliente</button>`) +
    `<div class="kpis"><div class="kpi"><span class="rotulo">Faturamento total</span><b>${moeda(fat)}</b><small>${val.length} vendas válidas</small></div><div class="kpi"><span class="rotulo">Lucro estimado</span><b class="${cls(luc)}">${moeda(luc)}</b><small>margem ${fat ? pct((luc / fat) * 100, 1) : "—"}</small></div>
     <div class="kpi"><span class="rotulo">Ticket médio</span><b>${moeda(val.length ? fat / val.length : null)}</b></div><div class="kpi"><span class="rotulo">Clientes</span><b>${Store.todos("clientes").length}</b></div></div>
    <div class="ab" role="tablist">${[["vendas", "Vendas"], ["clientes", "Clientes"], ["estoque", "Estoque"], ["graficos", "Gráficos"]].map(([k, r]) => `<button role="tab" aria-selected="${aba === k}" data-a="aba" data-t="vendas" data-k="${k}">${r}</button>`).join("")}</div>` +
    (aba === "vendas" ? `<div class="filtros">${filtro("vend", "Filtrar vendas…")}</div>` + tabela("vend", vs, [
      { l: "Data", v: (v) => dataBR(v.data, false), ord: (v) => v.data }, { l: "Produto", h: (v) => esc(nomeDe("produtos", v.produto_id)) + exemplo(v) }, { l: "Cliente", v: (v) => nomeDe("clientes", v.cliente_id) || "—" },
      { l: "Canal", k: "canal" }, { l: "Qtd.", num: 1, v: (v) => fmtN(v.qtd, 0) }, { l: "Receita", num: 1, v: (v) => moeda(resumoVenda(v).receita), ord: (v) => resumoVenda(v).receita },
      { l: "Lucro", num: 1, h: (v) => { const r = resumoVenda(v); return r.lucro == null ? `<span class="suave" title="custo do produto não calculado">—</span>` : `<span class="num ${cls(r.lucro)}">${moeda(r.lucro)}</span>`; } },
      { l: "Status", k: "status" }, { l: "", h: (v) => acoesLinha("vendas", v) }], { vazio: "Nenhuma venda registrada." })
    : aba === "clientes" ? `<div class="filtros">${filtro("cli", "Filtrar clientes…")}</div>` + tabela("cli", Store.todos("clientes"), [
      { l: "Nome", h: (c) => esc(c.nome) + exemplo(c) }, { l: "Contato", v: (c) => [c.email, c.telefone].filter(Boolean).join(" · ") }, { l: "Cidade", k: "cidade" }, { l: "Origem", k: "canal" },
      { l: "Compras", num: 1, v: (c) => moeda(vendasValidas().filter((v) => v.cliente_id === c.id).reduce((s, v) => s + resumoVenda(v).receita, 0)) }, { l: "", h: (c) => acoesLinha("clientes", c) }], { vazio: "Nenhum cliente." })
    : aba === "estoque" ? tabela("est", comprados, [{ l: "Produto", k: "nome" }, { l: "Comprado", num: 1, v: (p) => fmtN(p.qtd_lote, 0) }, { l: "Em estoque", num: 1, h: (p) => { const e = estoque(p.id); return `<span class="num ${e <= 0 ? "queda" : ""}">${fmtN(e, 0)}</span>`; } },
      { l: "Custo/un.", num: 1, v: (p) => moeda(custoImportacao(p).unit) }, { l: "Valor em estoque", num: 1, v: (p) => moeda((custoImportacao(p).unit || 0) * Math.max(0, estoque(p.id) || 0)) }], { vazio: "Produtos com status “comprado” aparecem aqui com o estoque (lote menos vendas)." })
    : `<div class="grade l2"><section class="painel"><h2>Faturamento por mês</h2>${barras(Object.entries(porMes).sort().map(([m, v]) => ({ r: m, v })))}</section><section class="painel"><h2>Lucro por canal</h2>${barras(Object.entries(porCanal).map(([r, v]) => ({ r, v })))}</section></div>`);
};

T.links = () => {
  const ls = Store.todos("links");
  const pasta = UI.pasta || "";
  const pastas = [...new Set(ls.map((l) => l.pasta).filter(Boolean))].sort();
  const vis = ls.filter((l) => !pasta || (pasta === "★" ? l.favorito : l.pasta === pasta || l.categoria === pasta));
  return cab("Meus Links", "Biblioteca particular de links com pastas, categorias, etiquetas e favoritos. Fica salva entre as sessões.", `<button class="btn pri" data-a="novo" data-c="links">Adicionar link</button>`) +
    `<div class="filtros">${filtro("lnk", "Buscar por palavra, etiqueta ou site…")}<select id="lk-pasta" data-a2="pasta"><option value="">Todas as pastas e categorias</option><option value="★" ${pasta === "★" ? "selected" : ""}>★ Favoritos</option>
      ${S.links.campos.find((c) => c.k === "categoria").op.map((c) => `<option value="${esc(c)}" ${pasta === c ? "selected" : ""}>Categoria: ${esc(c)}</option>`).join("")}${pastas.map((p) => `<option value="${esc(p)}" ${pasta === p ? "selected" : ""}>Pasta: ${esc(p)}</option>`).join("")}</select></div>` +
    tabela("lnk", vis, [
      { l: "", h: (l) => `<button class="btn mini" data-a="favoritar" data-id="${esc(l.id)}" aria-label="Favorito">${l.favorito ? "★" : "☆"}</button>` },
      { l: "Título", h: (l) => `<a href="${esc(linkSeguro(l.url))}" target="_blank" rel="noopener noreferrer"><b>${esc(l.titulo || l.url)}</b></a>${exemplo(l)}<br><small class="suave">${esc(dominio(l.url))}</small>`, ord: (l) => l.titulo },
      { l: "Categoria", k: "categoria" }, { l: "Pasta", k: "pasta" }, { l: "Etiquetas", h: (l) => `<span class="chips">${(l.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</span>` },
      { l: "Atualizado", v: (l) => dataBR(l.atualizado_em, false), ord: (l) => l.atualizado_em }, { l: "", h: (l) => acoesLinha("links", l) },
    ], { vazio: "Nenhum link salvo.", acao: ` <button class="btn pri" data-a="novo" data-c="links">Adicionar link</button>` });
};

T.carteira = () => {
  const ws = Store.todos("watchlist"), cs = Store.todos("carteira");
  const valor = (p) => { const q = cot(p.simbolo); return q ? q.preco * p.quantidade : null; };
  const emR = (v, m) => (m === "USD" ? emBRL(v, "USD") : v);
  const tot = cs.reduce((s, p) => s + (emR(valor(p), p.moeda) || 0), 0), cust = cs.reduce((s, p) => s + (emR(p.preco_medio * p.quantidade, p.moeda) || 0), 0);
  return cab("Carteira e Watchlist", "Watchlist: ativos que você acompanha. Carteira: posições reais inseridas por você. Operações simuladas ficam no Paper trading, separadas.", `<button class="btn" data-a="novo" data-c="watchlist">Acompanhar ativo</button><button class="btn pri" data-a="novo" data-c="carteira">Adicionar posição</button>`) +
    `<section class="painel"><header><h2>Watchlist</h2></header>${tabela("wl", ws, [
      { l: "Ativo", k: "simbolo" }, { l: "Preço", num: 1, v: (w) => fmtN(cot(w.simbolo)?.preco) }, { l: "Variação", num: 1, h: (w) => `<span class="${cls(cot(w.simbolo)?.variacao_pct)}">${pct(cot(w.simbolo)?.variacao_pct)}</span>` },
      { l: "30 dias", h: (w) => spark(cot(w.simbolo)?.historico) }, { l: "Avisar acima", num: 1, v: (w) => fmtN(w.alerta_acima) }, { l: "Avisar abaixo", num: 1, v: (w) => fmtN(w.alerta_abaixo) },
      { l: "Dados", h: (w) => pill(cot(w.simbolo)?.tipo) }, { l: "", h: (w) => acoesLinha("watchlist", w) }], { vazio: "Nenhum ativo na watchlist." })}</section>
    <section class="painel"><header><h2>Carteira</h2><span class="pill real">posições reais informadas por você</span></header>
      <div class="kpis"><div class="kpi"><span class="rotulo">Valor atual</span><b>${moeda(tot)}</b><small>só ativos com cotação</small></div><div class="kpi"><span class="rotulo">Custo</span><b>${moeda(cust)}</b></div><div class="kpi"><span class="rotulo">Resultado</span><b class="${cls(tot - cust)}">${moeda(tot - cust)}</b><small>${cust ? pct(((tot - cust) / cust) * 100) : ""}</small></div></div>
      ${tabela("cart", cs, [{ l: "Ativo", k: "simbolo" }, { l: "Qtd.", num: 1, v: (p) => fmtN(p.quantidade, 4) }, { l: "Preço médio", num: 1, v: (p) => moeda(p.preco_medio, p.moeda) },
        { l: "Preço atual", num: 1, v: (p) => fmtN(cot(p.simbolo)?.preco) }, { l: "Valor atual", num: 1, v: (p) => moeda(valor(p), p.moeda) },
        { l: "Resultado", num: 1, h: (p) => { const v = valor(p); const r = v == null ? null : v - p.preco_medio * p.quantidade; return `<span class="num ${cls(r)}">${moeda(r, p.moeda)}</span>`; } },
        { l: "Corretora", k: "corretora" }, { l: "Origem", k: "origem" }, { l: "", h: (p) => acoesLinha("carteira", p) }], { vazio: "Nenhuma posição. Adicione manualmente ou importe um backup." })}</section>`;
};

T.alertas = () => {
  const as = Store.todos("alertas"), log = Store.todos("alertas_log").sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 50);
  const rot = S.alertas.campos.find((c) => c.k === "tipo").rot;
  return cab("Alertas", "Regras de preço, câmbio, produtos e prazos. No claude.ai elas são verificadas sempre que a página está aberta e chegam cotações; com o servidor, rodam 24 h e podem avisar por e-mail ou WhatsApp Business.", `<button class="btn pri" data-a="novo" data-c="alertas">Novo alerta</button><button class="btn" data-a="verificar-alertas">Verificar agora</button>`) +
    tabela("al", as, [{ l: "Alerta", h: (a) => `<b>${esc(a.nome || rot[a.tipo])}</b>` }, { l: "Condição", v: (a) => `${rot[a.tipo] || a.tipo} ${fmtN(a.valor)}` },
      { l: "Alvo", v: (a) => a.simbolo || nomeDe("produtos", a.produto_id) || "—" }, { l: "Canal", k: "canal" }, { l: "Ativo", v: (a) => (a.ativo ? "sim" : "não") },
      { l: "Último disparo", v: (a) => dataBR(a.ultimo_disparo) }, { l: "", h: (a) => acoesLinha("alertas", a) }], { vazio: "Nenhum alerta configurado." }) +
    `<section class="painel"><header><h2>Disparos recentes</h2></header>${tabela("allog", log, [{ l: "Quando", v: (l) => dataBR(l.criado_em) }, { l: "Mensagem", k: "mensagem" }, { l: "Canal", k: "canal" }, { l: "Entrega", k: "entrega" }], { vazio: "Nenhum alerta disparado." })}</section>`;
};
function verificarAlertas(manual = false) {
  const h = hoje(); let disparou = 0;
  for (const a of Store.todos("alertas").filter((x) => x.ativo)) {
    if (a.ultimo_disparo && Date.now() - new Date(a.ultimo_disparo) < 6 * 36e5) continue;
    let msg = null;
    const q = a.simbolo ? cot(a.simbolo) : null;
    if (a.tipo === "preco_acima" && q && q.preco > a.valor) msg = `${a.simbolo} acima de ${fmtN(a.valor)}: ${fmtN(q.preco)} (${q.fonte})`;
    if (a.tipo === "preco_abaixo" && q && q.preco < a.valor) msg = `${a.simbolo} abaixo de ${fmtN(a.valor)}: ${fmtN(q.preco)} (${q.fonte})`;
    if (a.tipo === "variacao" && q && Math.abs(q.variacao_pct || 0) >= a.valor) msg = `${a.simbolo} variou ${pct(q.variacao_pct)} (limite ±${a.valor}%)`;
    if (a.tipo === "produto_preco") { const p = Store.um("produtos", a.produto_id); if (p && n(p.preco_origem) != null && p.preco_origem <= a.valor) msg = `${p.nome} está a ${moeda(p.preco_origem, p.moeda || "CNY")} (alvo ${fmtN(a.valor)})`; }
    if (a.tipo === "tarefa_prazo") { const lim = new Date(Date.now() + (a.valor || 0) * 864e5).toISOString().slice(0, 10); const ts = Store.todos("tarefas").filter((t) => !t.feita && t.prazo && t.prazo <= lim); if (ts.length) msg = `${ts.length} tarefa(s) do CRM vencendo até ${dataBR(lim, false)}: ${ts.map((t) => t.titulo).join("; ")}`; }
    if (msg) {
      disparou++; toast("🔔 " + msg);
      Store.salvar("alertas_log", { alerta_id: a.id, mensagem: msg, canal: a.canal, entrega: a.canal === "painel" ? "painel" : Store.modo === "api" ? "enviado pelo servidor" : "requer servidor para " + a.canal }, { auditar: false });
      Store.salvar("alertas", { ...a, ultimo_disparo: agora() }, { auditar: false });
    }
  }
  for (const w of Store.todos("watchlist")) {
    const q = cot(w.simbolo); if (!q) continue;
    if ((w.alerta_acima && q.preco > w.alerta_acima) || (w.alerta_abaixo && q.preco < w.alerta_abaixo)) {
      const chave = "wl:" + w.id + ":" + h; if (sessionAvisos.has(chave)) continue; sessionAvisos.add(chave);
      toast(`🔔 ${w.simbolo} em ${fmtN(q.preco)} (watchlist)`);
    }
  }
  if (manual) toast(disparou ? `${disparou} alerta(s) disparado(s).` : "Nenhuma condição atingida agora.");
}
const sessionAvisos = new Set();

T.relatorios = () => {
  const cont = COLS.filter((c) => c !== "config").map((c) => ({ c, n: Store.todos(c).length }));
  return cab("Relatórios e Exportar", "Baixe tudo em um arquivo, exporte planilhas e restaure um backup.") +
    `<section class="painel"><header><h2>Exportar tudo</h2></header>
      <div class="acoes"><button class="btn pri" data-a="exportar" data-f="xlsx">Planilha Excel (todas as abas)</button><button class="btn" data-a="exportar" data-f="json">Backup completo (JSON)</button><button class="btn" data-a="exportar" data-f="csv">CSV de cada cadastro</button></div>
      <div class="tabela"><table><thead><tr><th>Cadastro</th><th class="n">Registros</th><th></th></tr></thead><tbody>${cont.map(({ c, n: k }) => `<tr><td>${esc(c)}</td><td class="n">${k}</td><td><button class="btn mini" data-a="exportar" data-f="csv1" data-c="${c}" ${k ? "" : "disabled"}>CSV</button></td></tr>`).join("")}</tbody></table></div>
    </section>
    <section class="painel"><header><h2>Restaurar ou importar backup</h2></header><p class="suave" style="margin:0">Escolha um arquivo .json exportado daqui. Registros com o mesmo identificador são substituídos; os outros são mantidos.</p>
      <input type="file" id="imp-arquivo" accept=".json,application/json"><div class="acoes"><button class="btn" data-a="importar">Importar arquivo</button></div></section>
    <section class="painel"><header><h2>Relatório de desempenho e risco</h2><button class="btn ia" data-a="ia-relatorio">Gerar relatório com IA</button></header>
      ${relatorioResumo()}${caixaIA("relatorio")}</section>`;
};
function relatorioResumo() {
  const val = vendasValidas().map(resumoVenda), fat = val.reduce((s, r) => s + r.receita, 0), luc = val.reduce((s, r) => s + (r.lucro || 0), 0);
  const rk = rankingProdutos();
  return `<div class="linhas-calc"><span>Faturamento acumulado</span><span class="num">${moeda(fat)}</span><span>Lucro estimado</span><span class="num ${cls(luc)}">${moeda(luc)}</span>
    <span>Produtos com margem calculada</span><span class="num">${rk.length}</span><span>Melhor margem</span><span class="num">${rk[0] ? esc(rk[0].p.nome) + " " + pct(rk[0].c.margem, 1) : "—"}</span>
    <span>Posições na carteira</span><span class="num">${Store.todos("carteira").length}</span><span>Ordens simuladas</span><span class="num">${Store.todos("paper").length}</span></div>`;
}
async function exportar(fmt, col) {
  const dados = {}; for (const c of COLS) dados[c] = Store.todos(c);
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const plano = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "_hist").map(([k, v]) => [k, Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v]));
  const csv = (linhas) => { const ks = [...new Set(linhas.flatMap((l) => Object.keys(plano(l))))]; const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; return "﻿" + [ks.join(";"), ...linhas.map((l) => { const p = plano(l); return ks.map((k) => q(p[k])).join(";"); })].join("\r\n"); };
  if (fmt === "json") return baixar(`china-trade-backup-${carimbo}.json`, JSON.stringify({ app: "china-trade", versao: 1, exportado_em: agora(), dados }, null, 2), "application/json");
  if (fmt === "csv1") return baixar(`china-trade-${col}-${carimbo}.csv`, csv(dados[col]), "text/csv");
  if (fmt === "csv") { for (const c of COLS) if (dados[c].length) await baixar(`china-trade-${c}-${carimbo}.csv`, csv(dados[c]), "text/csv"); return; }
  if (fmt === "xlsx") {
    if (!window.XLSX) return toast("A biblioteca de planilhas não carregou. Use o backup JSON ou CSV.");
    const wb = XLSX.utils.book_new();
    for (const c of COLS) if (dados[c].length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados[c].map(plano)), c.slice(0, 31));
    if (!wb.SheetNames.length) return toast("Nada para exportar ainda.");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return baixar(`china-trade-${carimbo}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
}
async function baixar(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo + ";charset=utf-8" });
  if (NO_ARTEFATO) {
    const dl = await cap("downloads");
    if (dl) { try { await dl.save({ filename: nome, data: blob }); toast("Arquivo entregue: " + nome); } catch (e) { toast(e.code === "declined" ? "Download cancelado." : "Não baixou: " + (e.message || e.code)); } return; }
    if (typeof conteudo === "string") {
      $("#janela-raiz").innerHTML = `<div class="veu" data-a="fechar-veu"><div class="janela"><header><h2>${esc(nome)}</h2><button class="btn" data-a="fechar">Fechar</button></header><p class="suave">Este acesso não permite baixar arquivos. Copie o conteúdo abaixo.</p><textarea id="copia" style="min-height:300px">${esc(conteudo)}</textarea><button class="btn pri" data-a="copiar">Copiar</button></div></div>`;
    } else toast("Este acesso não permite baixar arquivos. Use o backup JSON.");
    return;
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importar() {
  const file = $("#imp-arquivo")?.files?.[0]; if (!file) return toast("Escolha um arquivo .json.");
  try {
    const j = JSON.parse(await file.text()); if (j.app !== "china-trade" || !j.dados) throw new Error("arquivo não é um backup do China Trade");
    let k = 0; for (const [c, docs] of Object.entries(j.dados)) { if (!COLS.includes(c) || c === "auditoria") continue; for (const d of docs) { await Store.salvar(c, d, { auditar: false }); k++; } }
    toast(`${k} registros importados.`);
  } catch (e) { toast("Não importou: " + e.message); }
}

T.admin = () => {
  const aud = Store.todos("auditoria").sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 80);
  const modos = { claude: "Banco de dados do artefato no claude.ai. Só você (e quem você tornar editor) lê e altera. Sem login extra: vale a sua conta do claude.ai.", api: "Servidor próprio (FastAPI + PostgreSQL) com login, MFA e auditoria no servidor.", local: "Somente neste navegador (localStorage). Exporte backups com frequência." };
  const fontes = [
    ["Binance (criptomoedas)", "tempo real", "pública, sem chave", "servidor"], ["Yahoo Finance (B3, EUA, índices, ETFs)", "atrasada ~15 min", "pública, sem chave; uso não oficial", "servidor"],
    ["brapi.dev (B3)", "atrasada", "BRAPI_TOKEN", "servidor"], ["Alpha Vantage (EUA)", "atrasada/tempo real conforme plano", "ALPHAVANTAGE_KEY", "servidor"],
    ["AwesomeAPI (câmbio)", "indicativa, atualiza a cada ~30 s", "pública, sem chave", "servidor"], ["Banco Central PTAX (câmbio oficial)", "oficial, diária", "pública, sem chave", "servidor"],
    ["Google Trends via pytrends", "diária/semanal", "pública, sujeita a limite do Google", "servidor"], ["Aliyun Machine Translation (alimt)", "—", "ALIYUN_ACCESS_KEY_ID e SECRET", "servidor"],
    ["1688 / Alibaba Open Platform", "—", "APP_KEY e APP_SECRET aprovados pelo Alibaba", "servidor (adaptador pronto)"], ["E-mail (SMTP)", "—", "SMTP_HOST, SMTP_USER, SMTP_PASS", "servidor"],
    ["WhatsApp Business Cloud API", "—", "WHATSAPP_TOKEN e WHATSAPP_PHONE_ID", "servidor"], ["IA (Claude)", "—", "no claude.ai: automática; no servidor: ANTHROPIC_API_KEY", "página / servidor"],
  ];
  return cab("Administração", "Onde seus dados estão, quais fontes estão ativas, histórico dos agentes e registro de auditoria.") +
    `<section class="painel"><header><h2>Armazenamento e acesso</h2><span class="modo" data-m="${Store.modo}">${esc(Store.modo)}</span></header><p style="margin:0">${esc(modos[Store.modo] || "")}</p>
      ${Store.modo === "api" && Store.usuario ? `<p class="suave" style="margin:0">Conectado como ${esc(Store.usuario.email)} (${esc(Store.usuario.papel)}). <button class="btn mini" data-a="sair">Sair</button></p>` : ""}
      ${Store.modo !== "api" ? `<div class="nota">Para login com e-mail e senha, MFA, vários usuários com perfis e cotações ao vivo 24 h, rode o servidor do projeto (pasta <code>china-trade/</code>, comando <code>docker compose up</code>). Esta mesma tela abre lá, com login.</div>` : ""}</section>
    ${Store.modo === "api" && Store.usuario?.papel === "admin" ? `<section class="painel"><header><h2>Usuários</h2><button class="btn mini" data-a="carregar-usuarios">Carregar</button></header><div id="usuarios"></div></section>` : ""}
    <section class="painel"><header><h2>Fontes de dados</h2><span class="suave">${Store.feed.size} automáticas · ${Store.todos("cotacoes").length} manuais</span></header>
      ${tabela("fontes", fontes.map(([a, b, c, d]) => ({ a, b, c, d })), [{ l: "Fonte", k: "a" }, { l: "Tipo de dado", k: "b" }, { l: "O que falta para ativar", k: "c" }, { l: "Onde roda", k: "d" }])}</section>
    <section class="painel"><header><h2>Agentes</h2><a class="btn mini" href="#trade" data-a="aba" data-t="trade" data-k="agentes">Abrir agentes</a></header>${telaAgentes().split("<h2>Histórico de execuções</h2>")[1] || ""}</section>
    <section class="painel"><header><h2>Auditoria</h2><span class="suave">últimas 80 ações</span></header>${tabela("aud", aud, [{ l: "Quando", v: (a) => dataBR(a.criado_em) }, { l: "Ação", k: "acao" }, { l: "Cadastro", k: "colecao" }, { l: "Registro", k: "titulo" }, { l: "Usuário", v: (a) => a.usuario || "você" }], { vazio: "Sem registros." })}</section>`;
};

T.configuracoes = () => {
  const c = cfg();
  const campo = (k, l, step = "any") => `<label class="campo">${esc(l)}<input type="number" step="${step}" id="cfg-${k}" data-cfg="${k}" value="${esc(c[k])}"></label>`;
  return cab("Configurações", "Tributos padrão, câmbio manual, spread e taxas. Valores usados nas estimativas de custo e de lucro.") +
    `<section class="painel"><header><h2>Importação formal (empresa)</h2></header><div class="grade">${campo("ii_pct", "II padrão (%)")}${campo("ipi_pct", "IPI (%)")}${campo("pis_pct", "PIS-Importação (%)")}${campo("cofins_pct", "COFINS-Importação (%)")}${campo("icms_pct", "ICMS do seu estado (%)")}${campo("siscomex_brl", "Taxa Siscomex (R$)")}${campo("afrmm_pct", "AFRMM (% do frete marítimo)")}${campo("despesas_pct", "Despesas aduaneiras (% do valor)")}</div>
      <p class="suave" style="margin:0;font-size:.82rem">II e IPI variam por NCM: informe o II específico no produto. ICMS calculado “por dentro”. Estimativa, não substitui o despachante.</p></section>
    <section class="painel"><header><h2>Remessa Conforme (pessoa física)</h2></header><div class="grade">${campo("remessa_ii_ate50_pct", "II até US$ 50 (%)")}${campo("remessa_ii_acima50_pct", "II acima de US$ 50 (%)")}${campo("remessa_deducao_usd", "Dedução acima de US$ 50 (US$)")}${campo("remessa_icms_pct", "ICMS (%)")}</div></section>
    <section class="painel"><header><h2>Câmbio, spread e vendas</h2></header><div class="grade">${campo("spread_pct", "Spread do câmbio (%)")}${campo("iof_pct", "IOF (%)")}${campo("tarifa_fixa_brl", "Tarifa fixa por conversão (R$)")}${campo("taxa_canal_pct", "Taxa padrão do canal de venda (%)")}</div></section>
    <section class="painel"><header><h2>Cotação manual de moedas</h2><span class="suave">usada só quando não há fonte automática</span></header>
      <div class="grade">${MOEDAS.filter((m) => m !== "BRL").map((m) => `<label class="campo">1 ${m} em R$<input type="number" step="any" id="cm-${m}" data-cambio="${m}" value="${esc(c.cambio_manual?.[m] ?? "")}" placeholder="informe"></label>`).join("")}</div>
      <p class="suave" style="margin:0;font-size:.82rem">Digite o valor que você consultou (banco, corretora). Ele aparece marcado como “manual” em todos os cálculos.</p></section>
    <div class="acoes"><button class="btn pri" data-a="salvar-cfg">Salvar configurações</button><button class="btn" data-a="cotacao-manual">Lançar cotação de ativo</button></div>
    ${Store.modo === "api" ? `<section class="painel"><header><h2>Segurança da conta</h2><span class="pill ${Store.usuario?.mfa ? "real" : "sem"}">MFA ${Store.usuario?.mfa ? "ativo" : "desligado"}</span></header>
      ${Store.usuario?.mfa ? `<p class="suave" style="margin:0">A verificação em duas etapas está ativa. Para desligar, informe senha e código.</p><div class="grade"><label class="campo">Senha<input type="password" id="mfa-senha" autocomplete="current-password"></label><label class="campo">Código<input id="mfa-cod-off" inputmode="numeric" maxlength="6"></label></div><div class="acoes"><button class="btn perigo" data-a="mfa-desativar">Desligar MFA</button></div>`
      : UI.mfa ? `<p style="margin:0">No app autenticador (Google Authenticator, Authy, Microsoft Authenticator), adicione a conta digitando esta chave:</p><p class="mono" style="font-size:1.1rem;word-break:break-all;margin:0">${esc(UI.mfa.segredo)}</p><small class="suave" style="word-break:break-all">${esc(UI.mfa.uri)}</small><label class="campo" style="max-width:220px">Código de 6 dígitos<input id="mfa-cod" inputmode="numeric" maxlength="6"></label><div class="acoes"><button class="btn pri" data-a="mfa-confirmar">Confirmar e ativar</button></div>`
      : `<p class="suave" style="margin:0">Proteja o login com um código do celular além da senha.</p><div class="acoes"><button class="btn pri" data-a="mfa-iniciar">Ativar MFA</button></div>`}</section>` : ""}`;
};

T.login = () => `<div class="login"><section class="painel"><div class="marca"><span class="selo">中贸</span><div><b>China Trade &amp; Market Intelligence</b><span>acesso ao servidor</span></div></div>
  <div class="ab" role="tablist">${[["entrar", "Entrar"], ["cadastrar", "Criar conta"], ["recuperar", "Esqueci a senha"]].map(([k, r]) => `<button role="tab" aria-selected="${(UI.aba.login || "entrar") === k}" data-a="aba" data-t="login" data-k="${k}">${r}</button>`).join("")}</div>
  <form id="form-login" class="grade" style="grid-template-columns:1fr" novalidate>
    ${(UI.aba.login || "entrar") === "cadastrar" ? `<label class="campo">Nome<input id="lg-nome" autocomplete="name"></label>` : ""}
    <label class="campo">E-mail<input id="lg-email" type="email" autocomplete="username" required></label>
    ${(UI.aba.login || "entrar") !== "recuperar" ? `<label class="campo">Senha<input id="lg-senha" type="password" autocomplete="${UI.aba.login === "cadastrar" ? "new-password" : "current-password"}" minlength="10" required></label>` : ""}
    ${(UI.aba.login || "entrar") === "entrar" ? `<label class="campo">Código MFA (se ativado)<input id="lg-mfa" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>` : ""}
    ${UI.aba.login === "recuperar" && UI.resetEnviado ? `<label class="campo">Código recebido<input id="lg-token"></label><label class="campo">Nova senha<input id="lg-nova" type="password" minlength="10" autocomplete="new-password"></label>` : ""}
    <button class="btn pri" type="submit">${{ entrar: "Entrar", cadastrar: "Criar conta", recuperar: UI.resetEnviado ? "Trocar senha" : "Enviar código" }[UI.aba.login || "entrar"]}</button>
    <p class="suave" id="lg-msg" style="margin:0">${esc(UI.msgLogin || "")}</p>
  </form></section></div>`;

// ---------- desenho ----------
let ultimaRota = "";
function render() {
  const r = rota();
  if (Store.modo === "api" && !Store.usuario) { $("#menu").innerHTML = ""; $("#conteudo").innerHTML = T.login(); ligarLogin(); return; }
  desenharMenu();
  seloAoVivo();
  const m = $("#modo"); m.dataset.m = Store.modo; m.textContent = { claude: "salvo no claude.ai", api: "servidor", local: "só neste navegador" }[Store.modo] || "";
  // guarda valores e foco dos campos da tela antes de redesenhar
  const vals = {}; $$("#conteudo input[id], #conteudo select[id], #conteudo textarea[id]").forEach((el) => { if (el.type !== "file") vals[el.id] = el.type === "checkbox" ? el.checked : el.value; });
  const foco = document.activeElement?.id, sel = document.activeElement?.selectionStart;
  const mesma = ultimaRota === r; ultimaRota = r;
  $("#conteudo").innerHTML = T[r]();
  if (mesma) {
    for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el && el.closest("#conteudo") && !el.dataset.filtro) { if (el.type === "checkbox") { if (!el.dataset.a) el.checked = v; } else if (el.tagName !== "SELECT" || !el.dataset.a2) el.value = v; } }
    if (foco) { const el = document.getElementById(foco); if (el) { el.focus(); try { if (sel != null) el.setSelectionRange(sel, sel); } catch { /* campo sem cursor */ } } }
    if ($("#cv-res")) $("#cv-res").innerHTML = linhasConversao();
  } else window.scrollTo(0, 0);
}
let pendente = null;
function mudou(col) {
  if (col === "cotacoes") verificarAlertasDepois();
  if (formAberto) return; // não atrapalha quem está preenchendo
  clearTimeout(pendente); pendente = setTimeout(render, 60);
}
let tAlerta = null;
const verificarAlertasDepois = () => { clearTimeout(tAlerta); tAlerta = setTimeout(() => verificarAlertas(false), 1500); };

// ---------- ações ----------
const A = {
  novo: (el) => abrirForm(el.dataset.c),
  editar: (el) => abrirForm(el.dataset.c, el.dataset.id),
  excluir: (el) => confirmar(`Excluir “${tituloDe(el.dataset.c, Store.um(el.dataset.c, el.dataset.id) || {})}”? Isso não pode ser desfeito.`, () => Store.excluir(el.dataset.c, el.dataset.id).then(() => toast("Excluído."))),
  fechar: fecharJanela,
  "fechar-veu": (el, ev) => { if (ev.target === el) fecharJanela(); },
  ordenar: (el) => { const id = el.dataset.t, i = +el.dataset.i; const o = UI.ordem[id]; UI.ordem[id] = { i, dir: o?.i === i ? -o.dir : 1 }; $("#tb-" + id).innerHTML = corpoTabela(id); },
  aba: (el) => { UI.aba[el.dataset.t] = el.dataset.k; if (el.tagName === "A") return; if (el.dataset.t === "login") UI.msgLogin = ""; render(); },
  "ver-ativo": (el) => { UI.ativo = el.dataset.id; if (el.tagName !== "A") render(); },
  mover: async (el) => { const p = Store.um("produtos", el.dataset.id); await Store.salvar("produtos", { ...p, status: el.dataset.s }); toast(`${p.nome} → ${el.dataset.s}`); },
  "contato-de": (el) => { const p = Store.um("produtos", el.dataset.id); abrirForm("contatos", null, { produto_id: p.id, fornecedor_id: p.fornecedor_id }); },
  feita: async (el) => { const t = Store.um("tarefas", el.dataset.id); await Store.salvar("tarefas", { ...t, feita: el.checked }); },
  favoritar: async (el) => { const l = Store.um("links", el.dataset.id); await Store.salvar("links", { ...l, favorito: !l.favorito }); },
  "ver-custo": (el) => janelaCusto(el.dataset.id),
  "tirar-anexo": (el) => { formAberto.anexos = formAberto.anexos.filter((_, i) => i !== +el.dataset.i); el.closest(".chip").remove(); },
  copiar: () => { const t = $("#copia"); navigator.clipboard?.writeText(t.value).then(() => toast("Copiado.")).catch(() => { t.select(); toast("Selecionado: use Copiar do aparelho."); }); },
  "salvar-conversao": async () => { const r = conversao(); if (r.erro) return toast(r.erro); await Store.salvar("conversoes", r, { auditar: false }); toast("Conversão guardada."); },
  "salvar-cfg": async () => {
    const c = { ...cfg(), id: "geral" };
    $$("[data-cfg]").forEach((el) => (c[el.dataset.cfg] = n(el.value) ?? CFG_PADRAO[el.dataset.cfg]));
    c.cambio_manual = {}; $$("[data-cambio]").forEach((el) => { if (n(el.value)) c.cambio_manual[el.dataset.cambio] = n(el.value); });
    await Store.salvar("config", c); toast("Configurações salvas.");
  },
  "cotacao-manual": () => {
    $("#janela-raiz").innerHTML = `<div class="veu" data-a="fechar-veu"><form class="janela" id="form-cot"><header><h2>Lançar cotação manual</h2><button type="button" class="btn" data-a="fechar">Fechar</button></header>
      <div class="nota">Use quando você consultou o preço em outro lugar (corretora, banco). Ele aparece marcado como “manual”, com a fonte que você informar.</div>
      <div class="grade"><label class="campo">Ativo<select id="mc-id">${cotacoes().map((q) => `<option value="${esc(q.id)}">${esc(q.simbolo)} · ${esc(q.nome)}</option>`).join("")}</select></label>
      <label class="campo">Preço<input id="mc-preco" type="number" step="any" required></label><label class="campo">Variação do dia (%)<input id="mc-var" type="number" step="any"></label>
      <label class="campo">Fonte consultada<input id="mc-fonte" placeholder="ex.: app da corretora" required></label></div>
      <div class="acoes"><button class="btn pri" type="submit">Salvar cotação</button></div></form></div>`;
    $("#form-cot").addEventListener("submit", async (ev) => {
      ev.preventDefault(); const id = $("#mc-id").value, preco = n($("#mc-preco").value); if (preco == null || !$("#mc-fonte").value.trim()) return toast("Informe preço e fonte.");
      const base = cotacoes().find((q) => q.id === id) || {}; const ant = Store.um("cotacoes", id);
      const historico = [...(ant?.historico || []).filter((p) => p.t.slice(0, 10) !== hoje()), { t: hoje(), c: preco }].slice(-250);
      await Store.salvar("cotacoes", { id, simbolo: id, nome: base.nome, classe: base.classe, moeda: base.moeda, preco, variacao_pct: n($("#mc-var").value), horario: agora(), fonte: "manual: " + $("#mc-fonte").value.trim(), tipo: "manual", historico }, { auditar: false });
      fecharJanela(); toast("Cotação lançada.");
    });
  },
  "novo-alerta-ativo": (el) => abrirForm("alertas", null, { simbolo: el.dataset.id, tipo: "preco_acima", nome: "Preço de " + el.dataset.id }),
  "verificar-alertas": () => verificarAlertas(true),
  "rodar-agente": (el) => rodarAgente(el.dataset.id),
  "rodar-bt": () => { UI.bt = { rapida: Math.max(2, n($("#bt-rapida").value) || 9), lenta: Math.max(3, n($("#bt-lenta").value) || 21), custo: n($("#bt-custo").value) || 0 }; render(); },
  "paper-ordem": async () => {
    const s = $("#pp-ativo").value, q = cot(s); const preco = n($("#pp-preco").value) ?? q?.preco; const qtd = n($("#pp-qtd").value);
    if (!preco || !qtd) return toast("Sem cotação para este ativo: informe o preço.");
    await Store.salvar("paper", { simbolo: s, lado: $("#pp-lado").value, qtd, preco, data: agora(), fonte: n($("#pp-preco").value) != null ? "preço informado" : `${q.fonte} (${q.tipo})` }, { auditar: false });
    toast("Ordem simulada registrada.");
  },
  "ia-analise": () => {
    const x = UI.ultimaAnalise; if (!x) return;
    const ult = x.q.historico.slice(-40).map((p) => `${p.t.slice(0, 10)}:${p.c}`).join(", ");
    perguntarIA("analise", `Você é o MARKET WATCH AI. Analise ${x.q.simbolo} (${x.q.nome}) usando SOMENTE estes dados.\nFonte: ${x.q.fonte}, tipo de dado: ${x.q.tipo}, última atualização: ${x.q.horario}.\nÚltimos fechamentos: ${ult}\nRSI14=${fmtN(x.rsi, 1)}; MACD hist=${fmtN(x.macd?.hist, 4)}; MM20=${fmtN(x.s20)}; MM50=${fmtN(x.s50)}; volatilidade anual=${fmtN(x.vol, 1)}%; suporte=${fmtN(x.nv.suporte)}; resistência=${fmtN(x.nv.resistencia)}.\nSinais: ${x.sinais.join("; ")}.\n\nResponda em português, texto simples, com as seções: 1) Leitura técnica e fundamentos dos sinais; 2) Dados utilizados e suas limitações; 3) Cenário principal com condições de entrada e saída para simulação; 4) Cenário alternativo; 5) Grau de incerteza (baixo/médio/alto) e por quê. Não prometa resultado, não dê preço-alvo como certeza e lembre que não é recomendação de investimento. Não cite notícias que não estejam nos dados.`)
      .then((t) => t && registrarAgente("MARKET WATCH", x.q.simbolo, t, `${x.q.fonte} (${x.q.tipo})`, "Análise só com histórico de preços; sem notícias nem volume."));
  },
  "ia-relatorio": () => {
    const val = vendasValidas().map((v) => ({ v, r: resumoVenda(v) }));
    const dados = { vendas: val.map(({ v, r }) => ({ data: v.data, produto: nomeDe("produtos", v.produto_id), canal: v.canal, receita: r.receita, lucro: r.lucro })), ranking: rankingProdutos().slice(0, 10).map((x) => ({ nome: x.p.nome, custo: x.c.unit, margem: x.c.margem })),
      carteira: Store.todos("carteira").map((p) => ({ s: p.simbolo, q: p.quantidade, pm: p.preco_medio, atual: cot(p.simbolo)?.preco ?? null })), simulado: Store.todos("paper").length };
    perguntarIA("relatorio", `Escreva um relatório curto de desempenho e risco para um importador/vendedor brasileiro, em português, usando APENAS estes dados JSON. Seções: Vendas e margens; Produtos (concentração e risco cambial); Carteira real (separe claramente de simulações, que são ${dados.simulado} ordens fictícias); Riscos e próximos passos. Se faltar dado, diga que falta. Não invente números.\n\n${JSON.stringify(dados).slice(0, 60000)}`);
  },
  scanner: async () => {
    const pt = $("#sc-termo").value.trim(); if (!pt) return toast("Digite o produto.");
    const g = GLOSSARIO[pt.toLowerCase()];
    UI.scanner = { pt, zh: g?.[0] || "", en: g?.[1] || "", origem: g ? "tradução do glossário interno" : "traduzindo…" }; render();
    const sample = await cap("sample");
    if (sample) {
      try {
        const r = await sample.json(`Traduza o produto que um importador brasileiro quer buscar em sites chineses. Responda só JSON {"zh":"termo em chinês simplificado usado no 1688","en":"termo em inglês usado no Alibaba","variantes":["até 4 termos alternativos em chinês ou inglês"]}. Produto: ${pt}`, { modelTier: "quick" });
        UI.scanner = { pt, zh: String(r.zh || UI.scanner.zh), en: String(r.en || UI.scanner.en), variantes: (r.variantes || []).map(String).slice(0, 4), origem: "tradução por IA (Claude) — confira antes de comprar" };
      } catch { UI.scanner.origem = g ? UI.scanner.origem : "sem tradução: busca em português/inglês"; }
    } else if (Store.modo === "api") {
      try { const r = await api("GET", "api/traduzir?texto=" + encodeURIComponent(pt)); UI.scanner = { pt, zh: r.zh, en: r.en, variantes: [], origem: r.fonte }; } catch (e) { UI.scanner.origem = "tradução indisponível: " + e.message; }
    } else if (!g) UI.scanner.origem = "sem tradução automática neste modo";
    render();
    await registrarAgente("CHINA SCANNER", pt, `zh=${UI.scanner.zh} en=${UI.scanner.en}`, "links de busca das plataformas", UI.scanner.origem);
  },
  "salvar-da-busca": (el) => abrirForm("produtos", null, { nome: UI.scanner?.pt, nome_cn: [UI.scanner?.zh, UI.scanner?.en].filter(Boolean).join(" / "), plataforma: el.dataset.p, moeda: ["1688", "Taobao"].includes(el.dataset.p) ? "CNY" : "USD" }),
  exportar: (el) => exportar(el.dataset.f, el.dataset.c),
  importar,
  "mfa-iniciar": async () => { try { UI.mfa = await api("POST", "api/auth/mfa/iniciar"); render(); } catch (e) { toast(e.message); } },
  "mfa-confirmar": async () => { try { await api("POST", "api/auth/mfa/confirmar", { codigo: $("#mfa-cod").value.trim() }); UI.mfa = null; Store.usuario = await api("GET", "api/auth/eu"); toast("MFA ativado."); render(); } catch (e) { toast(e.message); } },
  "mfa-desativar": async () => { try { await api("POST", "api/auth/mfa/desativar", { senha: $("#mfa-senha").value, codigo: $("#mfa-cod-off").value.trim() }); Store.usuario = await api("GET", "api/auth/eu"); toast("MFA desligado."); render(); } catch (e) { toast(e.message); } },
  sair: async () => { await api("POST", "api/auth/sair").catch(() => {}); Store.usuario = null; render(); },
  "carregar-usuarios": async () => {
    const us = await api("GET", "api/admin/usuarios");
    $("#usuarios").innerHTML = `<div class="tabela"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>MFA</th><th>Último acesso</th></tr></thead><tbody>${us.map((u) => `<tr><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td>${esc(u.papel)}</td><td>${u.mfa ? "sim" : "não"}</td><td>${esc(dataBR(u.ultimo_acesso))}</td></tr>`).join("")}</tbody></table></div>`;
  },
  "capturar-titulo": async () => {
    const u = $("#fm-url").value.trim(); if (!u) return;
    try { const r = await api("GET", "api/links/capturar?url=" + encodeURIComponent(u)); if (r.titulo) $("#fm-titulo").value = r.titulo; if (r.imagem) $("#fm-imagem").value = r.imagem; toast("Título capturado."); } catch (e) { toast("Não capturou: " + e.message); }
  },
};
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-a]"); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  if (el.tagName === "BUTTON" || el.dataset.a === "fechar-veu") { if (el.dataset.a !== "fechar-veu") ev.preventDefault(); }
  if (el.dataset.a === "feita" || el.dataset.a === "fechar-veu" || el.tagName !== "INPUT") fn(el, ev);
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.a2 === "trocar-ativo") { UI.ativo = el.value; render(); }
  if (el.dataset.a2 === "pasta") { UI.pasta = el.value; render(); }
  if (el.id?.startsWith("cv-") && $("#cv-res")) $("#cv-res").innerHTML = linhasConversao();
});
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.filtro) { UI.filtros[el.dataset.filtro] = el.value; const t = $("#tb-" + el.dataset.filtro); if (t) t.innerHTML = corpoTabela(el.dataset.filtro); }
  if (el.id?.startsWith("cv-") && $("#cv-res")) $("#cv-res").innerHTML = linhasConversao();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { fecharJanela(); $("#resultados").hidden = true; $("#menu").classList.remove("aberto"); }
  if (ev.key === "Enter" && ev.target.id === "sc-termo") A.scanner();
});

// busca global
$("#busca-global").addEventListener("input", (ev) => {
  const t = ev.target.value.trim().toLowerCase(); const box = $("#resultados");
  if (t.length < 2) { box.hidden = true; return; }
  const alvos = [["produtos", "china", "Produto"], ["fornecedores", "fornecedores", "Fornecedor"], ["links", "links", "Link"], ["clientes", "vendas", "Cliente"], ["tarefas", "crm", "Tarefa"], ["contatos", "fornecedores", "Contato"]];
  const res = [];
  for (const [c, r, rot] of alvos) for (const d of Store.todos(c)) if (JSON.stringify(d).toLowerCase().includes(t)) res.push({ c, r, rot, d });
  for (const q of cotacoes()) if ((q.simbolo + " " + q.nome).toLowerCase().includes(t)) res.push({ r: q.classe === "moeda" ? "cambio" : q.classe === "cripto" ? "cripto" : "bolsa", rot: "Ativo", d: q, ativo: q.id });
  box.innerHTML = res.slice(0, 20).map((x, i) => `<a href="#${x.r}" data-res="${i}">${esc(x.c ? tituloDe(x.c, x.d) : x.d.simbolo + " · " + x.d.nome)} <small>${esc(x.rot)}</small></a>`).join("") || `<a href="#dashboard"><small>Nada encontrado para “${esc(t)}”.</small></a>`;
  box.hidden = false;
  $$("[data-res]", box).forEach((a) => a.addEventListener("click", () => { const x = res[+a.dataset.res]; box.hidden = true; ev.target.value = ""; if (x.ativo) UI.ativo = x.ativo; else if (x.c) setTimeout(() => abrirForm(x.c, x.d.id), 50); }));
});
document.addEventListener("click", (ev) => { if (!ev.target.closest(".busca")) $("#resultados").hidden = true; if (!ev.target.closest("#menu") && !ev.target.closest("#abrir-menu")) $("#menu").classList.remove("aberto"); });
$("#abrir-menu").addEventListener("click", () => $("#menu").classList.toggle("aberto"));
$("#tema").addEventListener("click", () => {
  const r = document.documentElement; const escuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = escuro ? "light" : "dark"; try { localStorage.setItem("ct:tema", r.dataset.theme); } catch { /* sem armazenamento */ }
});
try { const t = localStorage.getItem("ct:tema"); if (t) document.documentElement.dataset.theme = t; } catch { /* sem armazenamento */ }
window.addEventListener("hashchange", () => { $("#menu").classList.remove("aberto"); render(); });

// login (modo servidor)
function ligarLogin() {
  const form = $("#form-login"); if (!form) return;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); const aba = UI.aba.login || "entrar";
    const v = (id) => $("#" + id)?.value?.trim() || "";
    try {
      if (aba === "entrar") { Store.usuario = await api("POST", "api/auth/entrar", { email: v("lg-email"), senha: $("#lg-senha").value, codigo_mfa: v("lg-mfa") || null }); await Store.carregarApi(); render(); }
      else if (aba === "cadastrar") { await api("POST", "api/auth/cadastrar", { nome: v("lg-nome"), email: v("lg-email"), senha: $("#lg-senha").value }); UI.aba.login = "entrar"; UI.msgLogin = "Conta criada. Entre com seu e-mail e senha."; render(); }
      else if (!UI.resetEnviado) { await api("POST", "api/auth/recuperar", { email: v("lg-email") }); UI.resetEnviado = v("lg-email"); UI.msgLogin = "Se o e-mail existir, enviamos um código (ou o administrador vê no log do servidor)."; render(); }
      else { await api("POST", "api/auth/redefinir", { email: UI.resetEnviado, token: v("lg-token"), nova_senha: $("#lg-nova").value }); UI.resetEnviado = null; UI.aba.login = "entrar"; UI.msgLogin = "Senha trocada. Entre com a nova senha."; render(); }
    } catch (e) { $("#lg-msg").textContent = e.message; }
  });
}

// ---------- início ----------
(async function iniciar() {
  await Store.iniciar();
  if (Store.modo === "api") {
    try { Store.usuario = await api("GET", "api/auth/eu"); await Store.carregarApi(); } catch { Store.usuario = null; }
  }
  render();
  setTimeout(() => verificarAlertas(false), 2500);
})();
