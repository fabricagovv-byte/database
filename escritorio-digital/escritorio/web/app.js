"use strict";
// Escritório Digital — interface. Todo dado exibido passa por esc() (proteção contra XSS).

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const selo = (v) => `<span class="selo s-${esc(v)}">${esc(String(v ?? "—").replaceAll("_", " "))}</span>`;
const brl = (v) => (v === null || v === undefined || v === "") ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (v) => v ? new Date(v).toLocaleString("pt-BR") : "—";
let EU = null;

async function api(caminho, opcoes = {}) {
  const o = { credentials: "same-origin", ...opcoes };
  if (o.json !== undefined) { o.method = o.method || "POST"; o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(o.json); }
  const r = await fetch(caminho, o);
  const tipo = r.headers.get("content-type") || "";
  const corpo = tipo.includes("json") ? await r.json() : await r.text();
  if (r.status === 401) { mostrarLogin(); throw new Error("Sessão expirada"); }
  if (!r.ok) throw new Error((corpo && (corpo.erro || corpo.detail)) || `Erro ${r.status}`);
  return corpo;
}

function tabela(linhas, colunas, vazio = "Nada registrado ainda.") {
  if (!linhas || !linhas.length) return `<p class="sub">${esc(vazio)}</p>`;
  return `<div class="tabela"><table><thead><tr>${colunas.map((c) => `<th scope="col">${esc(c[0])}</th>`).join("")}</tr></thead><tbody>${
    linhas.map((l) => `<tr>${colunas.map((c) => `<td>${c[2] ? c[2](l[c[1]], l) : esc(l[c[1]])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function formulario(id, campos, rotulo) {
  return `<form class="linha" id="${id}">${campos.map(([nome, label, tipo = "text", extra = ""]) =>
    tipo === "textarea" ? `<label style="grid-column:1/-1">${esc(label)}<textarea name="${nome}" ${extra}></textarea></label>`
    : tipo === "file" ? `<label>${esc(label)}<input type="file" name="${nome}" ${extra}></label>`
    : tipo.startsWith("select:") ? `<label>${esc(label)}<select name="${nome}">${tipo.slice(7).split(",").map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`
    : `<label>${esc(label)}<input name="${nome}" type="${tipo}" ${extra}></label>`).join("")}<button type="submit">${esc(rotulo)}</button><p class="erro" role="alert"></p></form>`;
}

function aoEnviar(id, fn) {
  const f = document.getElementById(id);
  if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = f.querySelector(".erro");
    erro.textContent = "";
    try { await fn(Object.fromEntries(new FormData(f)), f); } catch (ex) { erro.textContent = ex.message; }
  });
}

const limpo = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== "" && !(v instanceof File)));

// ------------------------------------------------------------------ módulos
const MODULOS = [
  ["executiva", "Visão executiva"], ["escritorio", "Escritório ao vivo"], ["agentes", "Agentes"], ["squads", "Squads"],
  ["chats", "Chats"], ["servicos", "Meus serviços"], ["licitacoes", "Licitações"], ["documentos", "Documentos"],
  ["propostas", "Propostas"], ["fornecedores", "Fornecedores"], ["contratos", "Contratos"], ["projetos", "Projetos"],
  ["chamados", "Chamados e manutenção"], ["codigo", "Código e pipelines"], ["entregas", "Entregas e evidências"],
  ["medicoes", "Medições"], ["financeiro", "Financeiro"], ["notas", "Notas fiscais"], ["aprovacoes", "Aprovações"],
  ["relatorios", "Relatórios"], ["noticias", "Notícias"], ["integracoes", "Integrações"], ["seguranca", "Segurança"],
  ["configuracoes", "Configurações"],
];

const V = {};

V.executiva = async () => {
  const p = await api("/api/painel");
  const t = p.tarefas;
  return `<h1>Visão executiva</h1><p class="sub">O que precisa da sua atenção agora.</p>
  ${p.proximo_passo.map((x) => `<div class="passo">${esc(x)}</div>`).join("")}
  <div class="grade" style="margin-top:12px">
    ${[["A receber", brl(p.financeiro.a_receber)], ["A pagar", brl(p.financeiro.a_pagar)], ["Receita contratada", brl(p.financeiro.receita_contratada)],
       ["Faturada", brl(p.financeiro.receita_faturada)], ["Só em simulação (sem valor fiscal)", brl(p.financeiro.faturado_apenas_em_simulacao)], ["Recebida", brl(p.financeiro.receita_recebida)],
       ["Tarefas em execução", t.executando || 0], ["Bloqueadas", t.bloqueada || 0], ["Aguardando aprovação", t.aguardando_aprovacao || 0]]
      .map(([r, v]) => `<div class="cartao kpi"><div class="r">${esc(r)}</div><div class="v">${esc(v)}</div></div>`).join("")}
  </div>
  <h2>Decisões pendentes</h2>${tabela(p.aprovacoes_pendentes, [["#", "id"], ["Ação", "acao", selo], ["Resumo", "resumo"], ["Valor", "valor", brl]], "Nenhuma decisão pendente.")}
  <h2>Bloqueios</h2>${tabela(p.bloqueios, [["#", "id"], ["Tarefa", "titulo"], ["Motivo", "erro"], ["Responsável", "executor_id"]], "Sem bloqueios.")}
  <h2>Contratos</h2>${tabela(p.contratos, [["Número", "numero"], ["Objeto", "objeto"], ["Situação", "situacao", selo], ["Valor", "valor_total", brl]])}
  <h2>Integrações</h2>${tabela(p.integracoes, [["Integração", "nome"], ["Situação", "situacao", selo], ["Detalhe", "detalhe"]])}`;
};

let feedFn = null;
V.escritorio = async () => {
  const e = await api("/api/escritorio");
  const ev = await api("/api/eventos?limite=60");
  const deps = {};
  for (const a of e.agentes) (deps[a.departamento] ||= []).push(a);
  const nomes = { direcao: "Direção", licitacoes: "Licitações", juridico: "Jurídico", financeiro: "Financeiro", compras: "Compras",
    engenharia: "Engenharia de software", infra: "Infraestrutura e segurança", operacao: "Operação contratual", comunicacao: "Comunicação" };
  const mesa = (a) => {
    const ini = a.nome.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
    const ativo = a.estado !== "disponivel" || a.ultimo_evento;
    return `<div class="mesa"><div class="avatar ${esc(a.estado)}" aria-hidden="true">${esc(ini)}</div><div>
      <div class="n">${esc(a.nome)} ${selo(a.estado)}</div>
      ${a.tarefa ? `<div class="d">Tarefa #${esc(a.tarefa_id)}: ${esc(a.tarefa)}${a.decorrido_s ? ` · ${Math.round(a.decorrido_s / 60)} min` : ""}</div>` : ""}
      ${a.ultimo_evento ? `<div class="d">Último evento: ${esc(a.ultimo_evento.slice(0, 140))} · ${dt(a.ultimo_evento_em)}</div>` : ""}
      ${a.proxima ? `<div class="d">Próxima: #${esc(a.proxima.id)} ${esc(a.proxima.titulo)}</div>` : ""}
      ${ativo ? `<div class="acoes"><button class="secundario" data-conversar="${esc(a.id)}">Conversar</button>${a.tarefa_id && EU.papel === "admin" ? `<button class="secundario" data-pausar="${esc(a.tarefa_id)}">Pausar tarefa</button>` : ""}</div>` : ""}
    </div></div>`;
  };
  const ocupados = (xs) => xs.filter((a) => a.estado !== "disponivel" || a.ultimo_evento);
  setTimeout(() => {
    document.querySelectorAll("[data-conversar]").forEach((b) => b.onclick = () => { sessionStorage.setItem("chat", "agente:" + b.dataset.conversar); ir("chats"); });
    document.querySelectorAll("[data-pausar]").forEach((b) => b.onclick = async () => { await api(`/api/tarefas/${b.dataset.pausar}/estado`, { json: { para: "pausada", motivo: "pausada pelo administrador" } }); ir("escritorio"); });
    $("#mostrar-todos")?.addEventListener("change", (x) => { document.querySelectorAll(".mesa.ocioso").forEach((m) => m.hidden = !x.target.checked); });
    feedFn = (evt) => { const f = $("#feed"); if (!f) return; const d = document.createElement("div"); d.innerHTML = `<time>${dt(evt.criado_em)}</time><b>${esc(evt.ator_id)}</b> ${esc(evt.resumo)}`; f.prepend(d); };
  });
  return `<h1>Escritório ao vivo</h1><p class="sub">${esc(e.nota)}</p>
  <label style="display:flex;gap:6px;align-items:center;width:auto"><input type="checkbox" id="mostrar-todos" style="width:auto"> Mostrar agentes sem atividade registrada</label>
  <h2>Você (Arthur) — pendências humanas</h2>${tabela(e.administrador, [["#", "id"], ["Tarefa", "titulo"], ["Estado", "estado", selo]], "Nenhuma tarefa atribuída a você.")}
  <h2>Equipe humana</h2>${tabela(e.pessoas, [["Nome", "nome"], ["Função", "funcao"], ["Situação", "situacao", selo], ["Horas livres/mês", "horas_mes", (v, l) => esc(v - l.horas_alocadas)]], "Cadastre funcionários em Configurações.")}
  <h2>Salas</h2><div class="salas">${Object.entries(deps).map(([d, xs]) => `<section class="cartao sala" aria-label="${esc(nomes[d])}"><h3>${esc(nomes[d])}<span class="sub">${ocupados(xs).length}/${xs.length} com atividade</span></h3>
    ${xs.map((a) => (a.estado !== "disponivel" || a.ultimo_evento) ? mesa(a) : mesa(a).replace('class="mesa"', 'class="mesa ocioso" hidden')).join("")}</section>`).join("")}</div>
  <h2>Eventos em tempo real</h2><div class="cartao feed" id="feed" aria-live="polite">${ev.map((x) => `<div><time>${dt(x.criado_em)}</time><b>${esc(x.ator_id)}</b> ${esc(x.resumo)}</div>`).join("")}</div>`;
};

V.agentes = async () => {
  const a = await api("/api/agentes");
  const cont = a.reduce((m, x) => (m[x.implementacao] = (m[x.implementacao] || 0) + 1, m), {});
  return `<h1>Agentes (${a.length})</h1><p class="sub">Implementação real: ${esc(cont.deterministico || 0)} com habilidade determinística testada, ${esc(cont.ia_pendente || 0)} aguardando IA, ${esc(cont.apoio_humano || 0)} apoio a profissional humano.</p>
  ${tabela(a, [["Nº", "numero"], ["Agente", "nome"], ["Depto.", "departamento"], ["Missão", "missao"], ["Implementação", "implementacao", selo], ["Revisor", "revisor"], ["Estado", "estado", selo],
    ["", "id", (v) => `<button class="secundario" data-conv="${esc(v)}">Conversar</button>`]])}`;
};

V.squads = async () => {
  const s = await api("/api/squads");
  return `<h1>Squads</h1><p class="sub">Formados automaticamente por edital e por contrato, conforme o objeto.</p>` + (s.length ? s.map((x) =>
    `<div class="cartao" style="margin:10px 0"><h2 style="margin-top:0">${esc(x.nome)} ${selo(x.tipo)}</h2><p class="sub">Líder: ${esc(x.lider)} · Orçamento de IA: ${brl(x.orcamento_ia)}</p>
    ${tabela(x.membros, [["Agente", "nome"], ["Papel", "papel"], ["Motivo", "motivo"], ["Implementação", "implementacao", selo], ["Estado", "estado", selo]])}</div>`).join("") : `<p class="sub">Nenhum squad ainda. Analise um edital para formar o primeiro.</p>`);
};

V.chats = async () => {
  const agentes = await api("/api/agentes");
  const contratos = await api("/api/contratos");
  const atual = sessionStorage.getItem("chat") || "executivo:geral";
  const [canal, ref] = [atual.split(":")[0], atual.split(":").slice(1).join(":")];
  const msgs = await api(`/api/mensagens?canal=${encodeURIComponent(canal)}&ref=${encodeURIComponent(ref)}`);
  setTimeout(() => {
    $("#canal").onchange = (e) => { sessionStorage.setItem("chat", e.target.value); ir("chats"); };
    aoEnviar("f-msg", async (d) => { await api("/api/mensagens", { json: { canal, ref, texto: d.texto } }); ir("chats"); });
    document.querySelectorAll("[data-tarefa]").forEach((b) => b.onclick = async () => {
      const r = await api(`/api/mensagens/${b.dataset.tarefa}/tarefa`, { json: { executor: "gerente-de-projeto" } });
      alert(`Tarefa #${r.tarefa_id} criada. Informação transferida: ${JSON.stringify(r.informacao_transferida).slice(0, 300)}`);
    });
    const m = $(".msgs"); if (m) m.scrollTop = m.scrollHeight;
  });
  const opc = [["executivo:geral", "Chat executivo"], ...contratos.map((c) => [`contrato:${c.id}`, `Contrato ${c.numero}`]),
    ...agentes.map((a) => [`agente:${a.id}`, `Individual: ${a.nome}${["juridico", "financeiro"].includes(a.departamento) ? " (privado)" : ""}`])];
  return `<h1>Chats</h1><p class="sub">Mencione agentes com @identificador (ex.: @analista-de-medicao). Conversas com jurídico e financeiro são privadas e não são repassadas a outros agentes.</p>
  <div class="chat"><label>Canal<select id="canal">${opc.map(([v, n]) => `<option value="${esc(v)}" ${v === atual ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
  <div class="cartao"><div class="msgs" aria-live="polite">${msgs.map((m) => `<div class="msg ${m.autor_tipo === "usuario" ? "eu" : ""}"><small>${esc(m.autor_tipo)}:${esc(m.autor_id)} · ${dt(m.criado_em)} ${m.privado ? "· privado" : ""}</small>${esc(m.texto)}
    ${m.autor_tipo === "usuario" && EU.papel === "admin" ? `<div><button class="secundario" data-tarefa="${esc(m.id)}">Transformar em tarefa</button></div>` : ""}</div>`).join("") || `<p class="sub">Sem mensagens.</p>`}</div>
  ${formulario("f-msg", [["texto", "Mensagem", "textarea", "required"]], "Enviar")}</div></div>
  <div class="aviso">Mensagens nunca aprovam ações sensíveis. Aprovações só no módulo Aprovações, confirmando a versão.</div>`;
};

V.servicos = async () => {
  const s = await api("/api/servicos");
  setTimeout(() => aoEnviar("f-serv", async (d) => { await api("/api/servicos", { json: limpo(d) }); ir("servicos"); }));
  return `<h1>Meus serviços</h1><p class="sub">As palavras-chave alimentam a busca de editais. Cadastrar um serviço não comprova capacidade: os atestados comprovam.</p>
  ${formulario("f-serv", [["nome", "Nome", "text", "required"], ["categoria", "Categoria", "select:software,digitalizacao,fornecimento,engenharia,consultoria,infraestrutura,seguranca,dados,ia,treinamento"],
    ["unidade_cobranca", "Unidade de cobrança", "select:UST,ponto_de_funcao,hora,entregavel,mensalidade,pagina,unidade"], ["capacidade_mensal", "Capacidade mensal"],
    ["custo_unitario", "Custo unitário (R$)", "number", "step=0.01"], ["tecnologias", "Tecnologias"], ["profissionais", "Profissionais necessários"],
    ["palavras_chave", "Palavras-chave (vírgula)", "text", "required"], ["palavras_excluir", "Excluir se contiver (vírgula)"], ["restricoes", "Restrições"], ["descricao", "Descrição", "textarea"]], "Cadastrar serviço")}
  ${tabela(s, [["Serviço", "nome"], ["Categoria", "categoria"], ["Unidade", "unidade_cobranca"], ["Palavras-chave", "palavras_chave"], ["Validação", "validacao", selo], ["Atualizado", "atualizado_em", dt]])}`;
};

V.licitacoes = async () => {
  const ops = await api("/api/oportunidades");
  const sel = sessionStorage.getItem("op");
  let det = "";
  if (sel) {
    const o = await api(`/api/oportunidades/${sel}`);
    det = `<div class="cartao" style="margin-top:12px"><h2 style="margin-top:0">#${esc(o.oportunidade.id)} ${esc(o.oportunidade.objeto)}</h2>
    <p class="sub">${esc(o.oportunidade.orgao || "")} · ${esc(o.oportunidade.modalidade || "")} · estimado ${brl(o.oportunidade.valor_estimado)} · sessão ${esc(o.oportunidade.data_abertura || "—")} · ${selo(o.oportunidade.situacao)}
    ${o.oportunidade.link ? ` · <a href="${esc(o.oportunidade.link)}" target="_blank" rel="noopener">fonte oficial</a>` : ""}</p>
    <div class="acoes">${o.oportunidade.fonte === "pncp" ? `<button id="b-baixar">Baixar arquivos do PNCP</button>` : ""}<button id="b-analisar">Analisar edital</button></div>
    ${formulario("f-up", [["arquivo", "Enviar edital/anexo/retificação", "file", "required"], ["tipo", "Tipo (vazio = detectar)", "select:,edital,retificacao,anexo"]], "Enviar arquivo")}
    <h2>Documentos</h2>${tabela(o.documentos, [["#", "id"], ["Título", "titulo"], ["Tipo", "tipo"], ["Pág.", "paginas"], ["Leitura", "leitura", selo], ["Versão", "versao"], ["Sem texto", "paginas_sem_texto"]])}
    <h2>Matriz de conformidade</h2>${tabela(o.matriz, [["Categoria", "categoria"], ["Requisito", "requisito"], ["Origem", "pagina", (v, l) => `doc #${esc(l.documento_id)} p.${esc(v)}`],
      ["Trecho", "trecho", (v) => `<small>${esc((v || "").slice(0, 160))}…</small>`], ["Situação", "situacao", selo], ["Evidência", "evidencia"], ["Pendência", "pendencia"], ["Responsável", "responsavel"], ["Prazo", "prazo"]], "Analise o edital para gerar a matriz.")}
    <h2>Cotações</h2>${tabela(o.cotacoes, [["#", "id"], ["Fornecedor", "fornecedor"], ["Item", "item"], ["Qtd", "quantidade"], ["Unitário", "preco_unitario", brl], ["Validade", "validade"], ["Situação", "situacao", selo],
      ["", "id", (v) => `<div class="acoes"><button class="secundario" data-cot="${esc(v)}" data-ev="fornecedor">Fornecedor confirmou</button><button class="secundario" data-cot="${esc(v)}" data-ev="agentes">Validar (agentes)</button><button class="secundario" data-cot="${esc(v)}" data-ev="administrador">Aprovar comercialmente</button></div>`]])}
    ${formulario("f-cot", [["fornecedor_id", "Fornecedor (#)", "number", "required"], ["item", "Item", "text", "required"], ["quantidade", "Quantidade", "number", "required step=any"], ["preco_unitario", "Preço unitário", "number", "required step=0.01"], ["frete", "Frete", "number", "step=0.01"], ["validade", "Validade", "date", "required"], ["prazo_entrega_dias", "Prazo (dias)", "number"]], "Registrar cotação")}
    <h2>Viabilidade (cálculo determinístico)</h2>
    ${formulario("f-viab", [["indiretos_pct", "Indiretos %", "number", "value=10 step=any"], ["margem_alvo_pct", "Margem alvo %", "number", "value=15 step=any"], ["duracao_meses", "Duração (meses)", "number", "value=12"],
      ["prazo_recebimento_dias", "Prazo de recebimento (dias)", "number", "value=60"], ["preco_proposto", "Preço proposto (opcional)", "number", "step=0.01"], ["outro_custo", "Outro custo R$ (estimativa)", "number", "step=0.01"]], "Calcular nova versão")}
    ${o.analises.map((a) => { const r = JSON.parse(a.resultado); return `<div class="cartao" style="margin:8px 0"><b>Versão ${esc(a.versao)}</b> ${selo(r.recomendacao)} · preço ${brl(r.preco_considerado)} · custo ${brl(r.custo_total)} · tributos ${esc(r.tributos_pct)}% ${r.tributos_provisorio ? "(provisório)" : ""} · margem ${esc(r.margem_pct)}% · capital de giro ${brl(r.capital_giro_necessario)}
      <p class="sub">Código da versão: <code>${esc(a.hash.slice(0, 16))}…</code></p>${r.alertas.length ? `<div class="aviso">${r.alertas.map(esc).join("<br>")}</div>` : ""}
      <button data-solicitar="${esc(a.id)}">Solicitar aprovação para participar</button></div>`; }).join("")}
    <h2>Resultado</h2><div class="acoes">${["vencedora", "perdida", "fracassada", "revogada"].map((r) => `<button class="secundario" data-res="${r}">${r}</button>`).join("")}</div></div>`;
  }
  setTimeout(() => {
    document.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => { sessionStorage.setItem("op", b.dataset.op); ir("licitacoes"); });
    aoEnviar("f-op", async (d) => { const r = await api("/api/oportunidades", { json: limpo(d) }); sessionStorage.setItem("op", r.id); ir("licitacoes"); });
    aoEnviar("f-pncp", async (d, f) => { f.querySelector(".erro").textContent = "Consultando PNCP…"; const r = await api("/api/oportunidades/buscar-pncp", { json: { dias: +d.dias, uf: d.uf || null, aderencia_minima: +d.aderencia } }); alert(`PNCP: ${r.lidos} publicações lidas, ${r.compativeis.length} compatíveis com seus serviços.`); ir("licitacoes"); });
    if (!sel) return;
    $("#b-baixar") && ($("#b-baixar").onclick = async () => { const r = await api(`/api/oportunidades/${sel}/baixar-pncp`, { method: "POST" }); alert(`Tarefa #${r.tarefa_id}: ${r.aviso}`); ir("licitacoes"); });
    $("#b-analisar").onclick = async () => { try { const r = await api(`/api/oportunidades/${sel}/analisar`, { method: "POST" }); alert(`Parecer: ${r.resumo.parecer_habilitacao}. Leitura: ${r.resumo.leitura}`); } catch (e) { alert(e.message); } ir("licitacoes"); };
    aoEnviar("f-up", async (d, f) => { const fd = new FormData(f); fd.append("oportunidade_id", sel); if (!fd.get("tipo")) fd.delete("tipo"); const r = await api("/api/documentos", { method: "POST", body: fd }); alert(`Tipo: ${r.tipo} (${r.confianca}). Leitura: ${r.leitura}. ${r.alertas.join(" ")}${r.pergunta ? " — " + r.pergunta : ""}`); ir("licitacoes"); });
    aoEnviar("f-cot", async (d) => { await api("/api/cotacoes", { json: { ...limpo(d), oportunidade_id: +sel, fornecedor_id: +d.fornecedor_id } }); ir("licitacoes"); });
    aoEnviar("f-viab", async (d) => { const p = { ...limpo(d) }; if (p.outro_custo) p.outros_custos = [{ descricao: "Outro custo informado", valor: p.outro_custo, origem: "estimativa do administrador" }]; delete p.outro_custo; await api(`/api/oportunidades/${sel}/viabilidade`, { json: p }); ir("licitacoes"); });
    document.querySelectorAll("[data-cot]").forEach((b) => b.onclick = async () => { try { await api(`/api/cotacoes/${b.dataset.cot}/marcar`, { json: { evento: b.dataset.ev } }); } catch (e) { alert(e.message); } ir("licitacoes"); });
    document.querySelectorAll("[data-solicitar]").forEach((b) => b.onclick = async () => { const r = await api(`/api/analises/${b.dataset.solicitar}/solicitar-aprovacao`, { method: "POST" }); alert(`Pedido de aprovação #${r.aprovacao_id} criado. Decida em Aprovações.`); });
    document.querySelectorAll("[data-res]").forEach((b) => b.onclick = async () => { const r = await api(`/api/oportunidades/${sel}/resultado`, { json: { resultado: b.dataset.res } }); alert(r.solicitar.length ? "Registrado. Vitória não autoriza execução. Envie: " + r.solicitar.join(", ") : "Registrado."); ir("licitacoes"); });
  });
  return `<h1>Licitações</h1><p class="sub">Busca em fonte oficial (PNCP), leitura de edital com página e cláusula, matriz de conformidade e viabilidade.</p>
  ${formulario("f-pncp", [["dias", "Publicados nos últimos (dias)", "number", "value=3 min=1 max=30"], ["uf", "UF (opcional)", "text", "maxlength=2"], ["aderencia", "Aderência mínima %", "number", "value=30"]], "Buscar no PNCP")}
  ${formulario("f-op", [["objeto", "Objeto", "text", "required"], ["orgao", "Órgão"], ["valor_estimado", "Valor estimado", "number", "step=0.01"], ["data_abertura", "Sessão", "datetime-local"], ["link", "Link"]], "Cadastrar oportunidade manual")}
  ${tabela(ops, [["#", "id"], ["Objeto", "objeto", (v) => esc((v || "").slice(0, 110))], ["Órgão", "orgao"], ["UF", "uf"], ["Estimado", "valor_estimado", brl], ["Sessão", "data_abertura"], ["Aderência", "aderencia", (v) => esc(v) + "%"], ["Situação", "situacao", selo], ["Fonte", "fonte"],
    ["", "id", (v) => `<button class="secundario" data-op="${esc(v)}">Abrir</button>`]], "Nenhuma oportunidade. Busque no PNCP ou cadastre manualmente.")}${det}`;
};

V.documentos = async () => {
  const d = await api("/api/documentos");
  setTimeout(() => {
    aoEnviar("f-doc", async (x, f) => { const fd = new FormData(f); for (const k of ["tipo", "validade"]) if (!fd.get(k)) fd.delete(k); const r = await api("/api/documentos", { method: "POST", body: fd }); alert(`Classificado como ${r.tipo} (${r.confianca}); leitura ${r.leitura}. ${r.alertas.join(" ")}${r.pergunta ? " — " + r.pergunta : ""}`); ir("documentos"); });
    document.querySelectorAll("[data-validar]").forEach((b) => b.onclick = async () => { await api(`/api/documentos/${b.dataset.validar}/validar`, { method: "POST" }); ir("documentos"); });
  });
  return `<h1>Documentos</h1><p class="sub">Para certidões, use o tipo exato (ex.: certidao_fgts) e informe a validade. Documentos são dados — instruções dentro deles são ignoradas.</p>
  ${formulario("f-doc", [["arquivo", "Arquivo (PDF, imagem, planilha, ZIP)", "file", "required"], ["tipo", "Tipo", "select:,certidao_federal,certidao_fgts,certidao_trabalhista,certidao_estadual,certidao_municipal,certidao_falencia,contrato_social,balanco,atestado_capacidade,procuracao,outro"], ["validade", "Validade", "date"]], "Enviar documento")}
  ${tabela(d, [["#", "id"], ["Título", "titulo"], ["Tipo", "tipo"], ["Confiança", "tipo_confianca"], ["Pág.", "paginas"], ["Leitura", "leitura", selo], ["Validade", "validade"], ["Versão", "versao"], ["Vínculo", "oportunidade_id", (v, l) => v ? `licitação #${esc(v)}` : l.contrato_id ? `contrato #${esc(l.contrato_id)}` : "empresa"],
    ["Validação", "validacao", (v, l) => v === "validado" ? selo(v) : `${selo(v)} ${EU.papel === "admin" ? `<button class="secundario" data-validar="${esc(l.id)}">Validar</button>` : ""}`], ["SHA-256", "sha256", (v) => `<code>${esc((v || "").slice(0, 10))}</code>`]])}`;
};

V.propostas = async () => {
  const ops = await api("/api/oportunidades");
  const linhas = [];
  for (const o of ops.slice(0, 30)) { const d = await api(`/api/oportunidades/${o.id}`); for (const a of d.analises) { const r = JSON.parse(a.resultado); linhas.push({ op: o.id, objeto: o.objeto, versao: a.versao, preco: r.preco_considerado, margem: r.margem_pct, rec: r.recomendacao, situacao: o.situacao, hash: a.hash }); } }
  return `<h1>Propostas</h1><p class="sub">Cada versão de cálculo é uma proposta com código próprio. A aprovação vale só para a versão aprovada.</p>
  ${tabela(linhas, [["Licitação", "op"], ["Objeto", "objeto", (v) => esc((v || "").slice(0, 80))], ["Versão", "versao"], ["Preço", "preco", brl], ["Margem %", "margem"], ["Recomendação", "rec", selo], ["Situação", "situacao", selo], ["Código", "hash", (v) => `<code>${esc(v.slice(0, 12))}</code>`]], "Nenhuma proposta calculada.")}`;
};

V.fornecedores = async () => {
  const f = await api("/api/fornecedors");
  setTimeout(() => aoEnviar("f-forn", async (d) => { await api("/api/fornecedors", { json: limpo(d) }); ir("fornecedores"); }));
  return `<h1>Fornecedores</h1><p class="sub">Separação obrigatória: fornecedor confirmou ≠ agentes validaram ≠ você aprovou.</p>
  ${formulario("f-forn", [["nome", "Nome", "text", "required"], ["cnpj", "CNPJ"], ["contato", "Contato"], ["categorias", "Categorias"], ["papel", "Papel", "select:fornecimento,subcontratacao,parceria,revenda,indicacao"]], "Cadastrar fornecedor")}
  ${tabela(f, [["#", "id"], ["Nome", "nome"], ["CNPJ", "cnpj"], ["Papel", "papel"], ["Categorias", "categorias"], ["Situação", "situacao", selo]])}
  <div class="aviso">Portal do fornecedor com acesso próprio: pendente (fase 2). Hoje as cotações são registradas pela sua equipe.</div>`;
};

V.contratos = async () => {
  const cs = await api("/api/contratos");
  const sel = sessionStorage.getItem("ct");
  let det = "";
  if (sel) {
    const c = await api(`/api/contratos/${sel}`);
    det = `<div class="cartao" style="margin-top:12px"><h2 style="margin-top:0">Contrato ${esc(c.contrato.numero)} ${selo(c.contrato.situacao)}</h2>
    <p class="sub">${esc(c.contrato.objeto)} · ${brl(c.contrato.valor_total)} · ${esc(c.contrato.modelo_cobranca)} a ${brl(c.contrato.valor_unidade)}</p>
    ${EU.papel === "admin" ? `<div class="acoes"><button id="b-inicio">Solicitar início da execução</button></div>` : ""}
    ${c.plano.pendente_preencher.length ? `<div class="aviso">Preencha no contrato: ${c.plano.pendente_preencher.map(esc).join(", ")}</div>` : ""}
    <h2>Obrigações mapeadas</h2>${tabela(c.obrigacoes, [["Cláusula", "clausula"], ["Descrição", "descricao"]], "Anexe o contrato para mapear cláusulas.")}
    <h2>Plano de projeto (gerado)</h2><pre>${esc(JSON.stringify(c.plano, null, 2))}</pre>
    <h2>Chamados</h2>${tabela(c.chamados, [["#", "id"], ["Descrição", "descricao"], ["Severidade", "severidade", selo], ["Escopo", "no_escopo", (v) => v ? "no escopo" : selo("fora_do_escopo")]])}</div>`;
  }
  setTimeout(() => {
    document.querySelectorAll("[data-ct]").forEach((b) => b.onclick = () => { sessionStorage.setItem("ct", b.dataset.ct); ir("contratos"); });
    aoEnviar("f-ct", async (d, f) => {
      const fd = new FormData(); const dados = limpo(d); delete dados.arquivo;
      if (dados.regras) { try { dados.regras = JSON.parse(dados.regras); } catch { throw new Error("Regras devem ser JSON válido"); } }
      if (dados.oportunidade_id) dados.oportunidade_id = +dados.oportunidade_id;
      fd.append("dados", JSON.stringify(dados)); const arq = f.querySelector("[name=arquivo]").files[0]; if (arq) fd.append("arquivo", arq);
      const r = await api("/api/contratos", { method: "POST", body: fd }); if (r.divergencias.length) alert("Divergências: " + r.divergencias.join("; ")); sessionStorage.setItem("ct", r.contrato_id); ir("contratos");
    });
    $("#b-inicio") && ($("#b-inicio").onclick = async () => { try { const r = await api(`/api/contratos/${sel}/solicitar-inicio`, { method: "POST" }); alert(`Pedido #${r.aprovacao_id} criado. Aprove em Aprovações; depois a execução é iniciada.`); } catch (e) { alert(e.message); } });
  });
  return `<h1>Contratos</h1><p class="sub">Vencer não autoriza execução: é preciso contrato assinado, ordem de serviço e sua aprovação.</p>
  ${EU.papel === "admin" ? formulario("f-ct", [["numero", "Número", "text", "required"], ["orgao", "Órgão"], ["objeto", "Objeto", "text", "required"], ["valor_total", "Valor total", "number", "required step=0.01"], ["modelo_cobranca", "Modelo", "select:UST,ponto_de_funcao,hora,entregavel,mensalidade,pagina,unidade"], ["valor_unidade", "Valor por unidade", "number", "step=0.01"],
    ["vigencia_inicio", "Início", "date"], ["vigencia_fim", "Fim", "date"], ["ordem_servico", "Ordem de serviço"], ["oportunidade_id", "Licitação de origem (#)", "number"], ["arquivo", "Contrato assinado (PDF)", "file"], ["regras", "Regras (JSON: sistemas, repositorio, severidade_por_palavra, criterios_aceite, regra_medicao, prazo_pagamento_dias)", "textarea"]], "Registrar contrato") : ""}
  ${tabela(cs, [["#", "id"], ["Número", "numero"], ["Objeto", "objeto"], ["Situação", "situacao", selo], ["Valor", "valor_total", brl], ["", "id", (v) => `<button class="secundario" data-ct="${esc(v)}">Abrir</button>`]])}${det}`;
};

V.projetos = async () => {
  const cs = await api("/api/contratos");
  let out = "";
  for (const c of cs) { const d = await api(`/api/contratos/${c.id}`); for (const p of d.projetos) { const pl = JSON.parse(p.plano); out += `<div class="cartao" style="margin:8px 0"><h2 style="margin-top:0">${esc(p.nome)}</h2><p class="sub">${esc(pl.rastreabilidade)}</p>${tabela(pl.eap, [["Código", "codigo"], ["Entrega", "entrega"], ["Responsável", "responsavel"]])}</div>`; } }
  const t = await api("/api/tarefas");
  return `<h1>Projetos</h1>${out || `<p class="sub">Nenhum projeto: inicie a execução de um contrato.</p>`}
  <h2>Tarefas</h2>${tabela(t.filter((x) => x.projeto_id), [["#", "id"], ["Tarefa", "titulo"], ["Executor", "executor_id"], ["Estado", "estado", selo]])}`;
};

V.chamados = async () => {
  const ch = await api("/api/chamados");
  const t = await api("/api/tarefas");
  setTimeout(() => {
    aoEnviar("f-ch", async (d) => { const r = await api("/api/chamados", { json: { texto: d.texto } }); alert(`Chamado #${r.chamado_id}: severidade ${r.severidade}, ${r.no_escopo ? "no escopo" : "FORA do escopo (proposta de mudança criada)"}.${r.faltando.length ? " Faltam: " + r.faltando.join(", ") : ""}`); ir("chamados"); });
    document.querySelectorAll("[data-rev]").forEach((b) => b.onclick = async () => { try { await api(`/api/tarefas/${b.dataset.rev}/revisar`, { json: { aprovado: b.dataset.ok === "1", nota: "revisão pelo painel" } }); } catch (e) { alert(e.message); } ir("chamados"); });
  });
  const doChamado = t.filter((x) => x.chamado_id);
  return `<h1>Chamados e manutenção</h1><p class="sub">Entrada pelo painel, chat e WhatsApp. A severidade segue a regra do contrato.</p>
  ${formulario("f-ch", [["texto", "Descreva o problema (sistema, desde quando, usuários afetados)", "textarea", "required"]], "Abrir chamado")}
  ${tabela(ch, [["#", "id"], ["Canal", "canal"], ["Descrição", "descricao"], ["Severidade", "severidade", selo], ["Escopo", "no_escopo", (v) => v ? "no escopo" : selo("fora_do_escopo")], ["Faltando", "faltando"], ["Aberto", "criado_em", dt]])}
  <h2>Tarefas dos chamados</h2>${tabela(doChamado, [["#", "id"], ["Chamado", "chamado_id"], ["Tarefa", "titulo"], ["Executor", "executor_id"], ["Estado", "estado", selo], ["Erro/bloqueio", "erro", (v) => esc((v || "").slice(0, 160))],
    ["", "id", (v, l) => l.estado === "em_revisao" ? `<div class="acoes"><button class="secundario" data-rev="${esc(v)}" data-ok="1">Aprovar revisão</button><button class="secundario" data-rev="${esc(v)}" data-ok="0">Devolver</button></div>` : ""]])}`;
};

V.codigo = async () => {
  const t = await api("/api/tarefas");
  const ex = [];
  for (const x of t.filter((y) => ["executar_testes", "correcao_codigo"].includes(y.tipo))) {
    const r = x.resultado ? JSON.parse(x.resultado) : {};
    if (r.execucao_id) ex.push({ ...x, exec: r.execucao_id, codigo: r.codigo_saida });
    else if (r.evidencias) ex.push({ ...x, exec: (r.evidencias[0] || "").split(":")[1], codigo: "diff" });
  }
  setTimeout(() => document.querySelectorAll("[data-exec]").forEach((b) => b.onclick = async () => { const e = await api(`/api/execucoes/${b.dataset.exec}`); $("#saida").textContent = `$ ${e.comando}\n(código ${e.codigo_saida}, sha256 ${e.sha256_saida})\n\n${e.saida}`; }));
  return `<h1>Código e pipelines</h1><p class="sub">Execuções reais em sandbox, com saída e hash preservados. Publicação em produção exige aprovação.</p>
  ${tabela(ex, [["Tarefa", "id"], ["Título", "titulo"], ["Executor", "executor_id"], ["Estado", "estado", selo], ["Saída", "codigo"], ["", "exec", (v) => v ? `<button class="secundario" data-exec="${esc(v)}">Ver saída</button>` : ""]], "Nenhuma execução ainda.")}
  <pre id="saida" aria-live="polite">Selecione uma execução.</pre>`;
};

V.entregas = async () => {
  const e = await api("/api/entregas");
  setTimeout(() => document.querySelectorAll("[data-ent]").forEach((b) => b.onclick = async () => { const motivo = b.dataset.ok === "1" ? "" : prompt("Motivo da rejeição:"); await api(`/api/entregas/${b.dataset.ent}/decidir`, { json: { aceita: b.dataset.ok === "1", motivo } }); ir("entregas"); }));
  return `<h1>Entregas e evidências</h1><p class="sub">Realizada ≠ aceita ≠ faturável.</p>
  ${tabela(e, [["#", "id"], ["Contrato", "numero"], ["Entrega", "descricao"], ["Qtd", "quantidade"], ["Unidade", "unidade"], ["Evidências", "evidencias"], ["Situação", "situacao", selo], ["Aceita em", "aceita_em", dt],
    ["", "id", (v, l) => l.situacao === "realizada" && EU.papel === "admin" ? `<div class="acoes"><button class="secundario" data-ent="${esc(v)}" data-ok="1">Registrar aceite</button><button class="secundario" data-ent="${esc(v)}" data-ok="0">Registrar rejeição</button></div>` : ""]])}`;
};

V.medicoes = async () => {
  const m = await api("/api/medicoes");
  const cs = await api("/api/contratos");
  setTimeout(() => {
    aoEnviar("f-med", async (d) => { const r = await api("/api/medicoes", { json: { contrato_id: +d.contrato_id, periodo: d.periodo } }); alert(`Medição: ${r.quantidade} unidades = ${brl(r.valor)}. ${r.alertas.join(" ")}`); ir("medicoes"); });
    document.querySelectorAll("[data-med]").forEach((b) => b.onclick = async () => { const glosa = b.dataset.ok === "1" ? (prompt("Glosa em R$ (0 se nenhuma):", "0") || "0") : "0"; await api(`/api/medicoes/${b.dataset.med}/decidir`, { json: { aceita: b.dataset.ok === "1", glosa } }); ir("medicoes"); });
    document.querySelectorAll("[data-nf]").forEach((b) => b.onclick = async () => { try { const r = await api(`/api/medicoes/${b.dataset.nf}/nota`, { method: "POST" }); alert(r.ja_existia ? "Nota já preparada para esta medição." : `Prévia da nota #${r.nota_id} criada. Aprove em Aprovações.`); } catch (e) { alert(e.message); } ir("notas"); });
  });
  return `<h1>Medições</h1><p class="sub">Só entregas aceitas entram. Unidades diferentes do contrato não são convertidas automaticamente.</p>
  ${formulario("f-med", [["contrato_id", "Contrato", "select:" + cs.map((c) => c.id).join(",")], ["periodo", "Período (AAAA-MM)", "text", "required"]], "Gerar medição")}
  ${tabela(m, [["#", "id"], ["Contrato", "numero"], ["Período", "periodo"], ["Qtd reconhecida", "quantidade_reconhecida"], ["Glosa", "glosa", brl], ["Faturável", "valor_faturavel", brl], ["Situação", "situacao", selo],
    ["", "id", (v, l) => l.situacao === "enviada" ? `<div class="acoes"><button class="secundario" data-med="${esc(v)}" data-ok="1">Cliente aceitou</button><button class="secundario" data-med="${esc(v)}" data-ok="0">Cliente rejeitou</button></div>` : ["aceita", "glosada_parcial"].includes(l.situacao) ? `<button class="secundario" data-nf="${esc(v)}">Preparar nota</button>` : ""]])}`;
};

V.financeiro = async () => {
  const f = await api("/api/financeiro");
  setTimeout(() => {
    aoEnviar("f-perg", async (d) => { const r = await api("/api/financeiro/perguntar", { json: d }); $("#resp").textContent = r.resposta; });
    aoEnviar("f-lanc", async (d) => { await api("/api/lancamentos", { json: { ...limpo(d), contrato_id: d.contrato_id ? +d.contrato_id : null } }); ir("financeiro"); });
    document.querySelectorAll("[data-liq]").forEach((b) => b.onclick = async () => { await api(`/api/lancamentos/${b.dataset.liq}/liquidar`, { method: "POST" }); ir("financeiro"); });
  });
  const col = [["Vencimento", "vencimento"], ["Tipo", "tipo"], ["Descrição", "descricao"], ["Contrato", "contrato_numero"], ["Valor", "valor", brl], ["Situação", "situacao", selo], ["Categoria", "categoria"], ["Próxima ação", "proxima_acao"], ["Responsável", "responsavel"],
    ["", "id", (v, l) => l.situacao === "aberto" ? `<button class="secundario" data-liq="${esc(v)}">${l.tipo === "receber" ? "Recebido" : "Pago"}</button>` : ""]];
  const t = f.totais;
  return `<h1>Financeiro</h1><p class="sub">${esc(f.observacao)}</p>
  <div class="grade">${[["Contratada", t.receita_contratada], ["Faturada", t.receita_faturada], ["Só em simulação", t.faturado_apenas_em_simulacao], ["Recebida", t.receita_recebida], ["A receber", t.a_receber], ["A pagar", t.a_pagar], ["Reservar p/ fornecedores", t.reserva_fornecedores], ["Reservar p/ tributos", t.reserva_tributos]].map(([r, v]) => `<div class="cartao kpi"><div class="r">${esc(r)}</div><div class="v">${brl(v)}</div></div>`).join("")}</div>
  ${formulario("f-perg", [["pergunta", "Pergunte (ex.: O que vence esta semana?)", "text", "required"]], "Perguntar")}<pre id="resp"></pre>
  <h2>A pagar hoje</h2>${tabela(f.a_pagar_hoje, col)}<h2>Vencidos</h2>${tabela(f.vencidos, col)}<h2>A vencer (7 dias)</h2>${tabela(f.a_vencer_7d, col)}
  <h2>A receber</h2>${tabela(f.a_receber, col)}<h2>Recebimentos atrasados</h2>${tabela(f.recebimentos_atrasados, col)}
  <h2>Executado e ainda não medido</h2>${tabela(f.executado_nao_medido, [["#", "id"], ["Entrega", "descricao"], ["Qtd", "quantidade"], ["Situação", "situacao", selo]])}
  <h2>Medições aguardando aceite</h2>${tabela(f.medicoes_aguardando_aceite, [["#", "id"], ["Contrato", "numero"], ["Valor", "valor_faturavel", brl]])}
  <h2>Novo lançamento</h2>${formulario("f-lanc", [["tipo", "Tipo", "select:pagar,receber"], ["categoria", "Categoria", "select:fornecedor,tributo,folha,comissao,custo_fixo,garantia,outro"], ["descricao", "Descrição", "text", "required"], ["valor", "Valor", "number", "required step=0.01"], ["vencimento", "Vencimento", "date", "required"], ["contrato_id", "Contrato (#)", "number"], ["responsavel", "Responsável"], ["proxima_acao", "Próxima ação"]], "Lançar")}`;
};

V.notas = async () => {
  const n = await api("/api/notas");
  const ap = await api("/api/aprovacoes");
  setTimeout(() => document.querySelectorAll("[data-emit]").forEach((b) => b.onclick = async () => { try { const r = await api(`/api/notas/${b.dataset.emit}/emitir`, { json: { aprovacao_id: +b.dataset.ap } }); alert(`Resultado: ${r.situacao}${r.erro ? " — " + r.erro : ""}`); } catch (e) { alert(e.message); } ir("notas"); }));
  const apNota = (id) => ap.find((a) => a.objeto_tipo === "nota_fiscal" && a.objeto_id === id);
  return `<h1>Notas fiscais</h1><p class="sub">“Emitida” só com retorno oficial do emissor autorizado. Simulador local aparece como “emitida simulação”, sem valor fiscal.</p>
  ${tabela(n, [["#", "id"], ["Contrato", "numero"], ["Medição", "medicao_id"], ["Valor", "valor", brl], ["Situação", "situacao", selo], ["Número", "numero_oficial"], ["Retorno", "retorno", (v) => `<small>${esc((v || "").slice(0, 120))}</small>`],
    ["", "id", (v, l) => { const a = apNota(v); return ["previa", "aguardando_integracao", "rejeitada"].includes(l.situacao) && a ? `<button class="secundario" data-emit="${esc(v)}" data-ap="${esc(a.id)}">Transmitir (aprovação #${esc(a.id)}: ${esc(a.situacao)})</button>` : ""; }]], "Nenhuma nota.")}`;
};

V.aprovacoes = async () => {
  const a = await api("/api/aprovacoes");
  setTimeout(() => document.querySelectorAll("[data-dec]").forEach((b) => b.onclick = async () => {
    const ap = a.find((x) => x.id === +b.dataset.dec);
    if (b.dataset.d === "aprovar") {
      const cod = prompt(`Para aprovar, digite os 6 primeiros caracteres do código da versão (${ap.hash.slice(0, 6)}):`);
      if (!cod || cod !== ap.hash.slice(0, 6)) { alert("Código não confere. Nada foi aprovado."); return; }
    }
    try { await api(`/api/aprovacoes/${ap.id}/decidir`, { json: { decisao: b.dataset.d, hash: ap.hash, justificativa: "decisão pelo painel" } }); } catch (e) { alert(e.message); }
    ir("aprovacoes");
  }));
  return `<h1>Aprovações</h1><p class="sub">Cada aprovação vale para uma ação, um objeto e uma versão exata, com validade. Se o conteúdo mudar, expira.</p>
  ${tabela(a, [["#", "id"], ["Ação", "acao", selo], ["Objeto", "objeto_tipo", (v, l) => `${esc(v)} #${esc(l.objeto_id)} v${esc(l.versao)}`], ["Resumo", "resumo"], ["Valor", "valor", brl], ["Solicitante", "solicitante"], ["Situação", "situacao", selo], ["Validade", "validade", dt], ["Código", "hash", (v) => `<code>${esc(v.slice(0, 12))}</code>`],
    ["", "id", (v, l) => l.situacao === "pendente" ? `<div class="acoes"><button data-dec="${esc(v)}" data-d="aprovar">Aprovar</button><button class="secundario" data-dec="${esc(v)}" data-d="rejeitar">Rejeitar</button></div>` : (l.consumido_em ? "usada" : "")]])}`;
};

V.relatorios = async () => {
  const r = await api("/api/relatorios");
  setTimeout(() => { $("#b-rel").onclick = async () => { await api("/api/relatorios/diario", { method: "POST" }); ir("relatorios"); }; $("#b-link-rel").onclick = async () => { const l = await api("/api/links", { json: { tipo: "relatorio", horas: 24 } }); prompt("Link seguro (24h, somente leitura):", l.url); }; });
  return `<h1>Relatórios</h1><div class="acoes"><button id="b-rel">Gerar relatório diário agora</button><button class="secundario" id="b-link-rel">Link seguro do último relatório</button></div>
  ${r.map((x) => `<div class="cartao" style="margin:10px 0"><h2 style="margin-top:0">Relatório #${esc(x.id)} — ${esc(x.data)}</h2><pre>${esc(JSON.stringify(JSON.parse(x.conteudo), null, 2))}</pre></div>`).join("") || `<p class="sub">Nenhum relatório.</p>`}`;
};

V.noticias = async () => `<h1>Notícias e atualizações</h1><div class="aviso">Pendente (fase 4): monitoramento de fontes ainda não implementado. Nenhuma notícia é exibida para não apresentar conteúdo não verificado.</div>
  <p class="sub">Planejado: fontes oficiais (PNCP, DOU, Receita, prefeituras), com fonte, link, data, resumo, impacto e separação entre fato, interpretação e hipótese. Mudanças normativas nunca alteram cálculo fiscal sem revisão.</p>`;

V.integracoes = async () => {
  const i = await api("/api/integracoes");
  return `<h1>Integrações</h1><p class="sub">Situação real de cada integração. “Não configurado” significa que nada é enviado por ela.</p>${tabela(i, [["Integração", "nome"], ["Situação", "situacao", selo], ["Detalhe", "detalhe"], ["Verificado", "verificado_em", dt]])}`;
};

V.seguranca = async () => {
  const v = await api("/api/auditoria/verificar");
  const ev = (await api("/api/eventos?limite=300")).filter((e) => e.tipo.startsWith("seguranca."));
  setTimeout(() => {
    aoEnviar("f-link", async (d) => { const l = await api("/api/links", { json: { tipo: d.tipo, ref: d.ref, horas: +d.horas } }); $("#link").textContent = `${l.url}\nválido até ${l.expira_em}`; });
    $("#b-exp").onclick = async () => { const d = await api("/api/exportar"); const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "escritorio-exportacao.json"; a.click(); };
  });
  return `<h1>Segurança</h1>
  <div class="cartao"><b>Cadeia de auditoria:</b> ${v.integra ? selo("ok") + ` íntegra — ${esc(v.verificados)} eventos verificados (SHA-256 encadeado; alteração e exclusão bloqueadas no banco)` : selo("falhou") + ` corrompida no evento #${esc(v.evento_corrompido)}`}</div>
  <h2>Links seguros</h2><p class="sub">Assinados, com validade (máx. 72h) e somente leitura.</p>
  ${formulario("f-link", [["tipo", "Tipo", "select:escritorio,evidencias_contrato,relatorio"], ["ref", "Contrato (# para evidências)"], ["horas", "Validade (horas)", "number", "value=24 max=72"]], "Gerar link")}<pre id="link"></pre>
  <h2>Exportar meus dados</h2><button id="b-exp" class="secundario">Baixar exportação completa (JSON)</button>
  <h2>Eventos de segurança</h2>${tabela(ev, [["Quando", "criado_em", dt], ["Tipo", "tipo"], ["Resumo", "resumo"]], "Nenhum evento de segurança.")}`;
};

V.configuracoes = async () => {
  const eu = await api("/api/eu");
  const f = await api("/api/funcionarios");
  const t = await api("/api/tributo_regras");
  setTimeout(() => {
    aoEnviar("f-emp", async (d) => { await api("/api/empresa", { method: "PUT", json: limpo(d) }); ir("configuracoes"); });
    aoEnviar("f-func", async (d) => { await api("/api/funcionarios", { json: { ...limpo(d), horas_mes: +(d.horas_mes || 160) } }); ir("configuracoes"); });
    aoEnviar("f-trib", async (d) => { await api("/api/tributo_regras", { json: { ...limpo(d), validado_contador: d.validado_contador === "sim" ? 1 : 0, retido: d.retido === "sim" ? 1 : 0 } }); ir("configuracoes"); });
  });
  const e = eu.empresa;
  return `<h1>Configurações</h1>
  <h2>Empresa</h2><p class="sub">${esc(e.razao_social)} · CNPJ ${esc(e.cnpj)} · fuso ${esc(e.fuso)} · atualizado ${dt(e.atualizado_em)} · ${selo(e.validacao)}</p>
  ${formulario("f-emp", [["nome_fantasia", "Nome fantasia"], ["regime_tributario", "Regime tributário", "select:,simples_nacional,lucro_presumido,lucro_real"], ["margem_minima_pct", "Margem mínima %", "number", `step=any value="${esc(e.margem_minima_pct)}"`], ["capital_giro_disponivel", "Capital de giro disponível", "number", `step=0.01 value="${esc(e.capital_giro_disponivel)}"`], ["regioes", "Regiões atendidas"], ["cnaes", "CNAEs"], ["hora_relatorio", "Horário do relatório diário", "time", `value="${esc(e.hora_relatorio)}"`]], "Salvar")}
  <h2>Equipe humana</h2>${formulario("f-func", [["nome", "Nome", "text", "required"], ["funcao", "Função", "text", "required"], ["qualificacoes", "Qualificações"], ["registro_profissional", "Registro profissional (CREA, CRC…)"], ["custo_hora", "Custo/hora", "number", "step=0.01"], ["horas_mes", "Horas/mês", "number", "value=160"]], "Cadastrar pessoa")}
  ${tabela(f, [["Nome", "nome"], ["Função", "funcao"], ["Registro", "registro_profissional"], ["Custo/h", "custo_hora", brl], ["Horas/mês", "horas_mes"]])}
  <h2>Regras tributárias</h2><div class="aviso">Não existe alíquota universal. Cadastre as regras do seu regime com fonte; sem validação do contador, todo cálculo aparece como provisório.</div>
  ${formulario("f-trib", [["nome", "Tributo", "text", "required"], ["aliquota_pct", "Alíquota %", "number", "required step=any"], ["aplica_categoria", "Categoria (vazio = todas)", "select:,servico,produto"], ["municipio", "Município"], ["retido", "Retido na fonte?", "select:nao,sim"], ["vigencia_inicio", "Vigência início", "date", "required"], ["vigencia_fim", "Vigência fim", "date"], ["fonte", "Fonte (lei/parecer)", "text", "required"], ["validado_contador", "Validado pelo contador?", "select:nao,sim"]], "Cadastrar regra")}
  ${tabela(t, [["Tributo", "nome"], ["Alíquota %", "aliquota_pct"], ["Categoria", "aplica_categoria"], ["Retido", "retido", (v) => v ? "sim" : "não"], ["Vigência", "vigencia_inicio", (v, l) => `${esc(v)} → ${esc(l.vigencia_fim || "…")}`], ["Fonte", "fonte"], ["Contador", "validado_contador", (v) => v ? selo("ok") : selo("pendente")]])}`;
};

// ------------------------------------------------------------------ navegação, sessão, tempo real
async function ir(mod) {
  if (!V[mod]) mod = "executiva";
  location.hash = mod;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.mod === mod) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const m = $("#conteudo");
  m.innerHTML = `<p class="sub">Carregando…</p>`;
  feedFn = null;
  try { m.innerHTML = await V[mod](); } catch (e) { m.innerHTML = `<h1>Não foi possível carregar</h1><p class="erro">${esc(e.message)}</p>`; }
  document.querySelectorAll("[data-conv]").forEach((b) => b.onclick = () => { sessionStorage.setItem("chat", "agente:" + b.dataset.conv); ir("chats"); });
  m.focus({ preventScroll: true });
  $("#nav").classList.remove("aberto");
}

function conectarEventos() {
  const es = new EventSource("/api/eventos/stream");
  const ind = $("#ao-vivo");
  es.onopen = () => { ind.textContent = "● ao vivo"; ind.classList.add("on"); };
  es.onerror = () => { ind.textContent = "● reconectando"; ind.classList.remove("on"); };
  es.addEventListener("evento", (e) => {
    const d = JSON.parse(e.data);
    if (feedFn) feedFn(d);
    if (location.hash === "#escritorio" && /tarefa\.estado|ferramenta/.test(d.tipo)) { clearTimeout(conectarEventos.t); conectarEventos.t = setTimeout(() => ir("escritorio"), 1500); }
  });
}

function mostrarLogin() { $("#app").hidden = true; $("#login").hidden = false; }

async function iniciar() {
  try {
    const eu = await api("/api/eu");
    EU = eu.usuario;
  } catch { mostrarLogin(); return; }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#empresa-nome").textContent = EU && (await api("/api/eu")).empresa.nome_fantasia || "Escritório Digital";
  $("#usuario-nome").textContent = `${EU.nome} (${EU.papel})`;
  $("#nav").innerHTML = MODULOS.map(([id, n]) => `<a href="#${id}" data-mod="${id}">${esc(n)}</a>`).join("");
  document.querySelectorAll(".nav a").forEach((a) => a.onclick = (e) => { e.preventDefault(); ir(a.dataset.mod); });
  conectarEventos();
  ir(location.hash.slice(1) || "executiva");
}

document.addEventListener("DOMContentLoaded", () => {
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { await api("/api/login", { json: d }); iniciar(); } catch (ex) { $("#erro-login").textContent = ex.message; }
  });
  $("#sair").onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };
  $("#menu-btn").onclick = () => { const n = $("#nav"); n.classList.toggle("aberto"); $("#menu-btn").setAttribute("aria-expanded", n.classList.contains("aberto")); };
  iniciar();
});
