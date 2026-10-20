/* ===========================================================
   painel.js — tela do Painel V4 (licitações, fábrica, comercial,
   WhatsApp, financeiro e UST). Fala com /api/painel/* do escritório.
   =========================================================== */
(() => {
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfmt = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const dataBR = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const main = $('#conteudo');
// aberto dentro do monitor de um agente no escritório: sem logo nem botão de voltar
if (new URLSearchParams(location.search).has('embutido')) document.documentElement.classList.add('embutido');
let timers = [];
const limparTimers = () => { timers.forEach(clearInterval); timers = []; };
const lembrar = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('v4p-' + k) || 'null'); localStorage.setItem('v4p-' + k, JSON.stringify(v)); } catch (e) { return null; } };

/* ---------- API ---------- */
/* Sem servidor do escritório (link do celular, arquivo aberto direto), o
   painel vira DEMONSTRAÇÃO: mesmas telas, dados de exemplo neste navegador. */
let DEMO = false;
function ligarDemo() {
  if (DEMO || !window.PAINEL_DEMO) return;
  DEMO = true;
  const f = document.createElement('div');
  f.className = 'faixa-demo';
  f.innerHTML = '<b>Demonstração</b> · dados de exemplo. Os dados reais aparecem no computador onde o escritório está ligado. ' +
    '<button class="btn peq" id="demo-como">Como ligar</button> <button class="btn peq" id="demo-zerar">Recomeçar</button>';
  document.querySelector('.topo').after(f);
  f.querySelector('#demo-zerar').addEventListener('click', () => { window.PAINEL_DEMO.reiniciar(); ir(location.hash.slice(1) || 'inicio'); });
  f.querySelector('#demo-como').addEventListener('click', () => modal(`<h2 style="margin-top:0">Como ligar o escritório de verdade</h2>
    <p class="dica">Este link é só uma demonstração. O escritório real roda no seu computador (Windows), porque usa a IA e cria os sistemas na sua máquina.</p>
    <ol style="line-height:1.7;padding-left:20px">
      <li>No computador, instale o Node.js (versão LTS) em <a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a>.</li>
      <li>Baixe o código: <a href="https://github.com/fabricagovv-byte/database/archive/refs/heads/claude/v4-virtual-office-design-pgfeip.zip" target="_blank" rel="noopener">arquivo .zip do escritório</a>.</li>
      <li>Descompacte e abra a pasta <b>v4-escritorio</b>.</li>
      <li>Dê dois cliques em <b>INICIAR ESCRITORIO.cmd</b> e deixe a janela preta aberta.</li>
      <li>No navegador <b>desse mesmo computador</b>, abra <b>localhost:4321</b>.</li>
    </ol>
    <p class="dica">"localhost" quer dizer "este computador": por isso o endereço não abre no celular.</p>`));
}
async function api(metodo, url, corpo) {
  if (DEMO) return window.PAINEL_DEMO.chamar(metodo, url, corpo);
  let r;
  try {
    r = await fetch('/api/painel' + url, { method: metodo, headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
                                           body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  } catch (e) {
    if (window.PAINEL_DEMO) { ligarDemo(); return api(metodo, url, corpo); }
    throw new Error('O servidor do escritório não respondeu. Ele está ligado? (npm start)');
  }
  const tipo = r.headers.get('content-type') || '';
  // quem responde sem JSON não é o escritório (hospedagem estática): demonstração
  if (!/json/.test(tipo)) {
    if (window.PAINEL_DEMO) { ligarDemo(); return api(metodo, url, corpo); }
    throw new Error('O servidor do escritório não respondeu (' + r.status + '). Ele está ligado? (npm start)');
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.motivo) || ('erro ' + r.status));
  return j;
}
/** acompanha uma tarefa em segundo plano até terminar */
async function acompanhar(t, aoProgresso) {
  for (;;) {
    await new Promise(r => setTimeout(r, 900));
    const x = await api('GET', '/tarefas/' + t.tarefa);
    if (aoProgresso && x.progresso) aoProgresso(x.progresso);
    if (x.status === 'ok') return x.resultado;
    if (x.status === 'erro') throw new Error(x.erro);
  }
}
function aviso(msg, ms = 3800) {
  const a = $('#aviso'); a.textContent = msg; a.hidden = false;
  clearTimeout(aviso._t); aviso._t = setTimeout(() => { a.hidden = true; }, ms);
}
function modal(html) { $('#modal-corpo').innerHTML = html; $('#modal').hidden = false; }
const fecharModal = () => { $('#modal').hidden = true; $('#modal-corpo').innerHTML = ''; };
$('#modal-x').addEventListener('click', fecharModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });
const erroNaTela = e => { main.innerHTML = `<div class="vazio"><b>${esc(e.message)}</b><br>O painel precisa do servidor do escritório rodando nesta máquina: <code>npm start</code> na pasta v4-escritorio e abra http://localhost:4321/painel.html</div>`; };
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); aviso('Copiado.'); } catch (e) { aviso('Não deu para copiar automaticamente — selecione o texto.'); }
}
function baixar(url) { if (DEMO) return aviso('Na demonstração não há arquivo para baixar: os relatórios e o código saem do escritório no PC.', 5000); const a = document.createElement('a'); a.href = '/api/painel' + url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }

/* markdown mínimo: títulos, listas, tabelas, negrito, código, citação */
function md(t) {
  const linhas = String(t || '').split('\n'); const out = []; let i = 0;
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^\s*\|/.test(l) && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1])) {
      const cel = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const cab = cel(l); i += 2; const corpo = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo.push(cel(linhas[i++]));
      out.push('<table><thead><tr>' + cab.map(c => '<th>' + inl(c) + '</th>').join('') + '</tr></thead><tbody>' +
        corpo.map(r => '<tr>' + r.map(c => '<td>' + inl(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^```/.test(l)) { const b = []; i++; while (i < linhas.length && !/^```/.test(linhas[i])) b.push(linhas[i++]); i++; out.push('<pre class="codigo">' + esc(b.join('\n')) + '</pre>'); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/); if (h) { out.push(`<h${h[1].length}>${inl(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const b = []; while (i < linhas.length && /^\s*[-*]\s+/.test(linhas[i])) b.push('<li>' + inl(linhas[i++].replace(/^\s*[-*]\s+/, '')) + '</li>'); out.push('<ul>' + b.join('') + '</ul>'); continue; }
    if (/^\s*\d+\.\s+/.test(l)) { const b = []; while (i < linhas.length && /^\s*\d+\.\s+/.test(linhas[i])) b.push('<li>' + inl(linhas[i++].replace(/^\s*\d+\.\s+/, '')) + '</li>'); out.push('<ol>' + b.join('') + '</ol>'); continue; }
    if (/^>\s?/.test(l)) { out.push('<blockquote>' + inl(l.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
    if (l.trim()) out.push('<p>' + inl(l) + '</p>');
    i++;
  }
  return '<div class="md">' + out.join('') + '</div>';
}
const notaCls = n => n >= 60 ? 'a' : n >= 35 ? 'm' : 'b';
const seloStatus = s => {
  const c = { ganhamos: 'ok', 'vamos disputar': 'azul', 'proposta enviada': 'azul', 'em análise': 'alerta', perdemos: 'ruim', descartada: 'ruim',
              pronto: 'ok', gerando: 'azul', ajustando: 'azul', 'na fila': 'alerta', erro: 'ruim', cancelado: 'ruim', interrompido: 'alerta',
              cliente: 'ok', 'em negociação': 'azul', contatado: 'alerta', 'sem interesse': 'ruim', entregue: 'ok', 'em execução': 'azul', backlog: 'alerta' }[s] || '';
  return `<span class="selo ${c}">${esc(s || '—')}</span>`;
};

/* ===========================================================
   INÍCIO
   =========================================================== */
async function inicio() {
  const r = await api('GET', '/resumo');
  const lic = r.licitacoes;
  main.innerHTML = `
    <h1>Painel da V4 fábricagov</h1>
    <p class="sub">Licitações, fábrica de software, comercial, WhatsApp, financeiro e UST num lugar só. Tudo roda nesta máquina; as buscas vão direto às fontes oficiais.</p>
    <div class="grade g4">
      <div class="tile lic"><span>Carteira de licitações</span><b>${lic.carteira}</b><div class="dica">${lic.ultimaBusca ? 'última busca: ' + lic.ultimaBusca.total + ' editais · ' + dataBR(lic.ultimaBusca.quando) : 'nenhuma busca ainda'}</div></div>
      <div class="tile dev"><span>Sistemas na fábrica</span><b>${r.fabrica.total}</b><div class="dica">${Object.entries(r.fabrica.porStatus).map(([k, v]) => v + ' ' + k).join(' · ') || 'nenhum pedido ainda'}</div></div>
      <div class="tile com"><span>Contatos de órgãos</span><b>${r.comercial.total}</b><div class="dica">${r.comercial.comEmail} com e-mail institucional</div></div>
      <div class="tile fin"><span>Saldo atual</span><b class="num">${brl(r.financeiro.saldo)}</b><div class="dica">projetado ${brl(r.financeiro.saldoProjetado)}</div></div>
      <div class="tile ust"><span>Teto de UST</span><b class="num">${nfmt(r.ust.teto)}</b><div class="dica">${r.ust.contratos} contrato(s) · ${nfmt(r.fabrica.ust)} UST entregues pela fábrica</div></div>
      <div class="tile"><span>WhatsApp</span><b>${r.whatsapp.ativo && r.whatsapp.pronto ? 'ligado' : 'desligado'}</b><div class="dica">${r.whatsapp.pronto ? r.whatsapp.autorizados.length + ' número(s) autorizado(s)' : 'falta configurar'}</div></div>
    </div>
    <h2>Licitações com prazo correndo</h2>
    ${lic.proximas.length ? '<div class="pilha">' + lic.proximas.map(l => `<div class="cartao linha entre"><div style="min-width:0;flex:1"><b>${esc(l.orgao)}</b> <span class="dica">${esc(l.municipio || '')}/${esc(l.uf)}</span><div class="dica">${esc(l.objeto.slice(0, 160))}</div></div><div class="linha">${seloStatus(l.status)}<span class="selo ${l.dias <= 3 ? 'ruim' : l.dias <= 7 ? 'alerta' : ''}">${l.dias} dia(s)</span></div></div>`).join('') + '</div>'
      : '<div class="vazio">Nenhuma licitação marcada como "em análise", "vamos disputar" ou "proposta enviada" com prazo aberto.</div>'}
    <h2>Atalhos</h2>
    <div class="linha">
      <button class="btn pri" data-ir="licitacoes">🔎 Buscar licitações</button>
      <button class="btn" data-ir="fabrica">🏭 Pedir um sistema</button>
      <button class="btn" data-ir="ust">📐 Distribuir UST</button>
      <button class="btn" data-ir="financeiro">💰 Lançar finanças</button>
    </div>`;
  $$('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)));
}

/* ===========================================================
   LICITAÇÕES
   =========================================================== */
let META = null;
const FILTROS_PADRAO = { modo: 'abertas', diasAFrente: 45, dias: 7, modalidades: [6, 4, 8], ufs: [], esferas: [], valorMin: '', valorMax: '', notaMin: 30, palavras: '', excluir: '', municipio: '', prazoMin: 2, maxPaginas: 6 };
let subLic = lembrar('subLic') || 'busca';

async function licitacoes() {
  META = META || await api('GET', '/licitacoes/meta');
  main.innerHTML = `
    <h1>Licitações</h1>
    <p class="sub">Busca direta no PNCP (Portal Nacional de Contratações Públicas), com nota de aderência ao que a V4 vende. Salve na carteira, mande analisar e, se valer, peça um protótipo à fábrica.</p>
    <div class="linha" style="margin-bottom:14px">
      <button class="btn ${subLic === 'busca' ? 'pri' : ''}" data-sub="busca">🔎 Buscar</button>
      <button class="btn ${subLic === 'carteira' ? 'pri' : ''}" data-sub="carteira">⭐ Carteira</button>
      <button class="btn ${subLic === 'radar' ? 'pri' : ''}" data-sub="radar">📡 Radar diário e perfil</button>
    </div>
    <div id="lic-corpo"></div>`;
  $$('[data-sub]').forEach(b => b.addEventListener('click', () => { subLic = b.dataset.sub; lembrar('subLic', subLic); licitacoes(); }));
  if (subLic === 'carteira') return carteira();
  if (subLic === 'radar') return radarPerfil();
  return busca();
}

function formFiltros(f, alvo) {
  alvo.innerHTML = `
    <div class="cartao pilha">
      <div class="grade g4">
        <label class="campo">O que buscar
          <select id="f-modo"><option value="abertas">Recebendo propostas agora</option><option value="publicadas">Publicadas nos últimos dias</option></select></label>
        <label class="campo" id="f-janela-l">Prazo até (dias à frente)<input type="number" id="f-janela" min="1" max="365"></label>
        <label class="campo">Nota mínima de aderência<input type="number" id="f-nota" min="0" max="100"></label>
        <label class="campo">Mínimo de dias para o prazo<input type="number" id="f-prazo" min="0" max="120"></label>
        <label class="campo">Valor mínimo (R$)<input type="number" id="f-vmin" min="0" step="1000"></label>
        <label class="campo">Valor máximo (R$)<input type="number" id="f-vmax" min="0" step="1000"></label>
        <label class="campo">Município contém<input type="text" id="f-mun" placeholder="ex.: Uberaba"></label>
        <label class="campo">Páginas por consulta (50 cada)<input type="number" id="f-pag" min="1" max="20"></label>
      </div>
      <label class="campo">Palavras obrigatórias (separe por vírgula — vazio usa o perfil da V4)<input type="text" id="f-pal" placeholder="ex.: sistema de saúde, prontuário eletrônico"></label>
      <label class="campo">Excluir quem tiver no objeto<input type="text" id="f-exc" placeholder="ex.: locação, impressora"></label>
      <div><div class="dica" style="margin-bottom:6px">Modalidades</div><div class="checks" id="f-mods">${Object.entries(META.modalidades).map(([k, v]) =>
        `<label><input type="checkbox" value="${k}"> ${esc(v)}</label>`).join('')}</div></div>
      <div><div class="dica" style="margin-bottom:6px">Estados (nenhum marcado = Brasil todo; cada estado é uma consulta)</div><div class="checks" id="f-ufs">${UFS.map(u =>
        `<label><input type="checkbox" value="${u}"> ${u}</label>`).join('')}</div></div>
      <div><div class="dica" style="margin-bottom:6px">Esfera</div><div class="checks" id="f-esf">${META.esferas.map(e => `<label><input type="checkbox" value="${e}"> ${e}</label>`).join('')}</div></div>
    </div>`;
  $('#f-modo').value = f.modo; $('#f-nota').value = f.notaMin; $('#f-prazo').value = f.prazoMin; $('#f-vmin').value = f.valorMin;
  $('#f-vmax').value = f.valorMax; $('#f-mun').value = f.municipio; $('#f-pag').value = f.maxPaginas; $('#f-pal').value = f.palavras; $('#f-exc').value = f.excluir;
  const janela = () => { const ab = $('#f-modo').value === 'abertas'; $('#f-janela-l').firstChild.textContent = ab ? 'Prazo até (dias à frente)' : 'Publicadas nos últimos (dias)'; $('#f-janela').value = ab ? f.diasAFrente : f.dias; };
  janela(); $('#f-modo').addEventListener('change', janela);
  $$('#f-mods input').forEach(i => { i.checked = f.modalidades.map(String).includes(i.value); });
  $$('#f-ufs input').forEach(i => { i.checked = f.ufs.includes(i.value); });
  $$('#f-esf input').forEach(i => { i.checked = f.esferas.includes(i.value); });
}
function lerFiltros() {
  const modo = $('#f-modo').value, jan = Number($('#f-janela').value) || 7;
  return { modo, diasAFrente: modo === 'abertas' ? jan : (lembrar('filtros') || FILTROS_PADRAO).diasAFrente, dias: modo === 'publicadas' ? jan : (lembrar('filtros') || FILTROS_PADRAO).dias,
    modalidades: $$('#f-mods input:checked').map(i => Number(i.value)), ufs: $$('#f-ufs input:checked').map(i => i.value),
    esferas: $$('#f-esf input:checked').map(i => i.value), valorMin: $('#f-vmin').value, valorMax: $('#f-vmax').value,
    notaMin: Number($('#f-nota').value) || 0, prazoMin: $('#f-prazo').value, municipio: $('#f-mun').value.trim(),
    palavras: $('#f-pal').value.trim(), excluir: $('#f-exc').value.trim(), maxPaginas: Number($('#f-pag').value) || 6 };
}

async function busca() {
  const c = $('#lic-corpo');
  c.innerHTML = `<div id="filtros"></div>
    <div class="linha" style="margin:12px 0"><button class="btn pri" id="buscar">🔎 Buscar no PNCP</button>
      <button class="btn" id="limpar">Limpar filtros</button>
      <button class="btn" id="exp-ult">⬇ Exportar resultado (.csv)</button></div>
    <div id="prog"></div><div id="resultado" class="pilha"></div>`;
  formFiltros(Object.assign({}, FILTROS_PADRAO, lembrar('filtros') || {}), $('#filtros'));
  $('#limpar').addEventListener('click', () => { lembrar('filtros', FILTROS_PADRAO); busca(); });
  $('#exp-ult').addEventListener('click', () => baixar('/licitacoes/exportar.csv?fonte=ultima'));
  $('#buscar').addEventListener('click', async () => {
    const f = lerFiltros(); lembrar('filtros', f);
    if (!f.modalidades.length) return aviso('Marque pelo menos uma modalidade.');
    const b = $('#buscar'); b.disabled = true;
    $('#prog').innerHTML = '<div class="progresso">Consultando o PNCP… (cada estado e modalidade é uma consulta; pode levar alguns minutos)</div>';
    try {
      const r = await acompanhar(await api('POST', '/licitacoes/buscar', f));
      $('#prog').innerHTML = r.aviso ? `<div class="progresso">${r.total} edital(is) de exemplo passaram nos filtros.\n${esc(r.aviso)}</div>` : `<div class="progresso">${r.total} edital(is) passaram nos filtros, de ${r.bruto} encontrados em ${r.consultas} consulta(s).${r.erros.length ? '\n⚠ ' + r.erros.length + ' consulta(s) falharam: ' + esc(r.erros.slice(0, 3).join(' | ')) : ''}</div>`;
      mostrarResultado();
    } catch (e) { $('#prog').innerHTML = '<div class="progresso">❌ ' + esc(e.message) + '</div>'; }
    b.disabled = false;
  });
  mostrarResultado();
}

function cartaoLic(l, naCarteira) {
  const prazo = l.dias == null ? '' : l.dias < 0 ? '<span class="selo ruim">prazo encerrado</span>' : `<span class="selo ${l.dias <= 3 ? 'ruim' : l.dias <= 7 ? 'alerta' : ''}">⏳ ${l.dias} dia(s)</span>`;
  return `<div class="item" data-id="${esc(l.id)}">
    <div class="nota ${notaCls(l.nota)}" title="Nota de aderência">${l.nota ?? '–'}</div>
    <div class="corpo">
      <div class="linha entre"><b>${esc(l.orgao)}</b><div class="linha">${l.status ? seloStatus(l.status) : ''}${prazo}</div></div>
      <div class="obj">${esc(l.objeto)}</div>
      <div class="meta"><span>📍 ${esc(l.municipio || '—')}/${esc(l.uf)}</span><span>${esc(l.modalidade)} ${esc(l.numero || '')}</span>
        <span class="num">💰 ${brl(l.valor)}</span><span>📅 até ${dataBR(l.encerramento)}</span>${l.srp ? '<span>🗂️ registro de preços</span>' : ''}
        ${(l.termos || []).length ? '<span>🏷️ ' + esc(l.termos.slice(0, 5).join(', ')) + '</span>' : ''}</div>
      ${naCarteira ? `<div class="grade g3" style="margin-top:10px">
          <label class="campo">Situação<select data-campo="status">${META.status.map(s => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="campo">Valor da nossa proposta<input type="number" data-campo="valorProposta" value="${esc(l.valorProposta || '')}"></label>
          <label class="campo">Notas<input type="text" data-campo="notas" value="${esc(l.notas || '')}" placeholder="o que combinamos"></label></div>` : ''}
      ${l.analise ? blocoAnalise(l.analise) : ''}
      <div class="acoes">
        <a class="btn peq" href="${esc(l.link)}" target="_blank" rel="noopener">📄 Ver no PNCP</a>
        ${naCarteira ? '' : `<button class="btn peq" data-acao="salvar">${l.naCarteira ? '✓ na carteira' : '⭐ Salvar na carteira'}</button>`}
        <button class="btn peq" data-acao="analisar">🔎 Analisar</button>
        <button class="btn peq" data-acao="analisar-ia">🧠 Análise com IA (Helena)</button>
        <button class="btn peq" data-acao="fabrica">🏭 Pedir protótipo à fábrica</button>
        ${naCarteira ? '<button class="btn peq perigo" data-acao="remover">Tirar da carteira</button>' : ''}
      </div>
      <div class="prog-item"></div>
    </div></div>`;
}
function blocoAnalise(a) {
  const ia = a.ia || {};
  return `<details class="sec" style="margin-top:10px" open><summary>Análise · ${esc(a.recomendacao)} · nota ${a.nota} · ${dataBR(a.quando)}</summary>
    <div class="grade g2">
      <div>${a.sinais.length ? '<h3>Sinais no edital</h3><ul>' + a.sinais.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : ''}
        <h3>Checklist</h3><ul>${a.checklist.map(s => '<li>' + esc(s) + '</li>').join('')}</ul>
        ${a.aviso ? '<p class="dica">⚠ ' + esc(a.aviso) + '</p>' : ''}</div>
      <div>${a.totalItens ? `<h3>${a.totalItens} item(ns)</h3><div class="tabela"><table><tr><th>#</th><th>Descrição</th><th class="n">Qtd</th><th class="n">Total</th></tr>${a.itens.slice(0, 12).map(i =>
          `<tr><td>${i.n}</td><td>${esc((i.descricao || '').slice(0, 120))}</td><td class="n">${nfmt(i.qtd)} ${esc(i.unidade || '')}</td><td class="n">${brl(i.total)}</td></tr>`).join('')}</table></div>` : ''}
        ${a.arquivos && a.arquivos.length ? '<h3 style="margin-top:10px">Arquivos oficiais</h3>' + a.arquivos.map(f => `<div><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.titulo || f.tipo)}</a></div>`).join('') : ''}</div>
    </div>
    ${ia.erro ? '<p class="dica">IA: ' + esc(ia.erro) + '</p>' : ''}
    ${ia.resumo ? `<div class="cartao" style="margin-top:10px;background:var(--bg2)"><h3>🧠 Parecer da Helena: ${esc(ia.parecer || '')}${ia.estimativaUST ? ' · ~' + nfmt(ia.estimativaUST) + ' UST' : ''}</h3><p>${esc(ia.resumo)}</p>
      ${['exigencias', 'riscos', 'prazos', 'equipeSugerida', 'perguntasEsclarecimento'].filter(k => Array.isArray(ia[k]) && ia[k].length).map(k =>
        `<b>${{ exigencias: 'Exigências', riscos: 'Riscos', prazos: 'Prazos', equipeSugerida: 'Equipe sugerida', perguntasEsclarecimento: 'Pedidos de esclarecimento' }[k]}</b><ul>${ia[k].map(x => '<li>' + esc(x) + '</li>').join('')}</ul>`).join('')}</div>` : ''}
  </details>`;
}
function ligarCartoes(box, lista, naCarteira, recarregar) {
  box.querySelectorAll('.item').forEach(el => {
    const l = lista.find(x => x.id === el.dataset.id);
    const prog = el.querySelector('.prog-item');
    el.querySelectorAll('[data-campo]').forEach(i => i.addEventListener('change', async () => {
      try { await api('POST', '/licitacoes/atualizar', { id: l.id, [i.dataset.campo]: i.value }); aviso('Salvo.'); } catch (e) { aviso(e.message); }
    }));
    el.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', async () => {
      const acao = b.dataset.acao;
      try {
        if (acao === 'salvar') { await api('POST', '/licitacoes/salvar', { id: l.id }); b.textContent = '✓ na carteira'; aviso('Salva na carteira.'); }
        if (acao === 'remover') { await api('POST', '/licitacoes/remover', { id: l.id }); recarregar(); }
        if (acao === 'fabrica') { const p = await api('POST', '/licitacoes/fabrica', { id: l.id }); aviso('Pedido "' + p.nome + '" enviado à fábrica.'); }
        if (acao === 'analisar' || acao === 'analisar-ia') {
          b.disabled = true; prog.innerHTML = '<div class="progresso">lendo itens e arquivos no PNCP…</div>';
          const r = await acompanhar(await api('POST', '/licitacoes/analisar', { id: l.id, ia: acao === 'analisar-ia' }),
                                     p => { prog.innerHTML = '<div class="progresso">' + esc(p) + '</div>'; });
          prog.innerHTML = ''; Object.assign(l, r, { naCarteira: true });
          el.outerHTML = cartaoLic(l, naCarteira); ligarCartoes(box, lista, naCarteira, recarregar);
        }
      } catch (e) { prog.innerHTML = '<div class="progresso">❌ ' + esc(e.message) + '</div>'; b.disabled = false; }
    }));
  });
}
async function mostrarResultado() {
  const u = await api('GET', '/licitacoes/ultima');
  const box = $('#resultado'); if (!box) return;
  if (!u.itens.length) { box.innerHTML = '<div class="vazio">Nenhum resultado ainda. Ajuste os filtros e clique em <b>Buscar no PNCP</b>.</div>'; return; }
  box.innerHTML = `<div class="dica">Busca de ${dataBR(u.quando)} · mostrando ${Math.min(u.itens.length, 100)} de ${u.total}</div>` + u.itens.slice(0, 100).map(l => cartaoLic(l, false)).join('');
  ligarCartoes(box, u.itens, false, mostrarResultado);
}
async function carteira() {
  const c = $('#lic-corpo');
  const lista = await api('GET', '/licitacoes/carteira');
  c.innerHTML = `<div class="linha entre" style="margin-bottom:10px"><div class="checks" id="cart-f">${['todas'].concat(META.status).map(s => `<label><input type="radio" name="cf" value="${s}" ${s === 'todas' ? 'checked' : ''}> ${s}</label>`).join('')}</div>
      <button class="btn" id="cart-exp">⬇ Exportar carteira (.csv)</button></div><div id="cart-lista" class="pilha"></div>`;
  $('#cart-exp').addEventListener('click', () => baixar('/licitacoes/exportar.csv'));
  const pinta = () => {
    const f = ($('#cart-f input:checked') || {}).value || 'todas';
    const v = lista.filter(l => f === 'todas' || l.status === f);
    $('#cart-lista').innerHTML = v.length ? v.map(l => cartaoLic(l, true)).join('') : '<div class="vazio">Nada aqui. Salve editais pela busca (⭐).</div>';
    ligarCartoes($('#cart-lista'), v, true, carteira);
  };
  $$('#cart-f input').forEach(i => i.addEventListener('change', pinta));
  pinta();
}
async function radarPerfil() {
  const c = $('#lic-corpo');
  META = await api('GET', '/licitacoes/meta');
  const r = META.radar, p = META.perfil;
  c.innerHTML = `
    <div class="cartao pilha">
      <h3>📡 Radar diário</h3>
      <p class="dica">No horário marcado o escritório busca no PNCP com os filtros salvos na aba Buscar e avisa as licitações NOVAS no celular (aba Avisos do escritório) e no WhatsApp dos números autorizados.</p>
      <div class="grade g4">
        <label class="campo">Ligado<select id="r-ativo"><option value="1">sim</option><option value="0">não</option></select></label>
        <label class="campo">Hora<input type="number" id="r-hora" min="0" max="23"></label>
        <label class="campo">Minuto<input type="number" id="r-min" min="0" max="59"></label>
        <label class="campo">Nota mínima<input type="number" id="r-nota" min="0" max="100"></label>
      </div>
      <div class="checks" id="r-dias">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d, i) => `<label><input type="checkbox" value="${i}"> ${d}</label>`).join('')}</div>
      <div class="dica">Última execução: ${r.ultimo ? dataBR(r.ultimo.quando) + ' · ' + r.ultimo.novas + ' nova(s) de ' + r.ultimo.total : 'nunca'}</div>
      <div class="linha"><button class="btn pri" id="r-salvar">Salvar radar (usa os filtros da aba Buscar)</button><button class="btn" id="r-rodar">▶ Rodar agora</button></div>
      <div id="r-prog"></div>
    </div>
    <div class="cartao pilha" style="margin-top:14px">
      <h3>🏷️ Perfil de aderência da V4</h3>
      <p class="dica">Cada termo encontrado no objeto soma pontos (expressão com espaço vale 40, palavra solta vale 15; máximo 100). Se aparecer um termo de "excluir", o grupo não conta. "Ruído" é apagado antes, para "sistema de registro de preços" não parecer software.</p>
      <div id="p-grupos" class="pilha"></div>
      <label class="campo">Ruído<textarea id="p-ruido" rows="2"></textarea></label>
      <div class="linha"><button class="btn" id="p-novo">+ Grupo</button><button class="btn pri" id="p-salvar">Salvar perfil</button><button class="btn" id="p-padrao">Voltar ao padrão</button></div>
    </div>`;
  $('#r-ativo').value = r.ativo ? '1' : '0'; $('#r-hora').value = r.hora; $('#r-min').value = r.minuto; $('#r-nota').value = r.notaMin;
  $$('#r-dias input').forEach(i => { i.checked = r.dias.includes(Number(i.value)); });
  $('#r-salvar').addEventListener('click', async () => {
    try {
      await api('PUT', '/licitacoes/radar', { ativo: $('#r-ativo').value === '1', hora: Number($('#r-hora').value), minuto: Number($('#r-min').value),
        notaMin: Number($('#r-nota').value), dias: $$('#r-dias input:checked').map(i => Number(i.value)), filtros: Object.assign({}, FILTROS_PADRAO, lembrar('filtros') || {}) });
      aviso('Radar salvo.');
    } catch (e) { aviso(e.message); }
  });
  $('#r-rodar').addEventListener('click', async () => {
    $('#r-prog').innerHTML = '<div class="progresso">rodando o radar…</div>';
    try { const x = await acompanhar(await api('POST', '/licitacoes/radar/rodar', {})); $('#r-prog').innerHTML = '<div class="progresso">' + x.novas + ' licitação(ões) nova(s). Veja em Buscar.</div>'; }
    catch (e) { $('#r-prog').innerHTML = '<div class="progresso">❌ ' + esc(e.message) + '</div>'; }
  });
  const grupos = p.grupos.map(g => Object.assign({}, g));
  const pintaGrupos = () => {
    $('#p-grupos').innerHTML = grupos.map((g, i) => `<div class="cartao" style="background:var(--bg2)"><div class="grade g3">
      <label class="campo">Grupo<input type="text" data-i="${i}" data-k="nome" value="${esc(g.nome)}"></label>
      <label class="campo" style="grid-column:span 2">Termos que somam<input type="text" data-i="${i}" data-k="termos" value="${esc(g.termos)}"></label></div>
      <div class="linha" style="margin-top:8px"><label class="campo" style="flex:1">Excluir<input type="text" data-i="${i}" data-k="excluir" value="${esc(g.excluir)}"></label>
      <button class="btn peq perigo" data-del="${i}">Remover</button></div></div>`).join('');
    $$('#p-grupos input').forEach(x => x.addEventListener('input', () => { grupos[x.dataset.i][x.dataset.k] = x.value; }));
    $$('#p-grupos [data-del]').forEach(b => b.addEventListener('click', () => { grupos.splice(Number(b.dataset.del), 1); pintaGrupos(); }));
  };
  pintaGrupos(); $('#p-ruido').value = p.ruido;
  $('#p-novo').addEventListener('click', () => { grupos.push({ nome: 'Novo grupo', termos: '', excluir: '' }); pintaGrupos(); });
  $('#p-salvar').addEventListener('click', async () => { try { await api('PUT', '/licitacoes/perfil', { grupos, ruido: $('#p-ruido').value }); aviso('Perfil salvo. Vale na próxima busca.'); } catch (e) { aviso(e.message); } });
  $('#p-padrao').addEventListener('click', async () => { await api('POST', '/licitacoes/perfil/padrao', {}); radarPerfil(); });
}

/* ===========================================================
   FÁBRICA
   =========================================================== */
async function fabrica() {
  const [d, ia] = await Promise.all([api('GET', '/fabrica'), api('GET', '/ia').catch(() => ({}))]);
  const semIA = ia && ia.instalado === false ? '<div class="progresso" style="margin-bottom:12px">⚠ O Claude Code não foi encontrado nesta máquina. Instale e faça login (rode "claude" no terminal) para a fábrica gerar código.</div>'
              : ia && ia.instalado && !ia.conectado ? '<div class="progresso" style="margin-bottom:12px">⚠ O Claude Code está instalado mas sem login. Rode "claude" no terminal e entre.</div>' : '';
  main.innerHTML = `
    <h1>Fábrica de Software</h1>
    <p class="sub">Diga o sistema que você quer. O squad certo do time pega o pedido, escreve o código numa pasta própria, os testes, o README e o relatório com as UST. Você roda os testes, liga a prévia e baixa o código. Os agentes só escrevem arquivos: executar é sempre um clique seu.</p>
    ${semIA}
    <div class="cartao pilha">
      <div class="grade g3">
        <label class="campo">Nome do sistema<input type="text" id="n-nome" placeholder="ex.: Protocolo Digital"></label>
        <label class="campo">Órgão / cliente (opcional)<input type="text" id="n-cli" placeholder="ex.: Prefeitura de Uberaba"></label>
        <label class="campo">Prioridade<select id="n-pri"><option value="1">1 — urgente</option><option value="2" selected>2 — normal</option><option value="3">3 — quando der</option></select></label>
      </div>
      <label class="campo">O que o sistema precisa fazer<textarea id="n-ped" rows="5" placeholder="ex.: Sistema web de protocolo de documentos para prefeitura: cidadão abre pedido com anexo, servidor despacha entre setores, consulta pública pelo número do protocolo, painel com prazos vencendo e relatório mensal."></textarea></label>
      <label class="campo">Tecnologia preferida (opcional)<input type="text" id="n-stack" placeholder="ex.: tela simples, foco em celular"></label>
      <div class="linha"><button class="btn pri" id="n-ok">🏭 Mandar para a fábrica</button><span class="dica" id="n-msg"></span></div>
    </div>
    <details class="sec" style="margin-top:12px"><summary>⚙️ Ajustes da fábrica</summary>
      <div class="grade g3">
        <label class="campo">Sistemas em paralelo (1 a 4)<input type="number" id="c-par" min="1" max="4" value="${d.config.paralelo}"></label>
        <label class="campo">Horas por UST<input type="number" id="c-hust" min="0.1" step="0.1" value="${d.config.horasPorUST}"></label>
        <label class="campo">Modelo (vazio = padrão do Claude Code)<input type="text" id="c-mod" value="${esc(d.config.modelo)}" placeholder="ex.: sonnet"></label>
      </div>
      <div class="linha" style="margin-top:10px"><button class="btn" id="c-ok">Salvar ajustes</button><span class="dica">Cada sistema gerado consome a cota do seu plano do Claude.</span></div>
    </details>
    <h2>Pedidos</h2><div id="prj" class="pilha"></div>`;
  $('#n-ok').addEventListener('click', async () => {
    try {
      const p = await api('POST', '/fabrica', { nome: $('#n-nome').value, cliente: $('#n-cli').value, prioridade: $('#n-pri').value, pedido: $('#n-ped').value, stack: $('#n-stack').value });
      aviso('Pedido enviado. Squad: ' + (p.squad.map(s => s.nome).join(', ') || 'time da fábrica'));
      fabrica();
    } catch (e) { $('#n-msg').textContent = e.message; }
  });
  $('#c-ok').addEventListener('click', async () => { try { await api('PUT', '/fabrica/config', { paralelo: $('#c-par').value, horasPorUST: $('#c-hust').value, modelo: $('#c-mod').value }); aviso('Ajustes salvos.'); } catch (e) { aviso(e.message); } });
  const pinta = lista => {
    $('#prj').innerHTML = lista.length ? lista.map(p => `<div class="cartao" data-id="${p.id}">
      <div class="linha entre"><div><b>${esc(p.nome)}</b> ${p.rodando ? '<span class="pulsa" title="trabalhando"></span>' : ''}<div class="dica">${esc(p.cliente || '')} ${dataBR(p.criadoEm)}</div></div>
        <div class="linha">${seloStatus(p.status)}${p.ust ? `<span class="selo">${nfmt(p.ust)} UST</span>` : ''}${p.testes ? `<span class="selo ${p.testes.ok ? 'ok' : 'ruim'}">testes ${p.testes.passaram}/${p.testes.passaram + p.testes.falharam}</span>` : ''}</div></div>
      <div class="dica" style="margin:6px 0">👥 ${esc(p.squad.map(s => s.nome + ' (' + s.papel + ')').join(', ') || 'time da fábrica')}</div>
      <div class="log">${p.log.map(x => `<span class="t">${new Date(x.t).toLocaleTimeString('pt-BR')}</span> ${esc(x.txt)}`).join('\n')}</div>
      <div class="acoes"><button class="btn peq pri" data-abrir>Abrir</button>
        ${['erro', 'cancelado', 'interrompido'].includes(p.status) ? '<button class="btn peq" data-a="retomar">↻ Retomar</button>' : ''}
        ${['na fila', 'gerando', 'ajustando'].includes(p.status) ? '<button class="btn peq perigo" data-a="cancelar">⏹ Cancelar</button>' : ''}</div></div>`).join('')
      : '<div class="vazio">Nenhum pedido ainda. Descreva o primeiro sistema acima.</div>';
    $$('#prj [data-abrir]').forEach(b => b.addEventListener('click', () => abrirProjeto(b.closest('[data-id]').dataset.id)));
    $$('#prj [data-a]').forEach(b => b.addEventListener('click', async () => { await api('POST', '/fabrica/' + b.closest('[data-id]').dataset.id + '/' + b.dataset.a, {}); atualizar(); }));
  };
  const atualizar = async () => { try { const x = await api('GET', '/fabrica'); if ($('#prj')) pinta(x.projetos); } catch (e) {} };
  pinta(d.projetos);
  timers.push(setInterval(atualizar, 2500));
}

async function abrirProjeto(id) {
  const p = await api('GET', '/fabrica/' + id);
  modal(`<h2 style="margin-top:0">${esc(p.nome)} ${seloStatus(p.status)}</h2>
    <p class="dica">Pasta: <code>${esc(p.pasta)}</code> · porta ${p.porta || '—'} · ${p.arquivos || 0} arquivos · ${p.linhas || 0} linhas · ${nfmt(p.ust)} UST${p.custo ? ' · custo de IA US$ ' + p.custo.toFixed(2) : ''}</p>
    <p>${esc(p.pedido)}</p>
    <div class="acoes">
      <button class="btn" id="pj-test">🧪 Rodar testes</button>
      <button class="btn" id="pj-ligar">▶ Ligar prévia</button>
      <button class="btn" id="pj-desl">■ Desligar</button>
      <button class="btn" id="pj-zip">⬇ Baixar código (.zip)</button>
      <button class="btn" id="pj-rel">⬇ Relatório (.md)</button>
      <button class="btn perigo" id="pj-apagar">Apagar pedido</button>
    </div>
    <div id="pj-saida" style="margin-top:10px"></div>
    <div class="cartao pilha" style="margin-top:12px;background:var(--bg2)">
      <label class="campo">Pedir ajuste ao squad<textarea id="pj-aj" rows="3" placeholder="ex.: coloque login com perfil de servidor e de cidadão; exporte o relatório em CSV"></textarea></label>
      <div><button class="btn pri" id="pj-ajok">✏️ Mandar ajuste</button></div>
    </div>
    ${p.testes ? `<details class="sec" style="margin-top:12px"><summary>Últimos testes: ${p.testes.passaram} passaram, ${p.testes.falharam} falharam</summary><pre class="codigo">${esc(p.testes.saida || '')}</pre></details>` : ''}
    <h2>Relatório</h2>${p.relatorio ? md(p.relatorio) : '<div class="vazio">O relatório aparece quando o squad terminar.</div>'}
    <h2>Código</h2><div class="grade g2"><div class="pilha" style="max-height:50vh;overflow:auto">${p.arvore.map(f => `<a href="#" data-arq="${esc(f)}">${esc(f)}</a>`).join('') || '<span class="dica">sem arquivos ainda</span>'}</div><div id="pj-arq"></div></div>
    <h2>Registro do trabalho</h2><div class="log">${(p.log || []).map(x => `<span class="t">${new Date(x.t).toLocaleTimeString('pt-BR')}</span> ${esc(x.txt)}`).join('\n')}</div>`);
  const saida = $('#pj-saida');
  $('#pj-test').addEventListener('click', async () => {
    saida.innerHTML = '<div class="progresso">rodando node --test…</div>';
    try { const t = await acompanhar(await api('POST', '/fabrica/' + id + '/testes', {})); saida.innerHTML = `<div class="progresso">${t.ok ? '✅' : '❌'} ${t.passaram} passaram, ${t.falharam} falharam</div><pre class="codigo">${esc(t.saida)}</pre>`; }
    catch (e) { saida.innerHTML = '<div class="progresso">❌ ' + esc(e.message) + '</div>'; }
  });
  $('#pj-ligar').addEventListener('click', async () => {
    saida.innerHTML = '<div class="progresso">subindo o sistema…</div>';
    try {
      const r = await api('POST', '/fabrica/' + id + '/ligar', {});
      await new Promise(x => setTimeout(x, 1500));
      saida.innerHTML = `<div class="linha" style="margin-bottom:8px"><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">↗ Abrir em outra aba</a><span class="dica">${esc(r.url)}</span></div><iframe class="previa" src="${esc(r.url)}" title="prévia do sistema"></iframe>`;
    } catch (e) { saida.innerHTML = '<div class="progresso">❌ ' + esc(e.message) + '</div>'; }
  });
  $('#pj-desl').addEventListener('click', async () => { await api('POST', '/fabrica/' + id + '/desligar', {}); saida.innerHTML = ''; aviso('Desligado.'); });
  $('#pj-zip').addEventListener('click', () => baixar('/fabrica/' + id + '/zip'));
  $('#pj-rel').addEventListener('click', () => baixar('/fabrica/' + id + '/relatorio.md'));
  $('#pj-apagar').addEventListener('click', async () => {
    if ($('#pj-apagar').dataset.conf !== '1') { $('#pj-apagar').dataset.conf = '1'; $('#pj-apagar').textContent = 'Clique de novo para apagar (o código fica na pasta)'; return; }
    await api('POST', '/fabrica/' + id + '/apagar', {}); fecharModal(); fabrica();
  });
  $('#pj-ajok').addEventListener('click', async () => {
    try { await api('POST', '/fabrica/' + id + '/ajustar', { texto: $('#pj-aj').value }); fecharModal(); aviso('Ajuste enviado ao squad.'); fabrica(); }
    catch (e) { aviso(e.message); }
  });
  $$('#modal-corpo [data-arq]').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    try { const r = await api('GET', '/fabrica/' + id + '/arquivo?p=' + encodeURIComponent(a.dataset.arq)); $('#pj-arq').innerHTML = `<div class="dica">${esc(a.dataset.arq)}</div><pre class="codigo">${esc(r.texto)}</pre>`; }
    catch (x) { aviso(x.message); }
  }));
}

/* ===========================================================
   COMERCIAL
   =========================================================== */
async function comercial() {
  const f = Object.assign({ uf: '', tipo: '', status: '', q: '', comEmail: false }, lembrar('comf') || {});
  main.innerHTML = `
    <h1>Comercial</h1>
    <p class="sub">Contatos institucionais e públicos: e-mail e telefone que o próprio órgão declarou no cadastro da Receita Federal (CNPJ), lista oficial de municípios do IBGE e prefeitos eleitos dos dados abertos do TSE. Nada de contato pessoal — LGPD.</p>
    <div class="grade g2">
      <div class="cartao pilha"><h3>Trazer contatos</h3>
        <div class="linha"><button class="btn pri" id="c-editais">🏛️ Órgãos dos editais (Receita)</button><label class="campo" style="width:110px">Até<input type="number" id="c-lim" value="40" min="1" max="200"></label></div>
        <div class="linha"><select id="c-uf-imp" style="width:90px">${UFS.map(u => `<option>${u}</option>`).join('')}</select><button class="btn" id="c-mun">🗺️ Prefeituras da UF (IBGE)</button></div>
        <div class="linha"><input type="text" id="c-cnpj" placeholder="CNPJ de um órgão" style="flex:1"><button class="btn" id="c-cnpj-ok">Consultar CNPJ</button></div>
        <div id="c-prog"></div></div>
      <div class="cartao pilha"><h3>Prefeitos eleitos (TSE)</h3>
        <p class="dica">Baixe o arquivo de candidatos de 2024 do estado em <a href="https://dadosabertos.tse.jus.br/dataset/candidatos-2024" target="_blank" rel="noopener">dadosabertos.tse.jus.br</a> (consulta_cand_2024_UF.csv, dentro do .zip) e envie aqui. O painel pega só prefeito e vice ELEITOS. O TSE não publica e-mail nem telefone dos eleitos.</p>
        <div class="linha"><input type="file" id="c-tse" accept=".csv,text/csv"><button class="btn" id="c-tse-ok">Importar</button></div></div>
    </div>
    <div class="cartao" style="margin-top:12px"><div class="grade g4">
      <label class="campo">UF<select id="c-uf"><option value="">todas</option>${UFS.map(u => `<option>${u}</option>`).join('')}</select></label>
      <label class="campo">Tipo<select id="c-tipo"><option value="">todos</option><option value="prefeitura">prefeitura</option><option value="orgao">órgão</option></select></label>
      <label class="campo">Situação<select id="c-st"><option value="">todas</option><option>novo</option><option>contatado</option><option>em negociação</option><option>cliente</option><option>sem interesse</option></select></label>
      <label class="campo">Buscar<input type="search" id="c-q" placeholder="nome, cidade, prefeito"></label></div>
      <div class="linha" style="margin-top:10px"><div class="checks"><label><input type="checkbox" id="c-email"> só com e-mail</label></div>
        <button class="btn" id="c-exp">⬇ Exportar (.csv)</button><button class="btn" id="c-novo">+ Contato manual</button></div></div>
    <div id="c-lista" style="margin-top:12px"></div>`;
  $('#c-uf').value = f.uf; $('#c-tipo').value = f.tipo; $('#c-st').value = f.status; $('#c-q').value = f.q; $('#c-email').checked = !!f.comEmail;
  const filtros = () => ({ uf: $('#c-uf').value, tipo: $('#c-tipo').value, status: $('#c-st').value, q: $('#c-q').value.trim(), comEmail: $('#c-email').checked });
  const qs = x => '?' + new URLSearchParams({ uf: x.uf, tipo: x.tipo, status: x.status, q: x.q, comEmail: x.comEmail ? '1' : '' });
  const prog = t => { $('#c-prog').innerHTML = t ? '<div class="progresso">' + esc(t) + '</div>' : ''; };
  const pinta = async () => {
    const x = filtros(); lembrar('comf', x);
    const r = await api('GET', '/comercial' + qs(x));
    $('#c-lista').innerHTML = r.itens.length ? `<div class="dica" style="margin-bottom:6px">${r.itens.length} contato(s)</div><div class="tabela"><table>
      <tr><th>Órgão</th><th>Local</th><th>Prefeito(a)</th><th>E-mail institucional</th><th>Telefone</th><th>Situação</th><th></th></tr>
      ${r.itens.slice(0, 500).map(c => `<tr data-id="${esc(c.id)}"><td><b>${esc(c.nome)}</b>${c.cnpj ? '<div class="dica">' + esc(c.cnpj) + '</div>' : ''}</td><td>${esc(c.municipio || '')}/${esc(c.uf || '')}</td>
        <td>${esc(c.prefeito || '—')}${c.partido ? ' <span class="dica">' + esc(c.partido) + '</span>' : ''}</td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> <button class="btn peq" data-copiar="${esc(c.email)}">copiar</button>` : '<span class="dica">—</span>'}</td>
        <td>${esc(c.telefone || '—')}</td>
        <td><select data-st>${r.status.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn peq" data-email>✉️ Rascunho</button></td></tr>`).join('')}</table></div>`
      : '<div class="vazio">Nenhum contato com esses filtros. Traga os órgãos dos editais ou as prefeituras de uma UF.</div>';
    $$('#c-lista [data-copiar]').forEach(b => b.addEventListener('click', () => copiar(b.dataset.copiar)));
    $$('#c-lista [data-st]').forEach(s => s.addEventListener('change', async () => { await api('POST', '/comercial/atualizar', { id: s.closest('tr').dataset.id, status: s.value }); aviso('Salvo.'); }));
    $$('#c-lista [data-email]').forEach(b => b.addEventListener('click', async () => {
      const idC = b.closest('tr').dataset.id; b.disabled = true; b.textContent = 'escrevendo…';
      try {
        const x = await acompanhar(await api('POST', '/comercial/abordagem', { id: idC }));
        modal(`<h2 style="margin-top:0">Rascunho de e-mail</h2><p class="dica">Revise antes de enviar. O envio é pelo seu e-mail.</p><textarea id="rasc" rows="16">${esc(x.texto)}</textarea><div class="acoes"><button class="btn pri" id="rasc-c">Copiar</button></div>`);
        $('#rasc-c').addEventListener('click', () => copiar($('#rasc').value));
      } catch (e) { aviso(e.message); }
      b.disabled = false; b.textContent = '✉️ Rascunho';
    }));
  };
  ['#c-uf', '#c-tipo', '#c-st', '#c-email'].forEach(s => $(s).addEventListener('change', pinta));
  $('#c-q').addEventListener('input', () => { clearTimeout(pinta._t); pinta._t = setTimeout(pinta, 300); });
  $('#c-exp').addEventListener('click', () => baixar('/comercial/exportar.csv' + qs(filtros())));
  $('#c-editais').addEventListener('click', async () => {
    try { const r = await acompanhar(await api('POST', '/comercial/importar-editais', { limite: $('#c-lim').value }), prog);
      prog(`${r.ok} de ${r.consultados} órgãos consultados na Receita${r.erros.length ? ' · ' + r.erros.length + ' falharam' : ''}${r.semConsulta ? ' · ' + r.semConsulta + ' já estavam na lista' : ''}.`); pinta(); }
    catch (e) { prog('❌ ' + e.message); }
  });
  $('#c-mun').addEventListener('click', async () => {
    try { const r = await acompanhar(await api('POST', '/comercial/municipios', { uf: $('#c-uf-imp').value }), prog); prog(r.municipios + ' prefeituras de ' + r.uf + ' na lista.'); pinta(); }
    catch (e) { prog('❌ ' + e.message); }
  });
  $('#c-cnpj-ok').addEventListener('click', async () => {
    try { const c = await api('POST', '/comercial/cnpj', { cnpj: $('#c-cnpj').value }); prog(c.nome + (c.email ? ' · ' + c.email : ' · sem e-mail no cadastro')); pinta(); }
    catch (e) { prog('❌ ' + e.message); }
  });
  $('#c-tse-ok').addEventListener('click', async () => {
    const arq = $('#c-tse').files[0]; if (!arq) return aviso('Escolha o arquivo .csv do TSE.');
    prog('enviando ' + (arq.size / 1048576).toFixed(1) + ' MB…');
    try {
      const r = await fetch('/api/painel/comercial/tse', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: arq });
      const j = await r.json(); if (!r.ok) throw new Error(j.motivo);
      prog(j.prefeitos + ' prefeito(s) e ' + j.vices + ' vice(s) eleitos importados.'); pinta();
    } catch (e) { prog('❌ ' + e.message); }
  });
  $('#c-novo').addEventListener('click', () => {
    modal(`<h2 style="margin-top:0">Novo contato</h2><div class="grade g2">
      <label class="campo">Nome do órgão<input type="text" id="m-nome"></label><label class="campo">Tipo<select id="m-tipo"><option value="orgao">órgão</option><option value="prefeitura">prefeitura</option></select></label>
      <label class="campo">Município<input type="text" id="m-mun"></label><label class="campo">UF<select id="m-uf">${UFS.map(u => `<option>${u}</option>`).join('')}</select></label>
      <label class="campo">E-mail institucional<input type="text" id="m-email"></label><label class="campo">Telefone<input type="text" id="m-tel"></label>
      <label class="campo">Prefeito(a)<input type="text" id="m-pref"></label></div><div class="acoes"><button class="btn pri" id="m-ok">Salvar</button></div>`);
    $('#m-ok').addEventListener('click', async () => {
      try { await api('POST', '/comercial/novo', { nome: $('#m-nome').value, tipo: $('#m-tipo').value, municipio: $('#m-mun').value, uf: $('#m-uf').value, email: $('#m-email').value, telefone: $('#m-tel').value, prefeito: $('#m-pref').value }); fecharModal(); pinta(); }
      catch (e) { aviso(e.message); }
    });
  });
  pinta();
}

/* ===========================================================
   WHATSAPP
   =========================================================== */
async function whatsapp() {
  const d = await api('GET', '/whatsapp');
  const c = d.config;
  main.innerHTML = `
    <h1>WhatsApp</h1>
    <p class="sub">Robô de licitações pela API oficial do WhatsApp (Meta Cloud API). Os números autorizados (você e o time) consultam licitações, carteira, fábrica, UST e caixa. Qualquer outro número recebe a resposta automática e a mensagem fica registrada aqui para o comercial responder.</p>
    <div class="grade g2">
      <div class="cartao pilha">
        <h3>Configuração ${c.pronto ? '<span class="selo ok">completa</span>' : '<span class="selo alerta">falta: ' + esc(c.falta.join(', ')) + '</span>'}</h3>
        <div class="grade g2">
          <label class="campo">Robô respondendo<select id="w-ativo"><option value="1">sim</option><option value="0">não (só registra)</option></select></label>
          <label class="campo">Versão da Graph API<input type="text" id="w-ver" value="${esc(c.versao)}"></label>
          <label class="campo">ID do número (Phone number ID)<input type="text" id="w-pid" value="${esc(c.phoneId)}"></label>
          <label class="campo">Token de verificação (você escolhe)<input type="text" id="w-vt" value="${esc(c.verifyToken)}"></label>
          <label class="campo">Token de acesso ${c.temToken ? '(já salvo)' : ''}<input type="password" id="w-tok" placeholder="${c.temToken ? 'deixe vazio para manter' : 'cole o token'}" autocomplete="off"></label>
          <label class="campo">App Secret ${c.temSegredo ? '(já salvo)' : ''}<input type="password" id="w-sec" placeholder="${c.temSegredo ? 'deixe vazio para manter' : 'cole o App Secret'}" autocomplete="off"></label>
        </div>
        <label class="campo">Números autorizados (com DDI e DDD, um por linha)<textarea id="w-aut" rows="3" placeholder="5534999990000">${esc(c.autorizados.join('\n'))}</textarea></label>
        <label class="campo">Resposta automática para outros números<textarea id="w-pub" rows="3">${esc(c.respostaPublica)}</textarea></label>
        <div class="linha"><button class="btn pri" id="w-salvar">Salvar</button></div>
      </div>
      <div class="cartao pilha">
        <h3>Como ligar</h3>
        <ol class="dica" style="margin:0;padding-left:18px">
          <li>No <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>, crie um app do tipo Business e adicione o produto WhatsApp.</li>
          <li>Copie o Phone number ID, gere um token de acesso permanente (usuário do sistema) e pegue o App Secret em Configurações do app.</li>
          <li>Exponha este computador com HTTPS, por exemplo <code>cloudflared tunnel --url http://localhost:4321</code>.</li>
          <li>Em WhatsApp &gt; Configuração, cadastre o webhook <code>https://SEU-ENDERECO/webhook/whatsapp</code> com o token de verificação acima e assine o campo <b>messages</b>.</li>
          <li>Só o caminho /webhook/whatsapp aceita acesso de fora, e só com a assinatura da Meta. O resto do painel continua fechado nesta máquina.</li>
        </ol>
        <h3 style="margin-top:8px">Enviar teste</h3>
        <div class="linha"><input type="text" id="w-num" placeholder="5534999990000" style="flex:1"><button class="btn" id="w-teste">Enviar</button></div>
      </div>
    </div>
    <div class="grade g2" style="margin-top:12px">
      <div class="cartao pilha"><h3>Simulador (sem gastar nada)</h3><p class="dica">Teste os comandos como se fosse um número autorizado: ajuda, licitacoes, buscar software, carteira, detalhe 1, fabrica, ust, caixa.</p>
        <div class="chat" id="w-chat"><div class="bolha bot">Mande "ajuda" para ver os comandos.</div></div>
        <div class="linha"><input type="text" id="w-msg" placeholder="digite um comando" style="flex:1"><button class="btn pri" id="w-env">Enviar</button></div></div>
      <div class="cartao pilha"><h3>Mensagens</h3><div class="log" style="max-height:460px">${d.log.length ? d.log.map(m => `<span class="t">${dataBR(m.quando)}</span> ${m.dir === 'entrou' ? '⬅' : m.dir === 'saiu' ? '➡' : '⚠'} ${esc(m.nome || m.numero || '')}${m.dir === 'entrou' && !m.autorizado ? ' (não autorizado)' : ''}: ${esc((m.texto || '').slice(0, 300))}`).join('\n') : 'nenhuma mensagem ainda'}</div></div>
    </div>`;
  $('#w-ativo').value = c.ativo ? '1' : '0';
  $('#w-salvar').addEventListener('click', async () => {
    try { await api('PUT', '/whatsapp', { ativo: $('#w-ativo').value === '1', versao: $('#w-ver').value.trim(), phoneId: $('#w-pid').value.trim(), verifyToken: $('#w-vt').value.trim(),
      token: $('#w-tok').value.trim(), appSecret: $('#w-sec').value.trim(), autorizados: $('#w-aut').value, respostaPublica: $('#w-pub').value }); aviso('Salvo.'); whatsapp(); }
    catch (e) { aviso(e.message); }
  });
  $('#w-teste').addEventListener('click', async () => { try { await api('POST', '/whatsapp/testar', { numero: $('#w-num').value }); aviso('Mensagem enviada.'); } catch (e) { aviso(e.message, 6000); } });
  const env = async () => {
    const t = $('#w-msg').value.trim(); if (!t) return;
    const chat = $('#w-chat'); chat.insertAdjacentHTML('beforeend', `<div class="bolha eu">${esc(t)}</div>`); $('#w-msg').value = '';
    chat.insertAdjacentHTML('beforeend', '<div class="bolha bot" id="w-esp">…</div>'); chat.scrollTop = chat.scrollHeight;
    try { const r = await api('POST', '/whatsapp/simular', { texto: t }); $('#w-esp').outerHTML = `<div class="bolha bot">${esc(r.resposta)}</div>`; }
    catch (e) { $('#w-esp').outerHTML = `<div class="bolha bot">❌ ${esc(e.message)}</div>`; }
    chat.scrollTop = chat.scrollHeight;
  };
  $('#w-env').addEventListener('click', env);
  $('#w-msg').addEventListener('keydown', e => { if (e.key === 'Enter') env(); });
}

/* ===========================================================
   FINANCEIRO
   =========================================================== */
async function financeiro() {
  const mes = lembrar('fin-mes') || '';
  const d = await api('GET', '/financeiro' + (mes ? '?mes=' + mes : ''));
  const r = d.resumo;
  const maxMes = Math.max(1, ...r.meses.map(m => Math.max(r.porMes[m].receitas, r.porMes[m].despesas)));
  main.innerHTML = `
    <h1>Financeiro</h1>
    <p class="sub">Lance receitas e despesas da V4 (realizadas ou previstas), por contrato. O saldo, a projeção e o relatório se montam sozinhos.</p>
    <div class="grade g4">
      <div class="tile fin"><span>Saldo atual</span><b class="num">${brl(r.saldo)}</b></div>
      <div class="tile"><span>Receitas realizadas</span><b class="num">${brl(r.receitas)}</b></div>
      <div class="tile"><span>Despesas realizadas</span><b class="num">${brl(r.despesas)}</b></div>
      <div class="tile"><span>Margem</span><b class="num">${(r.margem * 100).toFixed(1)}%</b></div>
      <div class="tile"><span>A receber</span><b class="num">${brl(r.aReceber)}</b></div>
      <div class="tile"><span>A pagar</span><b class="num">${brl(r.aPagar)}</b></div>
      <div class="tile fin"><span>Saldo projetado</span><b class="num">${brl(r.saldoProjetado)}</b></div>
      <div class="tile"><span>Saldo inicial</span><div class="linha"><input type="number" id="f-si" value="${r.saldoInicial}" step="0.01" style="flex:1"><button class="btn peq" id="f-si-ok">ok</button></div></div>
    </div>
    ${r.meses.length ? `<div class="cartao" style="margin-top:12px"><h3>Receitas e despesas por mês <span class="dica">verde receita · vermelho despesa</span></h3>
      <div class="colunas">${r.meses.slice(-12).map(m => { const x = r.porMes[m]; return `<div class="mes"><div class="par">
        <i style="height:${x.receitas / maxMes * 100}%;background:var(--fin)" title="receitas ${brl(x.receitas)}"></i>
        <i style="height:${x.despesas / maxMes * 100}%;background:var(--ruim)" title="despesas ${brl(x.despesas)}"></i></div>${m.slice(5)}/${m.slice(2, 4)}</div>`; }).join('')}</div></div>` : ''}
    <div class="grade g2" style="margin-top:12px">
      <div class="cartao pilha"><h3>Novo lançamento</h3>
        <div class="grade g2">
          <label class="campo">Tipo<select id="l-tipo"><option value="receita">receita</option><option value="despesa">despesa</option></select></label>
          <label class="campo">Data<input type="date" id="l-data" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label class="campo">Valor (R$)<input type="number" id="l-val" step="0.01" min="0"></label>
          <label class="campo">Situação<select id="l-sit"><option value="realizado">realizado</option><option value="previsto">previsto</option></select></label>
          <label class="campo">Categoria<select id="l-cat"></select></label>
          <label class="campo">Contrato / projeto<input type="text" id="l-ctr" placeholder="opcional"></label></div>
        <label class="campo">Descrição<input type="text" id="l-desc"></label>
        <div><button class="btn pri" id="l-ok">Lançar</button></div></div>
      <div class="cartao pilha"><h3>Importar e relatórios</h3>
        <p class="dica">CSV com colunas <code>data;descrição;valor;categoria;tipo;situação;contrato</code>. Valor negativo vira despesa. Data em 31/12/2026 ou 2026-12-31.</p>
        <input type="file" id="i-arq" accept=".csv,text/csv">
        <div class="linha"><button class="btn" id="i-ok">⬆ Importar CSV</button><button class="btn" id="e-csv">⬇ Exportar CSV</button><button class="btn" id="e-rel">📄 Ver relatório</button><button class="btn" id="e-md">⬇ Relatório (.md)</button></div></div>
    </div>
    <div class="linha entre" style="margin-top:16px"><h2 style="margin:0">Lançamentos</h2>
      <label class="campo" style="width:170px">Mês<input type="month" id="f-mes" value="${esc(mes)}"></label></div>
    <div class="tabela" style="margin-top:8px"><table><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Contrato</th><th>Situação</th><th class="n">Valor</th><th></th></tr>
      ${d.lancamentos.map(l => `<tr><td>${l.data.split('-').reverse().join('/')}</td><td>${esc(l.descricao)}</td><td>${esc(l.categoria)}</td><td>${esc(l.contrato || '')}</td><td>${seloStatus(l.situacao)}</td>
        <td class="n" style="color:${l.tipo === 'receita' ? '#4ade80' : '#f87171'}">${l.tipo === 'despesa' ? '−' : ''}${brl(l.valor)}</td><td><button class="btn peq perigo" data-del="${l.id}">✕</button></td></tr>`).join('') ||
      '<tr><td colspan="7" class="dica">Nenhum lançamento neste período.</td></tr>'}</table></div>`;
  const cats = () => { $('#l-cat').innerHTML = d.categorias[$('#l-tipo').value].map(c => `<option>${esc(c)}</option>`).join(''); };
  cats(); $('#l-tipo').addEventListener('change', cats);
  $('#l-ok').addEventListener('click', async () => {
    try { await api('POST', '/financeiro', { tipo: $('#l-tipo').value, data: $('#l-data').value, valor: Number($('#l-val').value), situacao: $('#l-sit').value,
      categoria: $('#l-cat').value, contrato: $('#l-ctr').value, descricao: $('#l-desc').value }); aviso('Lançado.'); financeiro(); }
    catch (e) { aviso(e.message); }
  });
  $('#f-si-ok').addEventListener('click', async () => { await api('POST', '/financeiro/saldo-inicial', { valor: Number($('#f-si').value) }); financeiro(); });
  $('#f-mes').addEventListener('change', () => { lembrar('fin-mes', $('#f-mes').value); financeiro(); });
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => { await api('POST', '/financeiro/remover', { id: b.dataset.del }); financeiro(); }));
  $('#i-ok').addEventListener('click', async () => {
    const f = $('#i-arq').files[0]; if (!f) return aviso('Escolha o arquivo CSV.');
    try { const r = await api('POST', '/financeiro/importar', { texto: await f.text() }); aviso(r.importados + ' lançamento(s) importados' + (r.erros.length ? '; ' + r.erros.length + ' linha(s) com erro' : '') + '.', 6000); financeiro(); }
    catch (e) { aviso(e.message); }
  });
  $('#e-csv').addEventListener('click', () => baixar('/financeiro/exportar.csv' + (mes ? '?mes=' + mes : '')));
  $('#e-md').addEventListener('click', () => baixar('/financeiro/relatorio.md'));
  $('#e-rel').addEventListener('click', async () => { const x = await api('GET', '/financeiro/relatorio'); modal(md(x.texto)); });
}

/* ===========================================================
   UST
   =========================================================== */
async function ust() {
  const e = await api('GET', '/ust');
  let sel = lembrar('ust-ctr');
  if (!e.contratos.find(c => c.id === sel)) sel = e.contratos[0] && e.contratos[0].id;
  main.innerHTML = `
    <h1>UST — teto e distribuição</h1>
    <p class="sub">Cadastre o contrato com a quantidade máxima de UST. Lance as demandas (ou traga da fábrica). O painel aceita demandas até bater o teto, reparte entre os agentes respeitando a capacidade de cada um e entrega o relatório.</p>
    <div class="grade g2">
      <div class="cartao pilha"><h3>Contrato</h3>
        <div class="grade g2">
          <label class="campo">Nome<input type="text" id="u-nome" placeholder="ex.: Fábrica de software 2026"></label>
          <label class="campo">Órgão<input type="text" id="u-org"></label>
          <label class="campo">Quantidade máxima (teto) de UST<input type="number" id="u-teto" min="1"></label>
          <label class="campo">Valor da UST (R$)<input type="number" id="u-val" step="0.01" min="0"></label>
          <label class="campo">Horas por UST<input type="number" id="u-h" step="0.1" min="0.1" value="1"></label>
          <label class="campo">Meta mensal de UST (opcional)<input type="number" id="u-meta" min="0"></label>
          <label class="campo">Início<input type="date" id="u-ini"></label>
          <label class="campo">Fim<input type="date" id="u-fim"></label></div>
        <div class="linha"><button class="btn pri" id="u-salvar">Salvar contrato</button><button class="btn" id="u-limpar">Novo</button></div></div>
      <div class="cartao pilha"><h3>Demanda (ordem de serviço)</h3>
        <div class="grade g2">
          <label class="campo">Contrato<select id="d-ctr">${e.contratos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
          <label class="campo">UST estimadas<input type="number" id="d-ust" min="0.1" step="0.1"></label>
          <label class="campo">Prioridade<select id="d-pri"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select></label>
          <label class="campo">Situação<select id="d-st"><option>backlog</option><option>em execução</option><option>entregue</option></select></label></div>
        <label class="campo">Título<input type="text" id="d-tit" placeholder="ex.: Módulo de relatórios do portal"></label>
        <label class="campo">Squad (nomes separados por vírgula, opcional)<input type="text" id="d-sq" placeholder="ex.: Lucas, Beatriz"></label>
        <div class="linha"><button class="btn pri" id="d-ok">Lançar demanda</button><button class="btn" id="d-fab">🏭 Trazer da fábrica</button></div>
        <label class="campo" style="max-width:260px">Capacidade de cada agente (horas/mês)<div class="linha"><input type="number" id="u-cap" value="${e.capacidadeHorasMes}" style="flex:1"><button class="btn peq" id="u-cap-ok">ok</button></div></label></div>
    </div>
    <h2>Contratos</h2>
    <div class="checks" id="u-ctrs">${e.contratos.map(c => `<label><input type="radio" name="uc" value="${c.id}" ${c.id === sel ? 'checked' : ''}> ${esc(c.nome)} · ${nfmt(c.tetoUST)} UST</label>`).join('') || '<span class="dica">nenhum contrato ainda</span>'}</div>
    <div id="u-dist" style="margin-top:12px"></div>`;
  const preencher = c => { $('#u-nome').value = c.nome || ''; $('#u-org').value = c.orgao || ''; $('#u-teto').value = c.tetoUST || ''; $('#u-val').value = c.valorUST || '';
    $('#u-h').value = c.horasPorUST || 1; $('#u-meta').value = c.metaMensal || ''; $('#u-ini').value = c.inicio || ''; $('#u-fim').value = c.fim || ''; $('#u-salvar').dataset.id = c.id || ''; };
  if (sel) { preencher(e.contratos.find(c => c.id === sel)); $('#d-ctr').value = sel; }
  $('#u-limpar').addEventListener('click', () => preencher({}));
  $('#u-salvar').addEventListener('click', async () => {
    try { const c = await api('POST', '/ust/contrato', { id: $('#u-salvar').dataset.id || undefined, nome: $('#u-nome').value, orgao: $('#u-org').value, tetoUST: Number($('#u-teto').value),
      valorUST: Number($('#u-val').value), horasPorUST: Number($('#u-h').value), metaMensal: Number($('#u-meta').value), inicio: $('#u-ini').value, fim: $('#u-fim').value });
      lembrar('ust-ctr', c.id); aviso('Contrato salvo.'); ust(); }
    catch (x) { aviso(x.message); }
  });
  $('#d-ok').addEventListener('click', async () => {
    try { await api('POST', '/ust/demanda', { contratoId: $('#d-ctr').value, titulo: $('#d-tit').value, ust: Number($('#d-ust').value), prioridade: $('#d-pri').value,
      status: $('#d-st').value, squad: $('#d-sq').value.split(',').map(s => s.trim()).filter(Boolean) }); aviso('Demanda lançada.'); lembrar('ust-ctr', $('#d-ctr').value); ust(); }
    catch (x) { aviso(x.message); }
  });
  $('#d-fab').addEventListener('click', async () => { try { const r = await api('POST', '/ust/importar-fabrica', { contratoId: $('#d-ctr').value }); aviso(r.novas + ' demanda(s) nova(s) da fábrica.'); ust(); } catch (x) { aviso(x.message); } });
  $('#u-cap-ok').addEventListener('click', async () => { await api('POST', '/ust/capacidade', { horas: Number($('#u-cap').value) }); ust(); });
  $$('#u-ctrs input').forEach(i => i.addEventListener('change', () => { lembrar('ust-ctr', i.value); ust(); }));
  if (!sel) return;

  const r = await api('GET', '/ust/distribuir?contrato=' + sel);
  const demandas = e.demandas.filter(x => x.contratoId === sel);
  $('#u-dist').innerHTML = `
    <div class="cartao pilha">
      <div class="linha entre"><h3 style="margin:0">${esc(r.contrato.nome)} ${r.contrato.orgao ? '<span class="dica">' + esc(r.contrato.orgao) + '</span>' : ''}</h3>
        <div class="linha"><button class="btn peq" id="r-ver">📄 Ver relatório</button><button class="btn peq" id="r-md">⬇ .md</button><button class="btn peq" id="r-csv">⬇ .csv</button><button class="btn peq perigo" id="r-del">Apagar contrato</button></div></div>
      <div class="medidor" title="${r.percentual}% do teto"><i style="width:${Math.min(100, r.percentual)}%"></i></div>
      <div class="grade g4">
        <div class="tile ust"><span>Distribuído</span><b class="num">${nfmt(r.usado)} / ${nfmt(r.teto)}</b><div class="dica">${r.percentual}% do teto</div></div>
        <div class="tile"><span>Falta para o teto</span><b class="num">${nfmt(r.falta)} UST</b><div class="dica">${brl(r.falta * r.contrato.valorUST)}</div></div>
        <div class="tile"><span>Valor distribuído</span><b class="num">${brl(r.valorUsado)}</b><div class="dica">de ${brl(r.valorTeto)}</div></div>
        <div class="tile"><span>Já entregue</span><b class="num">${nfmt(r.entregue)} UST</b><div class="dica">capacidade ${nfmt(r.capacidadeUSTporAgente)} UST/agente em ${r.meses} meses</div></div>
      </div>
      ${r.cabem.length ? `<div class="progresso">Para bater o teto, cabem: ${esc(r.cabem.map(x => x.titulo + ' (' + nfmt(x.ust) + ')').join(', '))}</div>` : r.falta > 0 ? `<div class="progresso">Faltam ${nfmt(r.falta)} UST para o teto e nenhuma demanda do backlog cabe. Lance demandas menores ou peça à fábrica.</div>` : ''}
      ${r.sobrecarregados.length ? `<div class="progresso" style="color:#fca5a5">Acima de 100% da capacidade: ${esc(r.sobrecarregados.join(', '))}. Redistribua, amplie o prazo ou o time.</div>` : ''}
      <div class="grade g2">
        <div><h3>Por agente</h3>${r.porAgente.length ? r.porAgente.map(a => `<div style="margin-bottom:8px"><div class="linha entre"><span>${esc(a.agente)}</span><span class="dica num">${nfmt(a.ust)} UST · ${nfmt(a.horas)} h · ${a.ocupacao}%</span></div>
          <div class="barra"><i class="${a.ocupacao > 100 ? 'cheia' : ''}" style="width:${Math.min(100, a.ocupacao)}%"></i></div></div>`).join('') : '<p class="dica">Nenhuma demanda aceita ainda.</p>'}</div>
        <div><h3>Demandas</h3><div class="tabela"><table><tr><th>Pri.</th><th>Demanda</th><th>Situação</th><th class="n">UST</th><th></th></tr>
          ${demandas.sort((a, b) => a.prioridade - b.prioridade).map(x => { const fora = r.fora.some(f => f.id === x.id); return `<tr><td>${x.prioridade}</td><td>${esc(x.titulo)}${fora ? ' <span class="selo ruim">fora do teto</span>' : ''}
            <div class="dica">${esc(((r.aceitas.find(a => a.id === x.id) || {}).alocacao || []).map(a => a.agente + ' ' + nfmt(a.ust)).join(', '))}</div></td>
            <td><select data-dst="${x.id}">${['backlog', 'em execução', 'entregue', 'cancelada'].map(s => `<option ${s === x.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
            <td class="n">${nfmt(x.ust)}</td><td><button class="btn peq perigo" data-ddel="${x.id}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="dica">Sem demandas.</td></tr>'}</table></div></div>
      </div>
    </div>`;
  $('#r-ver').addEventListener('click', async () => { const x = await api('GET', '/ust/relatorio?contrato=' + sel); modal(md(x.texto)); });
  $('#r-md').addEventListener('click', () => baixar('/ust/relatorio.md?contrato=' + sel));
  $('#r-csv').addEventListener('click', () => baixar('/ust/relatorio.csv?contrato=' + sel));
  $('#r-del').addEventListener('click', async () => {
    if ($('#r-del').dataset.conf !== '1') { $('#r-del').dataset.conf = '1'; $('#r-del').textContent = 'Clique de novo para apagar'; return; }
    await api('POST', '/ust/contrato/remover', { id: sel }); lembrar('ust-ctr', null); ust();
  });
  $$('[data-dst]').forEach(s => s.addEventListener('change', async () => {
    const x = e.demandas.find(d => d.id === s.dataset.dst);
    await api('POST', '/ust/demanda', Object.assign({}, x, { status: s.value })); ust();
  }));
  $$('[data-ddel]').forEach(b => b.addEventListener('click', async () => { await api('POST', '/ust/demanda/remover', { id: b.dataset.ddel }); ust(); }));
}

/* ===========================================================
   NAVEGAÇÃO
   =========================================================== */
const TELAS = { inicio, licitacoes, fabrica, comercial, whatsapp, financeiro, ust };
async function ir(aba) {
  if (!TELAS[aba]) aba = 'inicio';
  limparTimers();
  $$('#abas button').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
  if (location.hash !== '#' + aba) history.replaceState(null, '', '#' + aba);
  main.innerHTML = '<div class="dica">carregando…</div>';
  try { await TELAS[aba](); } catch (e) { erroNaTela(e); }
  main.focus({ preventScroll: true });
}
$$('#abas button').forEach(b => b.addEventListener('click', () => ir(b.dataset.aba)));
window.addEventListener('hashchange', () => ir(location.hash.slice(1)));
ir(location.hash.slice(1) || 'inicio');
})();
