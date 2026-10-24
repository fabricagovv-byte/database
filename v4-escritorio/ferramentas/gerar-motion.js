#!/usr/bin/env node
/* ===========================================================
   ferramentas/gerar-motion.js — vídeo de apresentação da V4 fábricagov

   Grava o próprio software (prédio + Painel V4 em modo demonstração),
   quadro a quadro, com o relógio do jogo controlado: a câmera voa pelas
   salas e o painel é operado na tela. Junta abertura, legendas e
   encerramento e gera um MP4 1920x1080 a 30 qps.

   Uso:   node ferramentas/gerar-motion.js [saida.mp4]
   Precisa: Playwright com Chromium (npm i -g playwright) e ffmpeg no PATH.
   =========================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.resolve(process.argv[2] || path.join(RAIZ, 'v4-fabricagov-motion.mp4'));
const FPS = 30, DT = 1000 / FPS;
const VW = 1600, VH = 900, ESC = 1.2;          // tela 1600x900 em 1.2x = 1920x1080
const QUADROS = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-motion-'));

let playwright;
try { playwright = require(process.env.PW || 'playwright'); }
catch (e) { console.error('Instale o Playwright: npm i -g playwright (ou defina PW com o caminho do módulo)'); process.exit(1); }

/* ---------- servidor estático: o painel cai sozinho no modo demonstração ---------- */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function servir() {
  return new Promise(r => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = path.normalize(path.join(RAIZ, rel === '/' ? 'index.html' : rel));
      if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => r(s));
  });
}

/* ---------- utilidades de tempo ---------- */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const suave = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;       // easeInOutCubic
const rampa = (t, a, b) => clamp((t - a) / (b - a));
let n = 0;
async function quadro(p) {
  await p.screenshot({ path: path.join(QUADROS, String(n++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
  if (n % 150 === 0) console.log('  ' + n + ' quadros (' + (n / FPS).toFixed(1) + ' s)');
}

/* ---------- camada de legenda, logo e fade (vale para qualquer página) ---------- */
const CAMADA_CSS = `
#mv-grad{position:fixed;left:0;right:0;bottom:0;height:46%;background:linear-gradient(transparent,rgba(3,4,8,.82));z-index:99990;pointer-events:none}
#mv-leg{position:fixed;left:84px;bottom:78px;z-index:99991;pointer-events:none;max-width:1100px}
#mv-leg .barra{width:72px;height:6px;border-radius:3px;margin-bottom:18px}
#mv-leg h1{font:700 60px/1.05 'Barlow',sans-serif;color:#fff;margin:0;letter-spacing:.3px;text-shadow:0 6px 30px rgba(0,0,0,.7)}
#mv-leg p{font:600 27px/1.3 'Barlow Semi Condensed',sans-serif;color:#d5dcea;margin:12px 0 0;text-shadow:0 4px 20px rgba(0,0,0,.8)}
#mv-logo{position:fixed;top:38px;right:46px;height:40px;z-index:99991;opacity:.92;filter:drop-shadow(0 4px 16px rgba(0,0,0,.6))}
#mv-fade{position:fixed;inset:0;background:#000;z-index:99999;pointer-events:none;opacity:0}`;
async function camada(p, logo = true) {
  await p.addStyleTag({ content: CAMADA_CSS });
  await p.evaluate(comLogo => {
    const d = document.createElement('div');
    d.innerHTML = '<div id="mv-grad"></div><div id="mv-leg"><div class="barra"></div><h1></h1><p></p></div>' +
      (comLogo ? '<img id="mv-logo" src="img/logo-v4-branca.png">' : '') + '<div id="mv-fade"></div>';
    while (d.firstChild) document.body.appendChild(d.firstChild);
  }, logo);
}
/** legenda ativa no instante t (s) da cena */
async function legenda(p, lista, t, fade) {
  const L = lista.find(x => t >= x.de && t < x.ate);
  let o = 0, y = 30, titulo = '', sub = '', cor = '#3b82f6';
  if (L) {
    const entra = suave(rampa(t, L.de, L.de + .55)), sai = 1 - rampa(t, L.ate - .35, L.ate);
    o = Math.min(entra, sai); y = (1 - entra) * 30; titulo = L.titulo; sub = L.sub; cor = L.cor;
  }
  await p.evaluate(([o, y, titulo, sub, cor, fade]) => {
    const l = document.getElementById('mv-leg'); if (!l) return;
    l.style.opacity = o; l.style.transform = `translateY(${y}px)`;
    l.querySelector('h1').textContent = titulo; l.querySelector('p').textContent = sub;
    l.querySelector('.barra').style.background = cor; l.querySelector('.barra').style.boxShadow = `0 0 18px ${cor}`;
    document.getElementById('mv-grad').style.opacity = Math.max(.35, o);
    document.getElementById('mv-fade').style.opacity = fade;
  }, [o, y, titulo, sub, cor, fade]);
}

/* ---------- abertura e encerramento ---------- */
function paginaMarca(logo64, tipo) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700&family=Barlow+Semi+Condensed:wght@500;600&display=swap" rel="stylesheet">
<style>
html,body{margin:0;height:100%;background:#040507;overflow:hidden}
canvas{position:fixed;inset:0}
.centro{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.logo{position:relative;width:820px;height:150px}
.logo img{width:100%;height:100%;object-fit:contain;display:block}
.brilho{position:absolute;inset:0;-webkit-mask:url(${logo64}) center/contain no-repeat;mask:url(${logo64}) center/contain no-repeat;
  background:linear-gradient(100deg,transparent 40%,rgba(160,200,255,.95) 50%,transparent 60%);background-size:300% 100%}
.linha{font:600 25px 'Barlow Semi Condensed',sans-serif;color:#cfd8ea;text-transform:uppercase;white-space:nowrap}
.menor{font:500 30px 'Barlow',sans-serif;color:#8fa3c7}
.pilares{display:flex;gap:34px;font:700 54px 'Barlow',sans-serif;color:#fff}
.pilares span{display:inline-block}
.pilares i{color:#3b82f6;font-style:normal}
.cred{font:600 24px 'Barlow Semi Condensed',sans-serif;color:#94a3b8;letter-spacing:.2em;text-transform:uppercase}
</style></head><body><canvas id="cv"></canvas>
<div class="centro">
  <div class="logo" id="logo"><img src="${logo64}"><div class="brilho" id="brilho"></div></div>
  ${tipo === 'abertura'
    ? '<div class="linha" id="l1">Softhouse para órgãos públicos</div><div class="menor" id="l2">apresenta o Escritório de Agentes</div>'
    : '<div class="pilares" id="pil"><span>Licitação</span><i>·</i><span>Programação</span><i>·</i><span>Resultado</span></div><div class="linha" id="l1">Escritório virtual · Painel V4 · Agentes de IA</div><div class="cred" id="l2">Arthur Miguel · CEO &amp; Fundador</div>'}
</div>
<script>
const cv = document.getElementById('cv'), c = cv.getContext('2d');
cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; c.scale(devicePixelRatio, devicePixelRatio);
const W = innerWidth, H = innerHeight;
const pts = Array.from({ length: 70 }, (_, i) => ({ x: (i * 997) % W, y: (i * 613) % H, v: .3 + (i % 7) / 10 }));
window.render = (t, tipo) => {
  c.fillStyle = '#040507'; c.fillRect(0, 0, W, H);
  // chão em perspectiva, como o piso isométrico do prédio
  c.save(); c.strokeStyle = 'rgba(59,130,246,.16)'; c.lineWidth = 1;
  const hz = H * .62;
  for (let i = -20; i <= 20; i++) { c.beginPath(); c.moveTo(W / 2 + i * 22, hz); c.lineTo(W / 2 + i * 260, H); c.stroke(); }
  for (let k = 0; k < 14; k++) { const f = ((k + t * .6) % 14) / 14; const y = hz + (H - hz) * f * f; c.globalAlpha = f; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.restore();
  const g = c.createRadialGradient(W / 2, H * .45, 10, W / 2, H * .45, W * .55);
  g.addColorStop(0, 'rgba(59,130,246,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (const p of pts) { c.fillStyle = 'rgba(160,200,255,' + (.15 + .25 * Math.abs(Math.sin(t * p.v + p.x))) + ')'; c.fillRect(p.x, (p.y - t * 18 * p.v + H) % H, 2, 2); }
  const cl = (v) => Math.max(0, Math.min(1, v)), r = (a, b) => cl((t - a) / (b - a)), ease = x => 1 - Math.pow(1 - x, 3);
  const logo = document.getElementById('logo'), br = document.getElementById('brilho');
  const a = ease(r(.2, 1.3));
  logo.style.opacity = a; logo.style.transform = 'scale(' + (1.12 - .12 * a) + ')'; logo.style.filter = 'blur(' + (14 * (1 - a)) + 'px)';
  br.style.backgroundPosition = (120 - 140 * r(1.2, 2.3)) + '% 0';
  const l1 = document.getElementById('l1'), l2 = document.getElementById('l2');
  if (tipo === 'abertura') {
    const b = ease(r(1.6, 2.5)); l1.style.opacity = b; l1.style.letterSpacing = (.75 - .4 * b) + 'em';
    const d = ease(r(2.6, 3.3)); l2.style.opacity = d; l2.style.transform = 'translateY(' + (16 * (1 - d)) + 'px)';
  } else {
    logo.style.transform += ' translateY(-10px)';
    document.querySelectorAll('#pil span, #pil i').forEach((s, i) => { const e = ease(r(1.1 + i * .22, 1.6 + i * .22)); s.style.opacity = e; s.style.transform = 'translateY(' + (24 * (1 - e)) + 'px)'; });
    const b = ease(r(2.4, 3.1)); l1.style.opacity = b; l1.style.letterSpacing = (.5 - .2 * b) + 'em';
    const d = ease(r(3.2, 3.8)); l2.style.opacity = d;
  }
};
</script></body></html>`;
}
async function cenaMarca(p, tipo, dur) {
  const logo64 = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'img', 'logo-v4-branca.png')).toString('base64');
  await p.setContent(paginaMarca(logo64, tipo), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  for (let f = 0; f < dur * FPS; f++) {
    const t = f / FPS;
    const fade = tipo === 'abertura' ? Math.max(1 - rampa(t, 0, .4), rampa(t, dur - .45, dur)) : Math.max(1 - rampa(t, 0, .4), rampa(t, dur - .7, dur));
    await p.evaluate(([t, tipo, fade]) => { window.render(t, tipo); document.body.style.opacity = 1 - fade; }, [t, tipo, fade]);
    await quadro(p);
  }
}

/* ---------- o prédio: relógio do jogo na nossa mão ---------- */
const RELOGIO = `(() => {
  const fila = [];
  window.__vt = 0;
  performance.now = () => window.__vt;
  window.requestAnimationFrame = cb => { fila.push(cb); return fila.length; };
  window.cancelAnimationFrame = () => {};
  window.__passo = ms => { window.__vt += ms; const cbs = fila.splice(0); for (const cb of cbs) cb(window.__vt); };
})();`;
const CINEMA_CSS = `#topbar,#panel,#hud-left,#zoombox,#fps,#toast,#tooltip{display:none!important}
#app{grid-template-columns:1fr!important;grid-template-rows:1fr!important;grid-template-areas:"stage"!important}`;

async function cenaPredio(p, base) {
  await p.addInitScript(RELOGIO);
  await p.goto(base + '/index.html', { waitUntil: 'load' });
  await p.addStyleTag({ content: CINEMA_CSS });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => { window.dispatchEvent(new Event('resize')); __escritorio.fit(); });
  // 40 s de jogo antes de gravar: todo mundo chega à própria mesa
  for (let i = 0; i < 800; i++) await p.evaluate(() => __passo(50));
  const zFit = await p.evaluate(() => { __escritorio.fit(); return __escritorio.cam.z; });
  await camada(p);

  // câmera: [instante, tile x, tile y, zoom]
  const K = [
    [0, 38, 25, zFit * .96], [5, 39, 24, zFit * 1.18],
    [7.6, 38, 9, 1.0], [11.2, 47, 10, 1.1],
    [13.2, 67, 12, 1.0], [16.4, 67, 20, 1.05],
    [18.6, 8, 27, 1.15], [21.6, 9, 29.5, 1.25],
    [23.6, 7, 7, 1.35], [26.6, 6, 9.5, 1.5],
    [28.6, 15, 43, 1.05], [31.6, 21, 44, 1.15],
    [33.6, 45, 45, .92], [37, 45, 49, 1.02]
  ];
  const LEG = [
    { de: .6, ate: 5.2, titulo: 'Um prédio inteiro de agentes de IA', sub: '53 agentes trabalhando em 9 salas · V4 fábricagov', cor: '#3b82f6' },
    { de: 7.6, ate: 12.8, titulo: 'Fábrica de Software', sub: '20 estações: front, back, mobile, dados, DevOps, QA e segurança', cor: '#38bdf8' },
    { de: 13.2, ate: 18.0, titulo: 'Fábrica 2 · Squads', sub: '18 especialistas: legado, SAP, IA generativa, mapas e chatbots', cor: '#a78bfa' },
    { de: 18.6, ate: 23.2, titulo: 'Busca de Licitações', sub: 'Radar no PNCP, análise de edital, proposta e pregão', cor: '#f97316' },
    { de: 23.6, ate: 28.2, titulo: 'Diretoria · Arthur Miguel', sub: 'CEO & Fundador', cor: '#f5c542' },
    { de: 28.6, ate: 33.2, titulo: 'Games & Descanso', sub: 'Fliperama, sinuca, pingue-pongue e cápsulas de soneca', cor: '#ec4899' },
    { de: 33.6, ate: 36.8, titulo: 'Lobby e fachada', sub: 'Catracas, recepção e a marca da V4 na entrada', cor: '#94a3b8' }
  ];
  const DUR = 37.2;
  for (let f = 0; f < DUR * FPS; f++) {
    const t = f / FPS;
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const [t0, x0, y0, z0] = K[i], [t1, x1, y1, z1] = K[i + 1];
    const e = suave(clamp((t - t0) / (t1 - t0)));
    const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e, z = z0 + (z1 - z0) * e;
    await p.evaluate(([x, y, z, dt]) => {
      const c = __escritorio.cam, s = ISO.toScreen(x, y, 30);
      c.x = -s.x; c.y = -s.y; c.z = c.tz = z;
      __passo(dt);
    }, [x, y, z, DT]);
    const fade = Math.max(1 - rampa(t, 0, .5), rampa(t, DUR - .45, DUR));
    await legenda(p, LEG, t, fade);
    await quadro(p);
  }
}

/* ---------- o Painel V4 em operação ---------- */
async function cenaPainel(p, base) {
  await p.goto(base + '/painel.html#inicio', { waitUntil: 'load' });
  await p.addStyleTag({ content: '.faixa-demo,.aviso{display:none!important} html{scroll-behavior:auto!important}' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  await camada(p, false);

  const cenas = [
    { aba: 'inicio', dur: 4, leg: { titulo: 'Painel V4', sub: 'Licitações, fábrica, comercial, WhatsApp, financeiro e UST num lugar só', cor: '#3b82f6' } },
    { aba: 'licitacoes', dur: 7, leg: { titulo: 'Licitações com nota de aderência', sub: 'Busca no PNCP com filtros, carteira, análise e radar diário', cor: '#f97316' } },
    { aba: 'fabrica', dur: 9, leg: { titulo: 'Você pede. O squad programa.', sub: 'Código, testes, prévia do sistema e relatório com UST', cor: '#38bdf8' } },
    { aba: 'ust', dur: 5, leg: { titulo: 'UST até o teto', sub: 'Distribuição pelo time e relatórios automáticos', cor: '#a78bfa' } },
    { aba: 'financeiro', dur: 4.5, leg: { titulo: 'Financeiro', sub: 'Saldo, projeção, gráfico mensal e relatórios', cor: '#22c55e' } },
    { aba: 'whatsapp', dur: 6, leg: { titulo: 'Robô de licitações no WhatsApp', sub: 'Consulte editais, carteira e caixa pelo celular', cor: '#25d366' } }
  ];
  const rolar = async (sel, t, a, b, extra = 0) => {
    const k = suave(rampa(t, a, b));
    await p.evaluate(([sel, k, extra]) => {
      const el = document.querySelector(sel); if (!el) return;
      const alvo = Math.max(0, el.getBoundingClientRect().top + scrollY - 120 + extra);
      if (window.__ini === undefined) window.__ini = scrollY;
      scrollTo(0, window.__ini + (alvo - window.__ini) * k);
    }, [sel, k, extra]);
  };
  const digitar = async (sel, texto, t, a, b) => {
    const k = rampa(t, a, b);
    await p.evaluate(([sel, txt]) => { const el = document.querySelector(sel); if (el) el.value = txt; }, [sel, texto.slice(0, Math.round(texto.length * k))]);
  };

  for (const [ci, c] of cenas.entries()) {
    await p.evaluate(aba => { window.__ini = undefined; scrollTo(0, 0); location.hash = aba; }, c.aba);
    await p.waitForTimeout(700);
    let feito = {};
    for (let f = 0; f < c.dur * FPS; f++) {
      const t = f / FPS;
      if (c.aba === 'licitacoes') {
        if (t >= .8 && !feito.b) { feito.b = 1; await p.click('#buscar'); await p.waitForTimeout(1300); }
        if (t >= 2.2) await rolar('#resultado', t, 2.2, 5.6);
      }
      if (c.aba === 'fabrica') {
        await digitar('#n-nome', 'Portal do Cidadão', t, .3, 1.2);
        await digitar('#n-ped', 'Portal do cidadão com agendamento de serviços, protocolo online, consulta pelo número e painel de prazos para a prefeitura.', t, 1.2, 3.6);
        if (t >= 3.9 && !feito.ok) { feito.ok = 1; await p.click('#n-ok'); await p.waitForTimeout(500); }
        if (t >= 4.4) await rolar('#prj', t, 4.4, 5.6, -40);
      }
      if (c.aba === 'ust') await rolar('#u-dist', t, .6, 2.6);
      if (c.aba === 'financeiro') await rolar('.colunas', t, .8, 2.6, -40);
      if (c.aba === 'whatsapp') {
        await rolar('#w-chat', t, .3, 1.5, -60);
        await digitar('#w-msg', 'licitacoes', t, 1.7, 2.6);
        if (t >= 2.8 && !feito.env) { feito.env = 1; await p.press('#w-msg', 'Enter'); await p.waitForTimeout(400); }
      }
      const ultima = ci === cenas.length - 1;
      const fade = Math.max(1 - rampa(t, 0, .3), rampa(t, c.dur - (ultima ? .6 : .3), c.dur));
      await legenda(p, [Object.assign({ de: .25, ate: c.dur - .15 }, c.leg)], t, fade);
      await quadro(p);
    }
  }
}

(async () => {
  console.log('Gerando o motion em ' + QUADROS);
  const srv = await servir();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const nav = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await nav.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: ESC });
  try {
    console.log('1/4 abertura');  await cenaMarca(await ctx.newPage(), 'abertura', 4.6);
    console.log('2/4 prédio');    await cenaPredio(await ctx.newPage(), base);
    console.log('3/4 painel');    await cenaPainel(await ctx.newPage(), base);
    console.log('4/4 encerramento'); await cenaMarca(await ctx.newPage(), 'encerramento', 5.5);
  } finally { await nav.close(); srv.close(); }

  console.log('Codificando ' + n + ' quadros (' + (n / FPS).toFixed(1) + ' s)…');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(QUADROS, '%05d.jpg'),
    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
    '-profile:v', 'high', '-movflags', '+faststart', SAIDA], { stdio: 'inherit' });
  fs.rmSync(QUADROS, { recursive: true, force: true });
  console.log('Pronto: ' + SAIDA);
})().catch(e => { console.error(e); process.exit(1); });
