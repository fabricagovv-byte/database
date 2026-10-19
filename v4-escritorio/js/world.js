/* ===========================================================
   world.js — a planta do prédio da V4 fábricagov
   Grade 60 x 50.  Sete salas fechadas + circulação e lobby.

   Andar (de cima para baixo, como aparece na tela):
     · Diretoria do CEO            · Fábrica de Software (dev)
     · corredor
     · Licitações · Financeiro · Comercial · (passagem) · Reunião
     · corredor
     · Games & Descanso            · Lobby com recepção e elevadores
   Em volta: calçada, rua, árvores e a entrada principal.
   =========================================================== */
const WORLD = (() => {

  const W = 76, H = 50;

  const VOID = 0, FLOOR = 1, WALL = 2, DOOR = 3;

  /* ---------- paleta ---------- */
  const C = {
    fire1: '#7c6cff', fire2: '#9d8cff', fire3: '#f59e0b',
    volt1: '#38bdf8', volt2: '#2563eb',
    dark:  '#0b0d15', wall: '#1d2230', wallTop: '#2c3346'
  };

  /* ---------- logo da V4 (PNG com fundo transparente) ---------- */
  const carrega = src => { const im = new Image(); im.src = src; return im; };
  const LOGO     = carrega('img/logo-v4-branca.png');
  const LOGO_SIM = carrega('img/v4-simbolo.png');
  const pronta   = im => im.complete && im.naturalWidth > 0;

  /* ---------- salas ---------- */
  const ROOMS = {
    diretoria: {
      id: 'diretoria', name: 'DIRETORIA · CEO', short: 'Diretoria',
      bx: 0, by: 0, bw: 15, bh: 19,
      x1: 1, y1: 1, x2: 13, y2: 17,
      accent: '#f5c542',
      floorA: '#2a2019', floorB: '#30251d',
      desc: 'Sala do CEO Arthur Miguel. Piso de madeira, mesa executiva, bandeira, troféus e a logo da V4 na parede.'
    },
    servico: {
      id: 'servico', name: 'FÁBRICA DE SOFTWARE', short: 'Dev',
      bx: 17, by: 0, bw: 43, bh: 19,
      x1: 18, y1: 1, x2: 58, y2: 17,
      accent: C.volt1,
      floorA: '#111725', floorB: '#151c2e',
      desc: 'Open space de desenvolvimento: 20 estações para agentes de todas as stacks — front, back, mobile, dados, DevOps, QA e segurança.'
    },
    licitacoes: {
      id: 'licitacoes', name: 'BUSCA DE LICITAÇÕES', short: 'Licitações',
      bx: 0, by: 22, bw: 16, bh: 13,
      x1: 1, y1: 23, x2: 14, y2: 33,
      accent: '#f97316',
      floorA: '#1f1712', floorB: '#251b15',
      desc: 'Radar de editais (PNCP, Compras.gov.br, BLL, Licitações-e), análise de edital, habilitação, proposta e pregão.'
    },
    financeiro: {
      id: 'financeiro', name: 'FINANCEIRO', short: 'Financeiro',
      bx: 15, by: 22, bw: 13, bh: 13,
      x1: 16, y1: 23, x2: 26, y2: 33,
      accent: '#22c55e',
      floorA: '#111d17', floorB: '#15231b',
      desc: 'Contas, faturamento de contratos públicos, notas fiscais, tributos e fluxo de caixa.'
    },
    comercial: {
      id: 'comercial', name: 'COMERCIAL', short: 'Comercial',
      bx: 27, by: 22, bw: 14, bh: 13,
      x1: 28, y1: 23, x2: 39, y2: 33,
      accent: '#f43f5e',
      floorA: '#1f1219', floorB: '#26161e',
      desc: 'Pré-vendas, relacionamento com órgãos públicos, atas de registro de preço e gestão de contratos.'
    },
    fabrica2: {
      id: 'fabrica2', name: 'FÁBRICA 2 · SQUADS', short: 'Squads',
      bx: 59, by: 0, bw: 17, bh: 35,
      x1: 60, y1: 1, x2: 74, y2: 33,
      accent: '#a78bfa',
      floorA: '#15132a', floorB: '#1a1733',
      desc: 'Ala leste da fábrica: 18 estações de squads especialistas — mobile nativo, legado (Delphi, COBOL), SAP, dados, IA generativa, GIS, chatbots, SRE e acessibilidade.'
    },
    reuniao: {
      id: 'reuniao', name: 'SALA DE REUNIÃO', short: 'Reunião',
      bx: 43, by: 22, bw: 17, bh: 13,
      x1: 44, y1: 23, x2: 58, y2: 33,
      accent: '#a855f7',
      floorA: '#14182a', floorB: '#191e34',
      desc: 'Mesa de dez lugares, videoconferência e painel de LED. É aqui que os agentes se reúnem.'
    },
    lounge: {
      id: 'lounge', name: 'GAMES & DESCANSO', short: 'Games',
      bx: 0, by: 38, bw: 32, bh: 12,
      x1: 1, y1: 39, x2: 30, y2: 48,
      accent: '#ec4899',
      floorA: '#1d1630', floorB: '#241b3a',
      desc: 'Fliperamas, sinuca, pebolim, pingue-pongue, videogame, puffs, cápsulas de soneca e café.'
    },
    corredor: {
      id: 'corredor', name: 'LOBBY & CIRCULAÇÃO', short: 'Lobby',
      accent: '#94a3b8',
      floorA: '#16181e', floorB: '#1a1c23',
      desc: 'Entrada principal, catracas, recepção, parede da marca e elevadores.'
    }
  };

  /* ---------- portas (x, y, orientação) ---------- */
  const DOORS = [
    { x: 14, y: 8,  o: 'v' }, { x: 14, y: 9,  o: 'v' },   // diretoria -> hall vertical
    { x: 6,  y: 18, o: 'h' }, { x: 7,  y: 18, o: 'h' },   // diretoria -> corredor
    { x: 17, y: 8,  o: 'v' }, { x: 17, y: 9,  o: 'v' },   // dev -> hall vertical
    { x: 30, y: 18, o: 'h' }, { x: 31, y: 18, o: 'h' },   // dev -> corredor
    { x: 46, y: 18, o: 'h' }, { x: 47, y: 18, o: 'h' },
    { x: 7,  y: 22, o: 'h' }, { x: 8,  y: 22, o: 'h' },   // licitações
    { x: 7,  y: 34, o: 'h' }, { x: 8,  y: 34, o: 'h' },
    { x: 21, y: 22, o: 'h' }, { x: 21, y: 34, o: 'h' },   // financeiro
    { x: 33, y: 22, o: 'h' }, { x: 33, y: 34, o: 'h' },   // comercial
    { x: 50, y: 22, o: 'h' }, { x: 51, y: 22, o: 'h' },   // reunião
    { x: 50, y: 34, o: 'h' }, { x: 51, y: 34, o: 'h' },
    { x: 10, y: 38, o: 'h' }, { x: 11, y: 38, o: 'h' },   // games
    { x: 24, y: 38, o: 'h' }, { x: 25, y: 38, o: 'h' },
    { x: 59, y: 8,  o: 'v' }, { x: 59, y: 9,  o: 'v' },   // dev -> fábrica 2
    { x: 59, y: 20, o: 'v' }, { x: 59, y: 21, o: 'v' },   // corredor -> fábrica 2
    { x: 66, y: 34, o: 'h' }, { x: 67, y: 34, o: 'h' },   // fábrica 2 -> lobby
    { x: 44, y: 49, o: 'h' }, { x: 45, y: 49, o: 'h' }, { x: 46, y: 49, o: 'h' }  // entrada do prédio
  ];

  /* ---------- grade ---------- */
  const kind   = new Uint8Array(W * H);
  const roomOf = new Array(W * H).fill(null);
  const blocked = new Uint8Array(W * H);   // móveis ocupando o tile

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  function buildGrid() {
    kind.fill(FLOOR);
    for (let i = 0; i < W * H; i++) roomOf[i] = 'corredor';

    // anel externo
    for (let x = 0; x < W; x++) { kind[idx(x, 0)] = WALL; kind[idx(x, H - 1)] = WALL; }
    for (let y = 0; y < H; y++) { kind[idx(0, y)] = WALL; kind[idx(W - 1, y)] = WALL; }

    // faixa morta entre as salas de baixo e as de cima já é corredor (y 19..21)

    for (const r of Object.values(ROOMS)) {
      if (r.bw === undefined) continue;
      const x0 = r.bx, y0 = r.by, x1 = r.bx + r.bw - 1, y1 = r.by + r.bh - 1;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (!inside(x, y)) continue;
          const borda = (x === x0 || x === x1 || y === y0 || y === y1);
          if (borda) { kind[idx(x, y)] = WALL; roomOf[idx(x, y)] = r.id; }
          else       { kind[idx(x, y)] = FLOOR; roomOf[idx(x, y)] = r.id; }
        }
      }
    }

    for (const d of DOORS) if (inside(d.x, d.y)) kind[idx(d.x, d.y)] = DOOR;
  }
  buildGrid();

  const kindAt  = (x, y) => inside(x, y) ? kind[idx(x, y)] : VOID;
  const roomAt  = (x, y) => inside(x, y) ? roomOf[idx(x, y)] : null;
  const isWall  = (x, y) => kindAt(x, y) === WALL;

  /** o tile dá para pisar? (usado pelo A*) */
  function walkable(x, y) {
    if (!inside(x, y)) return false;
    const k = kind[idx(x, y)];
    return (k === FLOOR || k === DOOR) && !blocked[idx(x, y)];
  }
  function setBlocked(x, y, v = 1) {
    if (inside(x, y)) blocked[idx(x, y)] = v;
  }

  /* ---------- alturas de parede ----------
     Uma parede que tem chão ATRÁS dela (em x-1 ou y-1) taparia
     a visão: ela vira parapeito sólido + vidro fumê por cima.
     As demais sobem inteiras e viram painel de LED / logo.        */
  const WALL_H = 108, PARAPET = 40;

  function wallOccludes(x, y) {
    const a = kindAt(x - 1, y), b = kindAt(x, y - 1);
    return a === FLOOR || a === DOOR || b === FLOOR || b === DOOR;
  }

  /* ---------- painéis nas paredes altas ---------- */
  const SIGNS = [
    { o: 'n', x: 1,  y: 0,  len: 6,  kind: 'logo'     },  // diretoria: logo da V4
    { o: 'n', x: 7,  y: 0,  len: 7,  kind: 'eventos'  },  // diretoria: próximos eventos
    { o: 'w', x: 0,  y: 2,  len: 8,  kind: 'quadro'   },  // diretoria: quadro branco
    { o: 'w', x: 0,  y: 11, len: 6,  kind: 'ceo'      },  // diretoria: placa do CEO
    { o: 'n', x: 18, y: 0,  len: 9,  kind: 'equipe'   },  // dev: a equipe agora
    { o: 'n', x: 28, y: 0,  len: 10, kind: 'logo'     },  // dev: logo grande
    { o: 'n', x: 39, y: 0,  len: 10, kind: 'pipeline' },  // dev: CI/CD
    { o: 'n', x: 50, y: 0,  len: 9,  kind: 'stack'    },  // dev: tecnologias
    { o: 'n', x: 60, y: 0,  len: 6,  kind: 'logo'     },  // fábrica 2: logo
    { o: 'n', x: 66, y: 0,  len: 9,  kind: 'stack'    },  // fábrica 2: stacks
    { o: 'w', x: 0,  y: 23, len: 10, kind: 'radar'    },  // licitações: radar de editais
    { o: 'w', x: 0,  y: 40, len: 8,  kind: 'games'    }   // games: letreiro
  ];

  /* ===========================================================
     DESENHO
     =========================================================== */

  /** superfície de parede em espaço "u (px ao longo) × v (px para baixo)" */
  function wallFace(ctx, orient, x, y, lenTiles, topZ, fn) {
    const T = ISO.TW;
    let o, a, b;
    if (orient === 'n') {                       // face virada para +y
      o = ISO.toScreen(x, y + 1, topZ);
      a =  ISO.HW / T; b =  ISO.HH / T;
    } else {                                    // 'w' — face virada para +x
      // começa na ponta de baixo e cresce subindo à direita;
      // pelo outro lado o texto sairia espelhado
      o = ISO.toScreen(x + 1, y + lenTiles, topZ);
      a =  ISO.HW / T; b = -ISO.HH / T;
    }
    ctx.save();
    ctx.transform(a, b, 0, 1, o.x, o.y);
    fn(ctx, lenTiles * T);
    ctx.restore();
  }

  /* ---- chão ----
     O piso é fixo: 1632 losangos por quadro era desperdício puro. Ele é
     pintado uma vez num canvas próprio e depois só copiado; só o brilho
     RGB refletido continua sendo calculado a cada quadro.                */
  /* margem de rua e calçada em volta do prédio, em tiles */
  const EXT = { tras: 3, frente: 9 };

  let pisoCache = null;
  function montaPiso() {
    const M0 = EXT.tras, M1 = EXT.frente;
    const x0 = ISO.toScreen(-M0, H + M1).x - ISO.TW;
    const x1 = ISO.toScreen(W + M1, -M0).x + ISO.TW;
    const y0 = ISO.toScreen(-M0, -M0).y - 4;
    const y1 = ISO.toScreen(W + M1, H + M1).y + ISO.TH + 4;
    const cv = document.createElement('canvas');
    cv.width  = Math.ceil(x1 - x0);
    cv.height = Math.ceil(y1 - y0);
    const c = cv.getContext('2d');
    c.translate(-x0, -y0);

    pintaExterior(c);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = kind[idx(x, y)];
        if (k !== FLOOR && k !== DOOR) continue;
        const r = ROOMS[roomOf[idx(x, y)]] || ROOMS.corredor;
        let col = ((x + y) & 1) ? r.floorA : r.floorB;
        if (r.id === 'diretoria') col = (y & 1) ? r.floorA : r.floorB;      // tábuas de madeira
        if (k === DOOR) col = ISO.shade(r.accent, -0.62);
        ISO.tile(c, x, y, col, 'rgba(255,255,255,.028)');
      }
    }
    // faixas guia nos corredores (da recepção até as salas)
    c.save();
    c.globalAlpha = .5;
    for (let x = 2; x <= W - 3; x++) {
      for (const yy of [20, 36]) {
        if (walkable(x, yy) && roomAt(x, yy) === 'corredor')
          ISO.tile(c, x, yy, ISO.rgba(C.volt1, .09));
      }
    }
    c.restore();

    // tapete de entrada do lobby com o símbolo da V4 pintado no piso
    ISO.plane(c, 42.5, 45.2, 6, 3.4, 0.4, 'rgba(10,12,18,.85)');
    ISO.plane(c, 42.7, 45.4, 5.6, 3.0, 0.5, null, 'rgba(255,255,255,.18)');
    pisoCache = { cv, x: x0, y: y0 };
  }

  /** calçada, grama, rua e faixa de pedestres em volta do prédio */
  function pintaExterior(c) {
    const M0 = EXT.tras, M1 = EXT.frente;
    // grama de fundo
    ISO.plane(c, -M0, -M0, W + M0 + M1, H + M0 + M1, 0, '#13261a');
    // calçada (2 tiles em volta)
    ISO.plane(c, -2, -2, W + 4, H + 4, 0, '#2b2f36');
    for (let i = -2; i < W + 2; i += 2) ISO.plane(c, i, H, .04, 2, 0.1, 'rgba(0,0,0,.25)');
    for (let j = -2; j < H + 2; j += 2) ISO.plane(c, W, j, 2, .04, 0.1, 'rgba(0,0,0,.25)');
    // meio-fio
    ISO.plane(c, -2, H + 2, W + 4, .25, 0.2, '#6b7280');
    ISO.plane(c, W + 2, -2, .25, H + 4.25, 0.2, '#6b7280');
    // ruas (frente e lateral)
    ISO.plane(c, -M0, H + 2.25, W + M0 + M1, 5.5, 0, '#1a1c21');
    ISO.plane(c, W + 2.25, -M0, 5.5, H + M0 + M1, 0, '#1a1c21');
    for (let i = -M0; i < W + M1; i += 2.4) ISO.plane(c, i, H + 4.9, 1.2, .18, 0.2, 'rgba(250,204,21,.7)');
    for (let j = -M0; j < H + 2; j += 2.4) ISO.plane(c, W + 4.9, j, .18, 1.2, 0.2, 'rgba(250,204,21,.7)');
    // faixa de pedestres na frente da entrada
    for (let i = 0; i < 6; i++) ISO.plane(c, 42.6 + i * .8, H + 2.5, .45, 5, 0.2, 'rgba(235,238,245,.75)');
    // calçada externa do outro lado da rua
    ISO.plane(c, -M0, H + 7.75, W + M0 + M1, 1.25, 0, '#2b2f36');
    ISO.plane(c, W + 7.75, -M0, 1.25, H + 7.75, 0, '#2b2f36');
  }

  function drawFloor(ctx, t) {
    if (!pisoCache) montaPiso();
    ctx.drawImage(pisoCache.cv, pisoCache.x, pisoCache.y);

    // brilho RGB refletido no piso da fábrica e da sala de games
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let x = ROOMS.servico.x1; x <= ROOMS.servico.x2; x += 7) {
      const p = ISO.toScreen(x, 1.5);
      const hue = (t * 28 + x * 14) % 360;
      ISO.glow(ctx, p.x, p.y, 120, ISO.hsl(hue, 90, 55), .07);
    }
    for (let x = ROOMS.lounge.x1; x <= ROOMS.lounge.x2; x += 8) {
      const p = ISO.toScreen(x, 44);
      const hue = (t * 44 + x * 26) % 360;
      ISO.glow(ctx, p.x, p.y, 150, ISO.hsl(hue, 95, 58), .07);
    }
    ctx.restore();
  }

  /* ---- rótulo de cada sala, pintado no piso perto da parede da frente ---- */
  function drawRoomLabels(ctx) {
    for (const r of Object.values(ROOMS)) {
      if (r.x1 === undefined) continue;
      const p = ISO.toScreen((r.x1 + r.x2 + 1) / 2, r.y2 + 0.4, 0);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '600 13px Barlow Semi Condensed, sans-serif';
      ctx.fillStyle = ISO.rgba(r.accent, .42);
      ctx.letterSpacing = '4px';
      ctx.fillText(r.name, p.x, p.y);
      ctx.restore();
    }
    const p = ISO.toScreen(46, 47.6, 0);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px Barlow Semi Condensed, sans-serif';
    ctx.fillStyle = 'rgba(203,213,225,.38)';
    ctx.letterSpacing = '4px';
    ctx.fillText('ENTRADA', p.x, p.y);
    ctx.restore();
  }

  const cacheGrad = new Map();

  /* ---- uma parede ---- */
  function drawWallTile(ctx, x, y, t, rgbOn, zoom) {
    // afastado, o vidro fumê da divisória some em menos de um pixel
    const detalhe = (zoom === undefined || zoom > 0.7);
    const occ  = wallOccludes(x, y);
    const room = ROOMS[roomOf[idx(x, y)]] || ROOMS.corredor;
    const h    = occ ? PARAPET : WALL_H;

    const showLeft  = !isWall(x, y + 1);   // face virada para +y
    const showRight = !isWall(x + 1, y);   // face virada para +x
    if (!showLeft && !showRight) {
      ISO.plane(ctx, x, y, 1, 1, WALL_H, C.wallTop);
      return;
    }

    const P = ISO.toScreen;
    const base = C.wall;

    const faces = [];
    if (showLeft)  faces.push({ o: 'n', pts: [P(x, y+1, h), P(x+1, y+1, h), P(x+1, y+1, 0), P(x, y+1, 0)], sh: -0.05 });
    if (showRight) faces.push({ o: 'w', pts: [P(x+1, y, h), P(x+1, y+1, h), P(x+1, y+1, 0), P(x+1, y, 0)], sh: -0.3  });

    for (const f of faces) {
      // corpo
      // as coordenadas da face são fixas em espaço de mundo, então o
      // gradiente pode ser criado uma vez só por tile
      const ck = x + ',' + y + ',' + f.o;
      let g = cacheGrad.get(ck);
      if (!g) {
        g = ctx.createLinearGradient(0, f.pts[0].y, 0, f.pts[2].y);
        g.addColorStop(0, ISO.shade(base, f.sh + 0.06));
        g.addColorStop(1, ISO.shade(base, f.sh - 0.28));
        cacheGrad.set(ck, g);
      }
      ISO.quad(ctx, f.pts, g);

      // rodapé com fita de LED
      if (rgbOn) {
        const hue = (t * 34 + (x + y) * 11) % 360;
        const neon = ISO.hsl(hue, 92, 58);
        const y0 = f.pts[3].y, y1 = f.pts[0].y;
        const strip = [
          f.pts[3], f.pts[2],
          { x: f.pts[2].x, y: f.pts[2].y - 5 },
          { x: f.pts[3].x, y: f.pts[3].y - 5 }
        ];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ISO.quad(ctx, strip, ISO.rgba(neon, .55));
        ctx.restore();
        void y0; void y1;
      }
    }

    // topo
    ISO.plane(ctx, x, y, 1, 1, h, occ ? ISO.rgba('#8fa4d8', .28) : C.wallTop);

    if (occ && detalhe) {
      // vidro fumê acima do parapeito
      for (const f of faces) {
        const top = [
          P(f.o === 'n' ? x : x + 1, f.o === 'n' ? y + 1 : y,     WALL_H),
          P(x + 1, y + 1, WALL_H),
          P(x + 1, y + 1, h),
          P(f.o === 'n' ? x : x + 1, f.o === 'n' ? y + 1 : y,     h)
        ];
        ISO.quad(ctx, top, ISO.rgba('#9fc4ff', .085));
        ISO.quad(ctx, top, null, ISO.rgba('#bcd8ff', .12));
      }
      ISO.plane(ctx, x, y, 1, 1, WALL_H, ISO.rgba(room.accent, rgbOn ? .30 : .12));
    }

    // trilho de LED no topo da parede — é a cara do lugar, nunca some
    if (rgbOn) {
      const hue = (t * 34 + (x + y) * 11) % 360;
      const neon = ISO.hsl(hue, 95, 60);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // a fita já brilha sozinha; um glow radial por tile custava mais
      // área pintada que a tela inteira, várias vezes por quadro
      ISO.plane(ctx, x + .02, y + .02, .96, .96, WALL_H + 2, ISO.rgba(neon, .6));
      ctx.restore();
    }

    drawSignTile(ctx, x, y, t, rgbOn);
  }

  /**
   * Fatia da placa que pertence a este tile de parede.
   * Uma placa larga tem uma profundidade só; se ela fosse um item solto na
   * ordenação, os tiles de parede depois dela pintariam por cima e a placa
   * parecia enfiada dentro da parede. Recortando por tile, cada pedaço é
   * pintado junto com a sua própria parede.
   */
  function drawSignTile(ctx, x, y, t, rgbOn) {
    for (const s of SIGNS) {
      const cobre = s.o === 'n'
        ? (s.y === y && x >= s.x && x < s.x + s.len)
        : (s.x === x && y >= s.y && y < s.y + s.len);
      if (!cobre) continue;

      // recorte por clip custava caro; agora copia só a fatia da placa que
      // é deste tile, direto do canvas em cache
      const T = ISO.TW;
      const off = s.o === 'n' ? (x - s.x) * T
                              : (s.y + s.len - 1 - y) * T;
      const cv = placaCanvas(s, t, rgbOn);
      wallFace(ctx, s.o, x, y, 1, WALL_H, (c) =>
        c.drawImage(cv, off, 0, T, WALL_H, 0, 0, T, WALL_H));
    }
  }

  /* ---- porta ---- */
  function drawDoorTile(ctx, x, y, t) {
    const d = DOORS.find(d => d.x === x && d.y === y);
    if (!d) return;
    const hue = (t * 34 + (x + y) * 11) % 360;
    const neon = ISO.hsl(hue, 95, 60);
    const P = ISO.toScreen;
    const h = 96;

    // batentes laterais
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (d.o === 'h') {
      ISO.quad(ctx, [P(x, y+1, h), P(x+1, y+1, h), P(x+1, y+1, h-4), P(x, y+1, h-4)], ISO.rgba(neon, .65));
    } else {
      ISO.quad(ctx, [P(x+1, y, h), P(x+1, y+1, h), P(x+1, y+1, h-4), P(x+1, y, h-4)], ISO.rgba(neon, .65));
    }
    const c = ISO.toScreen(x + .5, y + .5, 30);
    ISO.glow(ctx, c.x, c.y, 62, neon, .18);
    ctx.restore();
  }

  /** profundidade do painel, para ele entrar na ordenação junto com
      móveis e bonecos — senão ele seria pintado por cima de todo mundo */
  function signDepth(s) {
    return s.o === 'n' ? (s.x + s.len / 2) + (s.y + 1)
                       : (s.x + 1) + (s.y + s.len / 2);
  }

  /* ---- conteúdo de uma placa, em espaço plano de parede ---- */
  function pintaPlaca(c, s, len, t, rgbOn) {
    if (s.kind === 'nome') {
      const padY = 16, hgt = 62;
      c.fillStyle = 'rgba(4,5,10,.62)';
      ISO.rrect(c, 6, padY, len - 12, hgt, 8); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.stroke();
      signNome(c, len, padY, hgt, rgbOn);
    }
    else if (s.kind === 'equipe')  signEquipe(c, len, t, rgbOn);
    else if (s.kind === 'logo')     signLogo(c, len, rgbOn);
    else if (s.kind === 'ceo')      signCeo(c, len, rgbOn);
    else if (s.kind === 'pipeline') signPipeline(c, len, t, rgbOn);
    else if (s.kind === 'stack')    signStack(c, len, t, rgbOn);
    else if (s.kind === 'radar')    signRadar(c, len, t, rgbOn);
    else if (s.kind === 'games')    signGames(c, len, t, rgbOn);
    else if (s.kind === 'eventos') signEventos(c, len, rgbOn);
    else if (s.kind === 'quadro')  signQuadro(c, len);
  }

  /* Cada placa é pintada uma vez num canvas próprio e depois só é COPIADA
     para cada tile de parede. Antes ela era redesenhada inteira por tile —
     50 desenhos completos por quadro, vários com shadowBlur, e era daí que
     vinha quase toda a lentidão.                                          */
  const cachePlaca = new Map();
  function placaCanvas(s, t, rgbOn) {
    let c = cachePlaca.get(s);
    if (!c) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(s.len * ISO.TW); cv.height = WALL_H;
      c = { cv, ctx: cv.getContext('2d'), t: -1e9, rgb: null };
      cachePlaca.set(s, c);
    }
    // repinta no máximo ~6x por segundo; o olho não vê diferença
    const imgsOk = pronta(LOGO) && pronta(LOGO_SIM);
    if (t - c.t > 0.16 || c.t > t || c.rgb !== rgbOn || c.imgs !== imgsOk) {
      c.t = t; c.rgb = rgbOn; c.imgs = imgsOk;
      c.ctx.clearRect(0, 0, c.cv.width, c.cv.height);
      pintaPlaca(c.ctx, s, c.cv.width, t, rgbOn);
    }
    return c.cv;
  }

  /* ---- logos e painéis nas paredes altas ---- */
  function drawSigns(ctx, t, rgbOn, lista) {
    for (const s of (lista || SIGNS)) {
      const cv = placaCanvas(s, t, rgbOn);
      wallFace(ctx, s.o, s.x, s.y, s.len, WALL_H, (c) => c.drawImage(cv, 0, 0));
    }
  }

  /* ---- painel da equipe: quem está trabalhando agora ---- */
  function signEquipe(c, len, t, rgbOn) {
    const x0 = 8, y0 = 12, w = len - 16, h = 84;
    c.fillStyle = 'rgba(5,7,13,.88)';
    ISO.rrect(c, x0, y0, w, h, 8); c.fill();
    c.strokeStyle = 'rgba(56,189,248,.35)'; c.lineWidth = 1.4; c.stroke();

    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = "700 11px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = '#38bdf8'; c.letterSpacing = '2px';
    c.fillText('EQUIPE AGORA', x0 + 12, y0 + 12);
    c.letterSpacing = '0px';
    c.strokeStyle = 'rgba(255,255,255,.09)';
    c.beginPath(); c.moveTo(x0 + 10, y0 + 22); c.lineTo(x0 + w - 10, y0 + 22); c.stroke();

    const RO = (typeof ROSTER !== 'undefined') ? ROSTER : null;
    const SI = (typeof SISTEMAS !== 'undefined') ? SISTEMAS : null;
    const n = st => RO ? RO.count(st) : 0;
    const noAr = SI ? SI.todos().filter(s => s.estado === 'no ar' || s.estado === 'web').length : 0;
    const cels = [
      { r: 'TRABALHANDO', v: String(n('trabalhando') + n('reuniao')), cor: '#23e08a' },
      { r: 'DESCANSO',    v: String(n('descanso')),                   cor: '#c4b8ff' },
      { r: 'OFFLINE',     v: String(n('offline')),                    cor: '#8b93ad' },
      { r: 'SISTEMAS',    v: String(noAr),                            cor: '#38bdf8' }
    ];
    const cw = (w - 20) / cels.length;
    cels.forEach((cel, i) => {
      const cx = x0 + 10 + i * cw;
      if (i) {
        c.strokeStyle = 'rgba(255,255,255,.07)';
        c.beginPath(); c.moveTo(cx - 2, y0 + 28); c.lineTo(cx - 2, y0 + h - 8); c.stroke();
      }
      c.textAlign = 'left';
      c.font = "600 8.5px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = 'rgba(180,190,215,.75)';
      c.fillText(cel.r, cx + 8, y0 + 36);
      c.font = "700 20px 'Barlow', sans-serif";
      c.fillStyle = cel.cor;
      if (rgbOn) { c.shadowColor = ISO.rgba(cel.cor, .8); c.shadowBlur = 12; }
      c.fillText(cel.v, cx + 8, y0 + 56);
      c.shadowBlur = 0;
      const amp = rgbOn ? (.45 + .55 * Math.abs(Math.sin(t * 1.1 + i))) : .7;
      c.fillStyle = ISO.rgba(cel.cor, .5);
      c.fillRect(cx + 8, y0 + 66, (cw - 24) * amp, 2.5);
    });
  }

  /* ---- agenda de eventos da diretoria ---- */
  function signEventos(c, len, rgbOn) {
    const evs = (typeof QUADRO !== 'undefined') ? QUADRO.eventos() : [];
    const x0 = 8, y0 = 12, w = len - 16, h = 84;

    c.fillStyle = 'rgba(5,7,13,.9)';
    ISO.rrect(c, x0, y0, w, h, 8); c.fill();
    c.strokeStyle = 'rgba(56,189,248,.32)'; c.lineWidth = 1.4; c.stroke();

    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = "700 11px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = '#38bdf8'; c.letterSpacing = '2px';
    if (rgbOn) { c.shadowColor = 'rgba(56,189,248,.7)'; c.shadowBlur = 10; }
    c.fillText('PRÓXIMOS EVENTOS', x0 + 12, y0 + 13);
    c.shadowBlur = 0; c.letterSpacing = '0px';
    c.strokeStyle = 'rgba(255,255,255,.09)';
    c.beginPath(); c.moveTo(x0 + 10, y0 + 23); c.lineTo(x0 + w - 10, y0 + 23); c.stroke();

    if (!evs.length) {
      c.font = "600 10px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = 'rgba(150,160,190,.6)';
      c.fillText('nenhum evento marcado', x0 + 14, y0 + 42);
      return;
    }
    evs.slice(0, 4).forEach((e, i) => {
      const ry = y0 + 36 + i * 15;
      c.font = "700 10px 'Barlow', sans-serif";
      c.fillStyle = '#c4b8ff';
      c.fillText(e.data, x0 + 14, ry);
      c.font = "600 10px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = '#e4e9f6';
      c.fillText(e.nome, x0 + 58, ry);
      c.textAlign = 'right';
      c.font = "600 8.5px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = 'rgba(56,189,248,.8)';
      c.fillText(e.tipo, x0 + w - 14, ry);
      c.textAlign = 'left';
    });
  }

  /* ---- quadro branco de ideias ---- */
  function signQuadro(c, len) {
    const ideias = (typeof QUADRO !== 'undefined') ? QUADRO.ideias() : [];
    const x0 = 10, y0 = 10, w = len - 20, h = 88;

    // moldura de alumínio
    c.fillStyle = '#5b6377';
    ISO.rrect(c, x0 - 3, y0 - 3, w + 6, h + 6, 5); c.fill();
    // superfície branca
    const g = c.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#f6f8fb'); g.addColorStop(1, '#dde3ec');
    c.fillStyle = g;
    ISO.rrect(c, x0, y0, w, h, 3); c.fill();
    // reflexo
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath();
    c.moveTo(x0 + w * .55, y0); c.lineTo(x0 + w, y0);
    c.lineTo(x0 + w, y0 + h * .5); c.closePath(); c.fill();

    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = "700 11px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = '#d8342a'; c.letterSpacing = '1.5px';
    c.fillText('IDEIAS', x0 + 12, y0 + 14);
    c.letterSpacing = '0px';
    c.font = "600 8px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = 'rgba(70,80,100,.7)';
    c.fillText('botão 📌 Quadro', x0 + 58, y0 + 14);
    c.strokeStyle = 'rgba(216,52,42,.5)'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x0 + 12, y0 + 22); c.lineTo(x0 + w - 14, y0 + 22); c.stroke();

    const cores = ['#1f5fd0', '#1f8a4c', '#d8342a', '#7b3fc4', '#0f7f92', '#b8620a'];
    ideias.slice(0, 5).forEach((txt, i) => {
      const ry = y0 + 36 + i * 12.5;
      c.fillStyle = cores[i % cores.length];
      c.beginPath(); c.arc(x0 + 17, ry - 1, 2, 0, 7); c.fill();
      c.font = "600 10.5px 'Barlow Semi Condensed', sans-serif";
      c.fillText(txt, x0 + 25, ry);
    });
    if (!ideias.length) {
      c.font = "italic 600 10px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = 'rgba(70,80,100,.55)';
      c.fillText('quadro vazio', x0 + 25, y0 + 38);
    }
    // canetinhas na bandeja
    ['#d8342a', '#1f5fd0', '#1f8a4c'].forEach((cor, i) => {
      c.fillStyle = cor;
      ISO.rrect(c, x0 + w - 60 + i * 15, y0 + h - 8, 12, 4, 2); c.fill();
    });
  }

  /* ---- moldura escura padrão dos painéis ---- */
  function painel(c, len, cor, titulo, rgbOn) {
    const x0 = 8, y0 = 12, w = len - 16, h = 84;
    c.fillStyle = 'rgba(5,7,13,.9)';
    ISO.rrect(c, x0, y0, w, h, 8); c.fill();
    c.strokeStyle = ISO.rgba(cor, .4); c.lineWidth = 1.4; c.stroke();
    c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = "700 11px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = cor; c.letterSpacing = '2px';
    if (rgbOn) { c.shadowColor = ISO.rgba(cor, .7); c.shadowBlur = 10; }
    c.fillText(titulo, x0 + 12, y0 + 13);
    c.shadowBlur = 0; c.letterSpacing = '0px';
    c.strokeStyle = 'rgba(255,255,255,.09)';
    c.beginPath(); c.moveTo(x0 + 10, y0 + 23); c.lineTo(x0 + w - 10, y0 + 23); c.stroke();
    return { x0, y0, w, h };
  }

  /** desenha a logo da V4 centralizada numa caixa (some até a imagem carregar) */
  function desenhaLogo(c, im, cx, cy, maxW, maxH) {
    if (!pronta(im)) return;
    const k = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    c.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  }

  /* ---- logo da V4 fábricagov em painel escovado ---- */
  function signLogo(c, len, rgbOn) {
    const x0 = 6, y0 = 10, w = len - 12, h = 88;
    const g = c.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#0d0f15'); g.addColorStop(1, '#05060a');
    c.fillStyle = g; ISO.rrect(c, x0, y0, w, h, 6); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1.2; c.stroke();
    if (rgbOn) { c.shadowColor = 'rgba(160,200,255,.65)'; c.shadowBlur = 12; }
    desenhaLogo(c, LOGO, len / 2, y0 + h / 2, w - 30, h - 26);
    c.shadowBlur = 0;
  }

  /* ---- placa da sala do CEO ---- */
  function signCeo(c, len, rgbOn) {
    const E = window.ESCRITORIO || {};
    const x0 = 10, y0 = 14, w = len - 20, h = 78;
    const g = c.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#2a2112'); g.addColorStop(1, '#151008');
    c.fillStyle = g; ISO.rrect(c, x0, y0, w, h, 6); c.fill();
    c.strokeStyle = 'rgba(245,197,66,.55)'; c.lineWidth = 1.6; c.stroke();
    desenhaLogo(c, LOGO_SIM, x0 + 34, y0 + h / 2, 44, 34);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = "700 19px 'Barlow', sans-serif";
    c.fillStyle = '#f5c542';
    if (rgbOn) { c.shadowColor = 'rgba(245,197,66,.6)'; c.shadowBlur = 10; }
    c.fillText(String(E.dono || 'Arthur Miguel').toUpperCase(), x0 + 66, y0 + 30);
    c.shadowBlur = 0;
    c.font = "600 10px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = 'rgba(245,230,200,.75)'; c.letterSpacing = '2px';
    c.fillText('CEO & FUNDADOR', x0 + 66, y0 + 50);
    c.letterSpacing = '0px';
  }

  /* ---- esteira de CI/CD da fábrica ---- */
  function signPipeline(c, len, t, rgbOn) {
    const p = painel(c, len, '#38bdf8', 'ESTEIRA CI/CD', rgbOn);
    const etapas = ['COMMIT', 'BUILD', 'TESTES', 'SEGURANÇA', 'HOMOLOG.', 'PRODUÇÃO'];
    const n = etapas.length, cw = (p.w - 24) / n;
    const ciclo = (t * 0.35) % (n + 1);
    etapas.forEach((e, i) => {
      const cx = p.x0 + 12 + i * cw + cw / 2, cy = p.y0 + 50;
      const feito = i < Math.floor(ciclo), atual = i === Math.floor(ciclo);
      const cor = feito ? '#23e08a' : atual ? '#38bdf8' : '#3a4256';
      if (i) {
        c.strokeStyle = feito ? 'rgba(35,224,138,.6)' : 'rgba(120,130,160,.3)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(cx - cw + 10, cy); c.lineTo(cx - 10, cy); c.stroke();
      }
      c.fillStyle = cor;
      if (rgbOn && (atual || feito)) { c.shadowColor = cor; c.shadowBlur = atual ? 14 : 6; }
      c.beginPath(); c.arc(cx, cy, atual ? 7 + Math.sin(t * 6) * 1.2 : 6, 0, 7); c.fill();
      c.shadowBlur = 0;
      c.textAlign = 'center';
      c.font = "600 8.5px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = feito || atual ? '#e4e9f6' : 'rgba(150,160,190,.6)';
      c.fillText(e, cx, cy + 20);
    });
    c.textAlign = 'right';
    c.font = "600 8.5px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = 'rgba(56,189,248,.8)';
    c.fillText('deploy contínuo · gov.br', p.x0 + p.w - 14, p.y0 + 13);
  }

  /* ---- stacks que a fábrica domina ---- */
  function signStack(c, len, t, rgbOn) {
    const p = painel(c, len, '#a78bfa', 'STACKS DA FÁBRICA', rgbOn);
    const st = [['React', '#61dafb'], ['Angular', '#dd0031'], ['Node.js', '#3c873a'], ['Python', '#ffd43b'],
                ['Java', '#f89820'], ['.NET', '#9b4dca'], ['PHP', '#8892bf'], ['Go', '#00add8'],
                ['Flutter', '#47c5fb'], ['SQL', '#e4e9f6'], ['Docker', '#2496ed'], ['K8s', '#326ce5']];
    const cols = 4, cw = (p.w - 24) / cols;
    st.forEach(([nm, cor], i) => {
      const cx = p.x0 + 14 + (i % cols) * cw, cy = p.y0 + 36 + Math.floor(i / cols) * 17;
      c.fillStyle = cor;
      if (rgbOn) { c.shadowColor = cor; c.shadowBlur = 6 + 4 * Math.abs(Math.sin(t + i)); }
      ISO.rrect(c, cx, cy - 4, 8, 8, 2); c.fill();
      c.shadowBlur = 0;
      c.textAlign = 'left';
      c.font = "600 10px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = '#e4e9f6';
      c.fillText(nm, cx + 13, cy);
    });
  }

  /* ---- radar de licitações: portais que os agentes monitoram ---- */
  function signRadar(c, len, t, rgbOn) {
    const cor = '#f97316';
    const p = painel(c, len, cor, 'RADAR DE LICITAÇÕES', rgbOn);
    // radar girando
    const rx = p.x0 + 52, ry = p.y0 + 56, R = 26;
    c.strokeStyle = 'rgba(249,115,22,.35)'; c.lineWidth = 1;
    for (const k of [1, .66, .33]) { c.beginPath(); c.arc(rx, ry, R * k, 0, 7); c.stroke(); }
    c.beginPath(); c.moveTo(rx - R, ry); c.lineTo(rx + R, ry); c.moveTo(rx, ry - R); c.lineTo(rx, ry + R); c.stroke();
    const ang = (t * 1.6) % (Math.PI * 2);
    const g = c.createRadialGradient(rx, ry, 0, rx, ry, R);
    g.addColorStop(0, 'rgba(249,115,22,.55)'); g.addColorStop(1, 'rgba(249,115,22,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(rx, ry); c.arc(rx, ry, R, ang - .7, ang); c.closePath(); c.fill();
    [[.5, 1.1], [.8, 3.3], [.35, 4.6], [.7, 5.6]].forEach(([d, a]) => {
      const vis = ((ang - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) < 2.4;
      c.fillStyle = vis ? '#ffd7b0' : 'rgba(249,115,22,.25)';
      c.beginPath(); c.arc(rx + Math.cos(a) * R * d, ry + Math.sin(a) * R * d, 2.2, 0, 7); c.fill();
    });
    // portais
    const portais = ['PNCP', 'Compras.gov.br', 'BLL Compras', 'Licitações-e', 'Portais estaduais'];
    portais.forEach((nm, i) => {
      const ly = p.y0 + 33 + i * 12;
      const on = Math.sin(t * 3 + i * 1.3) > -.3;
      c.fillStyle = on ? '#23e08a' : 'rgba(35,224,138,.3)';
      c.beginPath(); c.arc(p.x0 + 104, ly, 2.6, 0, 7); c.fill();
      c.textAlign = 'left';
      c.font = "600 10px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = '#e4e9f6'; c.fillText(nm, p.x0 + 112, ly);
      c.textAlign = 'right';
      c.font = "600 8.5px 'Barlow Semi Condensed', sans-serif";
      c.fillStyle = 'rgba(249,115,22,.85)'; c.fillText('monitorando', p.x0 + p.w - 14, ly);
    });
  }

  /* ---- letreiro neon da sala de games ---- */
  function signGames(c, len, t, rgbOn) {
    const neon = ISO.hsl((t * 40) % 360, 95, 62);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = "700 30px 'Barlow', sans-serif";
    if (rgbOn) { c.shadowColor = neon; c.shadowBlur = 18; }
    c.fillStyle = rgbOn ? neon : '#ec4899'; c.letterSpacing = '4px';
    c.fillText('GAME ZONE', len / 2, 42);
    c.shadowBlur = 0;
    c.font = "600 11px 'Barlow Semi Condensed', sans-serif";
    c.fillStyle = 'rgba(240,220,255,.75)'; c.letterSpacing = '3px';
    c.fillText('RECARREGUE · JOGUE · DESCANSE', len / 2, 70);
    c.letterSpacing = '0px';
  }

  /* ---- placa com o nome do escritório (data/config.json) ---- */
  function signNome(c, len, y0, h, rgbOn) {
    const E = window.ESCRITORIO || {};
    const nome = String(E.nome || 'V4 fábricagov').toUpperCase();
    const cx = len / 2, cy = y0 + h / 2;
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let tam = 26;
    c.font = `700 ${tam}px 'Barlow', sans-serif`;
    while (tam > 10 && c.measureText(nome).width > len - 36) { tam--; c.font = `700 ${tam}px 'Barlow', sans-serif`; }
    c.fillStyle = '#ffffff';
    if (rgbOn) { c.shadowColor = 'rgba(124,108,255,.8)'; c.shadowBlur = 14; }
    c.fillText(nome, cx, cy - 6);
    c.shadowBlur = 0;
    if (E.subtitulo) {
      c.font = `500 ${Math.min(10, len / 22)}px 'Barlow Semi Condensed', sans-serif`;
      c.fillStyle = 'rgba(200,210,235,.6)'; c.letterSpacing = '2px';
      c.fillText(String(E.subtitulo).toUpperCase().slice(0, 48), cx, cy + 16);
    }
    c.restore();
  }


  /* ---- luminárias e detalhes de teto no chão (decalques) ---- */
  function drawDecals(ctx, t) { /* piso liso: sem logo pintado */ }

  /* ---------- pontos de interesse ---------- */
  const SPAWN = { x: 45, y: 48 };          // porta de entrada do prédio

  return {
    W, H, VOID, FLOOR, WALL, DOOR, C,
    ROOMS, DOORS, SPAWN, WALL_H, PARAPET, EXT, LOGO, LOGO_SIM, pronta, desenhaLogo,
    SIGNS, signDepth,
    kindAt, roomAt, isWall, walkable, setBlocked, wallOccludes,
    drawFloor, drawWallTile, drawDoorTile, drawSigns, drawDecals, drawRoomLabels,
    wallFace
  };
})();
