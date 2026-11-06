/* Módulos adicionais: gráfico de trade (velas), mapa do mercado, comparação de preços e ofertas, fotos e guia.
   Carregado depois de app.js; registra telas em T, ações em A e esquemas em S. */
"use strict";

// ---------- fotos ----------
// Fotos enviadas (assets do claude.ai ou anexos do servidor) aparecem na página.
// Links de outros sites podem ser bloqueados pelo navegador: viram um botão que abre a foto.
const fotoHTML = (u, classe = "thumb") => (u
  ? `<img class="${classe}" src="${esc(u)}" alt="" loading="lazy" data-foto="${esc(u)}">`
  : `<span class="${classe} sem-foto" aria-hidden="true"></span>`);
document.addEventListener("error", (e) => {
  const el = e.target;
  if (el.tagName !== "IMG" || !el.dataset.foto) return;
  const a = document.createElement("a");
  a.href = linkSeguro(el.dataset.foto) || "#"; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "btn mini"; a.textContent = "foto ↗";
  el.replaceWith(a);
}, true);
async function enviarArquivo(file) {
  if (Store.modo === "claude") {
    const assets = await cap("assets"); if (!assets) throw new Error("envio de arquivos indisponível para este acesso");
    const r = await assets.upload(file); return { id: r.id, url: r.url, nome: file.name };
  }
  if (Store.modo === "api") {
    const fd = new FormData(); fd.append("arquivo", file);
    const r = await fetch("api/anexos", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CT": "1" } });
    if (!r.ok) throw new Error((await r.json()).detail); const j = await r.json(); return { id: j.id, url: j.url, nome: file.name };
  }
  throw new Error("envio de fotos funciona no claude.ai ou com o servidor");
}
document.addEventListener("change", async (ev) => {
  const el = ev.target; if (!el.dataset?.fotoCampo) return;
  const file = el.files[0]; if (!file) return;
  try {
    const r = await enviarArquivo(file);
    const campo = $("#fm-" + el.dataset.fotoCampo); campo.value = r.url;
    const prev = el.parentElement.querySelector(".foto-prev"); if (prev) prev.outerHTML = fotoHTML(r.url, "foto-prev");
    toast("Foto enviada. Salve para gravar.");
  } catch (e) { toast("Não enviou: " + (e.message || e.code)); }
  el.value = "";
});

// ---------- esquemas novos ----------
const PLATAFORMAS_BR = ["Mercado Livre", "Shopee", "Amazon", "Magalu", "Americanas", "Loja própria", "Outra"];
S.ofertas = { nome: "Oferta", titulo: (d) => d.titulo, campos: [
  f("produto_id", "Produto", "ref", { col: "produtos", req: 1 }),
  f("lado", "Onde", "select", { req: 1, op: ["china", "brasil"], rot: { china: "China (preço de compra)", brasil: "Brasil (concorrente / preço de venda)" } }),
  f("plataforma", "Plataforma", "select", { op: [...PLATAFORMAS.filter((p) => p !== "Outra"), ...PLATAFORMAS_BR] }),
  f("titulo", "Título do anúncio", "text", { req: 1 }), f("url", "Link do anúncio", "url"), f("imagem", "Foto", "foto"),
  f("preco", "Preço por unidade", "number", { req: 1 }), f("moeda", "Moeda", "select", { op: ["CNY", "USD", "BRL"], pad: "BRL" }),
  f("moq", "Pedido mínimo (unidades)", "number"), f("frete", "Frete por unidade (mesma moeda)", "number"),
  f("vendedor", "Loja / vendedor"), f("vendidos", "Vendidos / avaliações"), f("observado_em", "Preço visto em", "date", { pad: hoje }),
  f("fonte", "Fonte"), f("notas", "Anotações", "textarea"),
] };
S.anuncios = { nome: "Anúncio de venda", titulo: (d) => d.titulo, campos: [
  f("produto_id", "Produto", "ref", { col: "produtos", req: 1 }), f("titulo", "Título", "text", { req: 1 }),
  f("preco", "Preço de venda (R$)", "number", { req: 1 }), f("preco_de", "Preço “de” riscado (R$)", "number"),
  f("canal", "Canal", "select", { op: ["Mercado Livre", "Shopee", "Amazon", "Loja própria", "Instagram", "WhatsApp", "Atacado", "Outro"] }),
  f("imagem", "Foto principal", "foto"), f("descricao", "Descrição", "textarea"),
  f("status", "Status", "select", { op: ["rascunho", "publicado", "pausado", "encerrado"], pad: "rascunho" }), f("url", "Link do anúncio publicado", "url"),
] };
for (const c of ["produtos", "links"]) { const k = S[c].campos.find((x) => x.k === "imagem"); if (k) { k.t = "foto"; k.l = c === "produtos" ? "Foto do produto" : "Imagem"; } }
COLS.push("ofertas", "anuncios");
Store.dados.ofertas ||= new Map(); Store.dados.anuncios ||= new Map();
MENU.splice(MENU.findIndex((m) => m[0] === "trade") + 1, 0, ["grafico", "Gráfico de Trade ao vivo"]);
MENU.splice(MENU.findIndex((m) => m[0] === "china") + 1, 0, ["ofertas", "Comparar e Ofertas"]);
MENU.push(["guia", "Guia do Banco de Dados"]);

// ---------- série de preços (velas quando houver) ----------
const serieFech = (q) => (q?.velas?.length ? q.velas.map((v) => +v[4]) : (q?.historico || []).map((p) => +p.c));
const pontosGrafico = (q) => (q?.velas?.length ? q.velas.map((v) => ({ t: v[0], c: v[4] })) : q?.historico || []);

// ---------- gráfico de trade (TradingView Lightweight Charts) ----------
const graficosAtivos = [];
function montarGraficos() {
  graficosAtivos.splice(0).forEach(({ ch, ro }) => { ro.disconnect(); try { ch.remove(); } catch { /* já removido */ } });
  $$("[data-trade]").forEach(criarTrade);
}
function criarTrade(el) {
  const q = cotacoes().find((x) => x.id === el.dataset.trade); if (!q) return;
  const modo = el.dataset.modo || "dia";
  const velas = modo === "intradia" ? q.intradia || [] : q.velas || [];
  if (!velas.length || !window.LightweightCharts) {
    el.style.height = "auto";
    el.innerHTML = modo === "intradia" && !q.intradia?.length
      ? `<div class="vazio">Gráfico de 15 minutos disponível para ${esc(AO_VIVO_PAGINA.join(", "))}. Escolha “Diário” para este ativo.</div>`
      : grafico(pontosGrafico(q), { altura: 260, rotuloY: (v) => fmtN(v, v > 1000 ? 0 : 2) });
    return;
  }
  const css = getComputedStyle(document.documentElement); const cor = (n) => css.getPropertyValue(n).trim();
  const fuso = -new Date().getTimezoneOffset() * 60;
  const tempo = (t) => (modo === "intradia" ? t + fuso : t);
  const ch = LightweightCharts.createChart(el, {
    width: el.clientWidth, height: el.clientHeight || 380,
    layout: { background: { type: "solid", color: cor("--papel") }, textColor: cor("--suave"), fontFamily: "IBM Plex Mono, ui-monospace, monospace" },
    grid: { vertLines: { color: cor("--linha") }, horzLines: { color: cor("--linha") } },
    rightPriceScale: { borderColor: cor("--linha") },
    timeScale: { borderColor: cor("--linha"), timeVisible: modo === "intradia", secondsVisible: false },
    crosshair: { mode: 0 },
    localization: { locale: "pt-BR", priceFormatter: (p) => fmtN(p, Math.abs(p) >= 100 ? 2 : 4) },
  });
  const velasS = ch.addCandlestickSeries({ upColor: cor("--alta"), downColor: cor("--queda"), borderVisible: false, wickUpColor: cor("--alta"), wickDownColor: cor("--queda") });
  velasS.setData(velas.map((v) => ({ time: tempo(v[0]), open: v[1], high: v[2], low: v[3], close: v[4] })));
  if (velas.some((v) => v[5])) {
    const vol = ch.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(velas.map((v) => ({ time: tempo(v[0]), value: v[5], color: (v[4] >= v[1] ? cor("--alta") : cor("--queda")) + "55" })));
  }
  if (modo !== "intradia") {
    const fech = velas.map((v) => v[4]);
    for (const [n, c] of [[20, "--acento"], [50, "--ia"]]) {
      const m = Ind.sma(fech, n); if (!m.some((x) => x != null)) continue;
      const linha = ch.addLineSeries({ color: cor(c), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      linha.setData(velas.map((v, i) => (m[i] == null ? null : { time: v[0], value: m[i] })).filter(Boolean));
    }
  }
  const n = { "1m": 22, "3m": 66 }[el.dataset.periodo];
  if (n && velas.length > n && modo !== "intradia") ch.timeScale().setVisibleLogicalRange({ from: velas.length - n, to: velas.length + 1 });
  else ch.timeScale().fitContent();
  const leg = el.parentElement.querySelector(".legenda");
  ch.subscribeCrosshairMove((p) => {
    const d = p?.seriesData?.get(velasS); if (!leg) return;
    leg.textContent = d ? `Abertura ${fmtN(d.open, 4)} · Máxima ${fmtN(d.high, 4)} · Mínima ${fmtN(d.low, 4)} · Fechamento ${fmtN(d.close, 4)}` : "Toque ou passe o mouse sobre uma vela para ver os valores.";
  });
  const ro = new ResizeObserver(() => { if (el.isConnected && el.clientWidth) ch.applyOptions({ width: el.clientWidth }); });
  ro.observe(el);
  graficosAtivos.push({ ch, ro });
}
const AO_VIVO_PAGINA = ["IBOV", "SPX", "USDBRL", "CNYBRL", "BTC", "PETR4", "VALE3", "NVDA"];

T.grafico = () => {
  const lista = cotacoes().filter((q) => q.preco != null);
  const sel = UI.gAtivo && lista.find((q) => q.id === UI.gAtivo) ? UI.gAtivo : lista.find((q) => q.id === "IBOV")?.id || lista[0]?.id;
  const q = lista.find((x) => x.id === sel);
  const modo = UI.gModo || (q?.intradia?.length ? "intradia" : "dia");
  const per = UI.gPer || "3m";
  const fech = serieFech(q); const rsi = Ind.rsi(fech); const macd = Ind.macd(fech);
  const botoes = [["intradia", "Hoje (15 min)"], ["1m", "1 mês"], ["3m", "3 meses"], ["tudo", "Tudo"]].map(([k, r]) => {
    const ativo = k === "intradia" ? modo === "intradia" : modo !== "intradia" && per === k;
    return `<button class="btn mini ${ativo ? "pri" : ""}" data-a="g-per" data-k="${k}">${r}</button>`;
  }).join("");
  return cab("Gráfico de Trade ao vivo", "Velas diárias com volume e médias de 20 e 50 períodos, e gráfico de 15 minutos do pregão de hoje. Atualiza sozinho quando chegam cotações novas.", `<a class="btn" href="#trade" data-a="ver-ativo" data-id="${esc(sel || "")}">Analisar no Trade Intelligence</a>`) +
    avisoFonte() +
    (q ? `<section class="painel">
      <div class="filtros"><label class="campo" style="min-width:220px;flex:1">Ativo<select id="g-ativo" data-a2="g-ativo">${["acao_br", "indice", "acao_us", "etf", "moeda", "cripto"].map((c) => `<optgroup label="${esc(CLASSES[c])}">${lista.filter((x) => x.classe === c).map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.simbolo)} · ${esc(x.nome)}</option>`).join("")}</optgroup>`).join("")}</select></label>
        <div class="acoes" role="group" aria-label="Período">${botoes}</div></div>
      <div class="trade-topo"><div><b class="num" style="font-size:1.6rem">${q.moeda === "pts" ? fmtN(q.preco, 0) : moeda(q.preco, q.moeda || "BRL")}</b> <span class="num ${cls(q.variacao_pct)}">${pct(q.variacao_pct)}</span></div>
        <div class="suave" style="font-size:.82rem">${pill(q.tipo)} ${esc(q.fonte || "")} · ${esc(dataBR(q.horario))} · RSI ${fmtN(rsi, 0)} · MACD ${macd ? (macd.hist > 0 ? "positivo" : "negativo") : "—"}</div></div>
      <div class="trade-grafico" data-trade="${esc(q.id)}" data-modo="${modo}" data-periodo="${per}"></div>
      <p class="legenda suave" style="margin:0;font-size:.78rem">Toque ou passe o mouse sobre uma vela para ver os valores.</p>
      <p class="suave" style="margin:0;font-size:.76rem">Linha azul: média de 20 · linha roxa: média de 50 · barras: volume. ${window.LightweightCharts ? "" : "A biblioteca de gráficos não carregou: mostrando a linha de fechamentos."}</p>
    </section>` : `<div class="vazio">Nenhuma cotação carregada ainda.</div>`) +
    `<section class="painel"><header><h2>Mapa do mercado</h2><span class="suave">cor = variação do dia · toque para abrir o gráfico</span></header>${mapaMercado()}</section>`;
};
function mapaMercado() {
  const lista = cotacoes().filter((q) => q.preco != null);
  if (!lista.length) return `<div class="vazio">Sem cotações.</div>`;
  return ["indice", "acao_br", "acao_us", "etf", "moeda", "cripto"].map((c) => {
    const itens = lista.filter((q) => q.classe === c); if (!itens.length) return "";
    return `<div><div class="rotulo" style="margin:6px 0">${esc(CLASSES[c])}</div><div class="mapa">${itens.map((q) => {
      const v = q.variacao_pct ?? 0; const forca = Math.min(Math.abs(v) * 18, 75);
      const fundo = v === 0 || q.variacao_pct == null ? "var(--papel2)" : `color-mix(in srgb, var(${v > 0 ? "--alta" : "--queda"}) ${forca.toFixed(0)}%, var(--papel))`;
      return `<button class="tile" data-a="g-tile" data-id="${esc(q.id)}" style="background:${fundo}" title="${esc(q.nome)}"><b>${esc(q.simbolo)}</b><span class="num">${pct(q.variacao_pct)}</span><small class="num">${q.moeda === "pts" ? fmtN(q.preco, 0) : fmtN(q.preco, q.preco < 1 ? 4 : 2)}</small></button>`;
    }).join("")}</div></div>`;
  }).join("");
}

// ---------- comparar preços e ofertas ----------
function custoOferta(o, p) {
  if (o.lado === "brasil") return { unit: (n(o.preco) || 0) + (n(o.frete) || 0), brl: true };
  const base = { ...(p || {}), preco_origem: n(o.preco) + (n(o.frete) || 0), moeda: o.moeda || "USD" };
  const c = custoImportacao(base);
  return { ...c, precoBRL: emBRL(n(o.preco), o.moeda || "USD") };
}
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function resumoOfertas(pid) {
  const p = Store.um("produtos", pid);
  const os = Store.todos("ofertas").filter((o) => o.produto_id === pid);
  const ch = os.filter((o) => o.lado === "china").map((o) => ({ o, c: custoOferta(o, p) })).sort((a, b) => (a.c.unit ?? 1e12) - (b.c.unit ?? 1e12));
  const br = os.filter((o) => o.lado === "brasil").map((o) => ({ o, v: custoOferta(o, p).unit })).sort((a, b) => a.v - b.v);
  const med = mediana(br.map((x) => x.v));
  const melhor = ch.find((x) => !x.c.erro);
  const taxaCanal = n(cfg().taxa_canal_pct) / 100;
  const margem = melhor && med ? ((med * (1 - taxaCanal) - melhor.c.unit) / med) * 100 : null;
  return { p, os, ch, br, med, melhor, margem, menorBR: br[0]?.v ?? null };
}
T.ofertas = () => {
  const prods = Store.todos("produtos");
  if (!prods.length) return cab("Comparar e Ofertas", "Compare o preço de compra na China com o preço de venda no Brasil e gere seus anúncios.") + `<div class="vazio">Cadastre um produto primeiro.<button class="btn pri" data-a="novo" data-c="produtos">Cadastrar produto</button></div>`;
  const pid = UI.ofProd && Store.um("produtos", UI.ofProd) ? UI.ofProd : (prods.find((p) => Store.todos("ofertas").some((o) => o.produto_id === p.id)) || prods[0]).id;
  UI.ofProd = pid;
  const r = resumoOfertas(pid); const c = cfg();
  const margemAlvo = n(UI.ofMargem) ?? 30;
  const custo = r.melhor?.c.unit ?? null;
  const minimo = custo != null ? custo / Math.max(0.05, 1 - n(c.taxa_canal_pct) / 100 - margemAlvo / 100) : null;
  const sugerido = minimo != null ? arred90(Math.max(minimo, (r.med ?? minimo) * 0.97)) : null;
  const anuncios = Store.todos("anuncios").filter((a) => a.produto_id === pid).sort((a, b) => (b.criado_em || "").localeCompare(a.criado_em || ""));
  const barrasDados = [...r.ch.filter((x) => !x.c.erro).map((x) => ({ r: "China · " + (x.o.plataforma || ""), v: x.c.unit })), ...r.br.map((x) => ({ r: "Brasil · " + (x.o.plataforma || ""), v: x.v }))];
  return cab("Comparar e Ofertas", "Ofertas de compra na China (com custo nacionalizado) lado a lado com os preços de venda no Brasil. Daqui você gera e salva seus anúncios.",
    `<button class="btn" data-a="nova-oferta" data-lado="china">Nova oferta China</button><button class="btn" data-a="nova-oferta" data-lado="brasil">Novo preço Brasil</button><a class="btn" href="#china">Pesquisar no CHINA SCANNER</a>`) +
    `<div class="filtros"><label class="campo" style="flex:1;min-width:220px">Produto<select id="of-prod" data-a2="of-prod">${prods.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></label></div>
    <div class="kpis">
      <div class="kpi"><span class="rotulo">Menor custo China</span><b>${moeda(custo)}</b><small>por unidade, já nacionalizado${r.melhor ? " · " + esc(r.melhor.o.plataforma || "") : ""}</small></div>
      <div class="kpi"><span class="rotulo">Preço mediano no Brasil</span><b>${moeda(r.med)}</b><small>${r.br.length} anúncios · menor ${moeda(r.menorBR)}</small></div>
      <div class="kpi"><span class="rotulo">Margem vendendo pela mediana</span><b class="${cls(r.margem)}">${pct(r.margem, 1)}</b><small>após taxa do canal de ${c.taxa_canal_pct}%</small></div>
      <div class="kpi"><span class="rotulo">Ofertas salvas</span><b>${r.os.length}</b><small>${r.ch.length} China · ${r.br.length} Brasil</small></div>
    </div>
    ${r.os.length ? `<section class="painel"><header><h2>Comparação em reais por unidade</h2><span class="suave">China = custo nacionalizado · Brasil = preço + frete</span></header>${barras(barrasDados.sort((a, b) => a.v - b.v))}</section>` : ""}
    <section class="painel"><header><h2>Comprar na China</h2><span class="suave">ordenado pelo custo nacionalizado</span></header>
    ${tabela("of-ch", r.ch, [
      { l: "", h: (x) => fotoHTML(x.o.imagem) },
      { l: "Oferta", h: (x) => `<b>${esc(x.o.titulo)}</b><br><small class="suave">${esc([x.o.plataforma, x.o.vendedor, x.o.vendidos].filter(Boolean).join(" · "))}</small>`, ord: (x) => x.o.titulo },
      { l: "Preço", num: 1, v: (x) => moeda(x.o.preco, x.o.moeda || "USD"), ord: (x) => x.c.precoBRL ?? 0 },
      { l: "Em reais", num: 1, v: (x) => moeda(x.c.precoBRL) },
      { l: "MOQ", num: 1, v: (x) => fmtN(x.o.moq, 0) },
      { l: "Custo nacionalizado/un.", num: 1, h: (x) => (x.c.erro ? `<span class="suave" title="${esc(x.c.erro)}">falta câmbio</span>` : `<b class="num">${moeda(x.c.unit)}</b>`), ord: (x) => x.c.unit ?? 1e12 },
      { l: "Visto em", v: (x) => dataBR(x.o.observado_em, false) },
      { l: "", h: (x) => `<span class="acoes">${abrirLink(x.o.url)}<button class="btn mini" data-a="usar-oferta" data-id="${esc(x.o.id)}">Usar no produto</button><button class="btn mini" data-a="editar" data-c="ofertas" data-id="${esc(x.o.id)}">Editar</button><button class="btn mini perigo" data-a="excluir" data-c="ofertas" data-id="${esc(x.o.id)}">Excluir</button></span>` },
    ], { vazio: "Nenhuma oferta da China salva para este produto.", acao: ` <button class="btn pri" data-a="nova-oferta" data-lado="china">Nova oferta China</button>` })}</section>
    <section class="painel"><header><h2>Concorrentes no Brasil</h2><span class="suave">preço de venda ao consumidor</span></header>
    ${tabela("of-br", r.br, [
      { l: "", h: (x) => fotoHTML(x.o.imagem) },
      { l: "Anúncio", h: (x) => `<b>${esc(x.o.titulo)}</b><br><small class="suave">${esc([x.o.plataforma, x.o.vendedor, x.o.vendidos].filter(Boolean).join(" · "))}</small>`, ord: (x) => x.o.titulo },
      { l: "Preço + frete", num: 1, h: (x) => `<b class="num">${moeda(x.v)}</b>`, ord: (x) => x.v },
      { l: "Margem se vender por esse preço", num: 1, h: (x) => { const m = custo != null ? ((x.v * (1 - n(c.taxa_canal_pct) / 100) - custo) / x.v) * 100 : null; return `<span class="num ${cls(m)}">${pct(m, 1)}</span>`; } },
      { l: "Visto em", v: (x) => dataBR(x.o.observado_em, false) },
      { l: "", h: (x) => `<span class="acoes">${abrirLink(x.o.url)}<button class="btn mini" data-a="editar" data-c="ofertas" data-id="${esc(x.o.id)}">Editar</button><button class="btn mini perigo" data-a="excluir" data-c="ofertas" data-id="${esc(x.o.id)}">Excluir</button></span>` },
    ], { vazio: "Nenhum preço do Brasil salvo para este produto.", acao: ` <button class="btn pri" data-a="nova-oferta" data-lado="brasil">Novo preço Brasil</button>` })}</section>
    <section class="painel"><header><h2>Gerar anúncio de venda</h2><span class="pill sim">sugestão</span></header>
      <div class="grade"><label class="campo">Margem desejada (%)<input id="of-margem" type="number" step="any" value="${esc(margemAlvo)}"></label>
        <label class="campo">Canal<select id="of-canal">${S.anuncios.campos.find((x) => x.k === "canal").op.map((o) => `<option ${o === (UI.ofCanal || "Mercado Livre") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label></div>
      <div class="linhas-calc"><span>Custo nacionalizado por unidade</span><span class="num">${moeda(custo)}</span>
        <span>Preço mínimo para ${fmtN(margemAlvo, 0)}% de margem (taxa ${c.taxa_canal_pct}%)</span><span class="num">${moeda(minimo)}</span>
        <span>Mediana dos concorrentes</span><span class="num">${moeda(r.med)}</span>
        <span class="t">Preço sugerido</span><span class="t num">${moeda(sugerido)}</span></div>
      ${sugerido != null && r.med != null && minimo > r.med ? `<div class="nota">Com essa margem, seu preço fica acima da mediana dos concorrentes. Reduza a margem ou procure um fornecedor mais barato.</div>` : ""}
      <div class="acoes"><button class="btn pri" data-a="gerar-anuncio" ${sugerido == null ? "disabled" : ""}>Gerar e salvar anúncio</button>${sugerido == null ? `<span class="suave">Salve ao menos uma oferta da China com câmbio disponível.</span>` : ""}</div>
      ${UI.resultadoIA.anuncio?.erro ? `<div class="nota">${esc(UI.resultadoIA.anuncio.erro)}</div>` : ""}
    </section>
    <section class="painel"><header><h2>Meus anúncios deste produto</h2><button class="btn mini" data-a="novo-anuncio">Anúncio em branco</button></header>
    ${anuncios.length ? anuncios.map((a) => `<article class="anuncio">${fotoHTML(a.imagem, "foto-prev")}<div style="min-width:0;flex:1"><div class="linha" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(a.titulo)}</b><span class="pill st-${a.status === "publicado" ? "comprado" : "pesquisando"}">${esc(a.status || "rascunho")}</span></div>
      <div><b class="num" style="font-size:1.15rem">${moeda(a.preco)}</b> ${a.preco_de ? `<s class="suave num">${moeda(a.preco_de)}</s>` : ""} <span class="suave">· ${esc(a.canal || "")}</span></div>
      <p class="saida-ia" style="max-height:160px;margin:6px 0">${esc(a.descricao || "")}</p>
      <div class="acoes"><button class="btn mini" data-a="copiar-anuncio" data-id="${esc(a.id)}">Copiar texto</button>${abrirLink(a.url, "Ver anúncio ↗")}<button class="btn mini" data-a="editar" data-c="anuncios" data-id="${esc(a.id)}">Editar</button><button class="btn mini perigo" data-a="excluir" data-c="anuncios" data-id="${esc(a.id)}">Excluir</button></div></div></article>`).join("") : `<div class="vazio">Nenhum anúncio ainda. Use “Gerar e salvar anúncio”.</div>`}
    </section>`;
};
const arred90 = (v) => Math.max(0.9, Math.floor(v) + 0.9);

Object.assign(A, {
  "g-per": (el) => { const k = el.dataset.k; if (k === "intradia") UI.gModo = "intradia"; else { UI.gModo = "dia"; UI.gPer = k; } render(); },
  "g-tile": (el) => { UI.gAtivo = el.dataset.id; UI.gModo = null; if (rota() !== "grafico") location.hash = "grafico"; else { render(); $("#g-ativo")?.scrollIntoView({ block: "center" }); } },
  "nova-oferta": (el) => abrirForm("ofertas", null, { produto_id: UI.ofProd, lado: el.dataset.lado, moeda: el.dataset.lado === "china" ? "USD" : "BRL" }),
  "novo-anuncio": () => abrirForm("anuncios", null, { produto_id: UI.ofProd }),
  "usar-oferta": async (el) => {
    const o = Store.um("ofertas", el.dataset.id); const p = Store.um("produtos", o.produto_id);
    await Store.salvar("produtos", { ...p, preco_origem: n(o.preco), moeda: o.moeda, link: o.url || p.link, plataforma: PLATAFORMAS.includes(o.plataforma) ? o.plataforma : p.plataforma, moq: n(o.moq) ?? p.moq, imagem: p.imagem || o.imagem });
    toast(`${p.nome}: preço de compra atualizado para ${moeda(o.preco, o.moeda)}.`);
  },
  "copiar-anuncio": (el) => {
    const a = Store.um("anuncios", el.dataset.id);
    const txt = `${a.titulo}\n\nPreço: ${moeda(a.preco)}${a.preco_de ? ` (de ${moeda(a.preco_de)})` : ""}\n\n${a.descricao || ""}`;
    navigator.clipboard?.writeText(txt).then(() => toast("Texto do anúncio copiado.")).catch(() => toast("Não copiou: use Editar e copie do campo Descrição."));
  },
  "gerar-anuncio": async () => {
    const r = resumoOfertas(UI.ofProd); const c = cfg();
    const margemAlvo = n($("#of-margem")?.value) ?? 30; UI.ofMargem = margemAlvo; UI.ofCanal = $("#of-canal")?.value;
    const custo = r.melhor.c.unit; const minimo = custo / Math.max(0.05, 1 - n(c.taxa_canal_pct) / 100 - margemAlvo / 100);
    const preco = arred90(Math.max(minimo, (r.med ?? minimo) * 0.97));
    const conc = r.br.slice(0, 8).map((x) => `${x.o.plataforma}: ${x.o.titulo} — R$ ${fmtN(x.v)}`).join("\n");
    let titulo = r.p.nome.replace(/^EXEMPLO — /, ""), descricao = "";
    const sample = await cap("sample");
    if (sample) {
      toast("Escrevendo o anúncio…");
      try {
        const j = await sample.json(`Escreva um anúncio de venda em português do Brasil para ${UI.ofCanal || "Mercado Livre"}. Produto: ${titulo}. Notas do produto: ${r.p.notas || "—"}. Preço de venda: R$ ${fmtN(preco)}. Concorrentes vistos:\n${conc || "—"}\nRegras: não invente certificações, garantias, marcas nem especificações que não estejam nos dados; destaque o que for comum nos concorrentes (capacidade, material) de forma genérica. Responda só JSON {"titulo":"até 60 caracteres","descricao":"5 a 8 linhas com tópicos"}.`, { modelTier: "quick" });
        titulo = String(j.titulo || titulo).slice(0, 80); descricao = String(j.descricao || "");
      } catch { /* usa o modelo abaixo */ }
    }
    if (!descricao) descricao = `${titulo}\n• Produto importado, pronta entrega\n• Confira medidas e material nas fotos\n• Envio rápido com código de rastreio\n• Dúvidas? Pergunte antes de comprar`;
    await Store.salvar("anuncios", { produto_id: UI.ofProd, titulo, preco, preco_de: r.med && r.med > preco ? arred90(r.med * 1.15) : null, canal: UI.ofCanal, imagem: r.p.imagem || r.melhor.o.imagem || "", descricao, status: "rascunho", base: { custo, margem_alvo: margemAlvo, mediana_concorrentes: r.med } });
    toast("Anúncio gerado e salvo como rascunho.");
  },
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.a2 === "g-ativo") { UI.gAtivo = el.value; UI.gModo = null; render(); }
  if (el.dataset.a2 === "of-prod") { UI.ofProd = el.value; render(); }
  if (el.id === "of-margem" || el.id === "of-canal") { UI.ofMargem = n($("#of-margem").value); UI.ofCanal = $("#of-canal").value; render(); }
});

// ---------- guia do banco de dados ----------
const bloco = (cmd) => `<div class="cmd"><pre>${esc(cmd)}</pre><button class="btn mini" data-a="copiar-cmd">Copiar</button></div>`;
A["copiar-cmd"] = (el) => { const t = el.parentElement.querySelector("pre").textContent; navigator.clipboard?.writeText(t).then(() => toast("Comando copiado.")).catch(() => toast("Selecione o texto e copie.")); };
T.guia = () => cab("Guia do Banco de Dados", "Onde seus dados ficam hoje e o passo a passo completo para ter um banco de dados próprio, com login.") + `
<section class="painel guia"><h2>1. Onde seus dados estão salvos agora</h2>
<p>Tudo o que você cadastra neste link (produtos, ofertas, fornecedores, vendas, links, fotos e anúncios) fica salvo <b>na sua conta do claude.ai</b>, no banco de dados deste artefato. ${Store.modo === "claude" ? "<b>Este acesso está salvando no claude.ai agora.</b>" : ""}</p>
<ul><li>Só você vê os dados. Quem receber o link sem ser editor não lê nada.</li>
<li>Salva sozinho a cada alteração. Não existe botão “salvar tudo”.</li>
<li>Abre igual no celular e no computador, desde que você entre com a mesma conta do claude.ai.</li></ul>
<p><b>Faça cópia de segurança toda semana:</b> menu <a href="#relatorios">Relatórios e Exportar</a> → <i>Backup completo (JSON)</i>. Para abrir no Excel, use <i>Planilha Excel</i>.</p></section>

<section class="painel guia"><h2>2. Banco de dados próprio (servidor com login, PostgreSQL e cotações a cada minuto)</h2>
<p>Use quando quiser vários usuários com senha, código no celular (MFA) e os dados no seu próprio servidor. A tela é a mesma deste link.</p>
<ol>
<li><b>Escolha onde rodar.</b> No seu computador (Windows, Mac ou Linux) para testar, ou num servidor na nuvem (VPS Linux com 2 GB de memória) para usar pela internet.</li>
<li><b>Instale o Docker.</b> Computador: baixe o Docker Desktop em docker.com e abra o programa. VPS Ubuntu:${bloco("curl -fsSL https://get.docker.com | sh")}</li>
<li><b>Baixe o projeto.</b>${bloco("git clone https://github.com/fabricagovv-byte/database.git\ncd database\ngit checkout claude/focused-archimedes-erhhju\ncd china-trade")}</li>
<li><b>Crie o arquivo de configuração</b> e gere a chave que cifra seus dados:${bloco("cp .env.example .env\npython3 -c \"from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())\"")}
Abra o arquivo <code>.env</code>, cole a chave gerada em <code>CT_CHAVE_CRIPTO=</code> e troque <code>POSTGRES_PASSWORD</code> por uma senha forte. Guarde a chave num lugar seguro: sem ela os dados não abrem.</li>
<li><b>Ligue tudo</b> (banco PostgreSQL, Redis, API e o coletor de cotações):${bloco("docker compose up -d --build")}</li>
<li><b>Abra o sistema</b> em <code>http://localhost:8000</code> (ou <code>http://IP-DO-SERVIDOR:8000</code>). Clique em <i>Criar conta</i>: <b>a primeira conta vira administradora</b>.</li>
<li><b>Ative o código no celular:</b> Configurações → Segurança da conta → Ativar MFA. Use Google Authenticator, Authy ou Microsoft Authenticator.</li>
<li><b>Traga seus dados do claude.ai:</b> neste link, Relatórios → <i>Backup completo (JSON)</i>. No servidor, Relatórios → <i>Importar arquivo</i>. Produtos, ofertas, vendas e links passam para o PostgreSQL.</li>
<li><b>Para acessar pela internet com cadeado (HTTPS):</b> aponte um domínio para o servidor e coloque o Caddy na frente. Depois troque <code>CT_COOKIE_SEGURO=true</code> no <code>.env</code> e rode de novo o <code>docker compose up -d</code>.${bloco("sudo apt install -y caddy\necho 'seudominio.com.br {\n  reverse_proxy localhost:8000\n}' | sudo tee /etc/caddy/Caddyfile\nsudo systemctl reload caddy")}</li>
<li><b>Cópia de segurança diária do banco:</b>${bloco("docker compose exec -T postgres pg_dump -U chinatrade chinatrade > backup-$(date +%F).sql")}</li>
<li><b>Opcional, chaves de serviços</b> no <code>.env</code>:
<ul><li><code>BRAPI_TOKEN</code>: cotações da B3.</li>
<li><code>ALIYUN_ACCESS_KEY_ID/SECRET</code>: tradução para o 1688.</li>
<li><code>SMTP_*</code>: alertas por e-mail.</li>
<li><code>WHATSAPP_TOKEN</code>: alertas por WhatsApp.</li></ul>
Sem elas o sistema funciona com as fontes gratuitas.</li>
</ol>
<div class="nota">Comandos úteis:
<ul><li><code>docker compose logs -f api</code>: ver o que o sistema está fazendo.</li>
<li><code>docker compose logs api | grep "Código de redefinição"</code>: código de troca de senha quando não há e-mail configurado.</li>
<li><code>docker compose down</code>: desligar sem apagar os dados.</li></ul></div></section>

<section class="painel guia"><h2>3. Cotações e gráficos</h2>
<ul><li><b>Neste link:</b> uma rotina do Claude Code coleta as cotações no Yahoo Finance nos dias úteis e grava aqui. A página se atualiza sozinha e o selo “ao vivo” mostra o horário da última coleta.</li>
<li><b>No servidor próprio:</b> o coletor roda a cada 60 segundos e manda os preços na hora para a tela.</li>
<li>Cotações de bolsa no Yahoo Finance têm cerca de 15 minutos de atraso. Nada é inventado: sem dado, aparece “sem dados”.</li></ul></section>`;

// mostra o gráfico depois de cada desenho da tela
const renderOriginal = render;
render = function () { renderOriginal(); try { montarGraficos(); } catch (e) { console.error(e); } };
