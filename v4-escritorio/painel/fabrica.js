/* ===========================================================
   painel/fabrica.js — a Fábrica de Software da V4

   Você descreve o sistema; o squad monta. Cada pedido vira:
     1. uma pasta em projetos/<nome>
     2. um agente do Claude Code que SÓ lê e escreve arquivos nessa pasta
        (sem terminal: ele não executa nada sozinho)
     3. v4.json + README + RELATORIO.md + testes
     4. o sistema registrado no escritório, no computador do tech lead
   Rodar os testes e ligar a prévia são botões seus: nada do código gerado
   é executado sem você clicar. Vários pedidos andam em paralelo, com limite.
   =========================================================== */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const IA = require('./ia');

let D = null;     // { ROOT, novoSistema, tirarSistema, equipe, gravarEquipe, portaLivre, avisar }
let PASTA = null;
function init(dep) {
  D = dep;
  PASTA = path.join(dep.ROOT, 'projetos');
  fs.mkdirSync(PASTA, { recursive: true });
  // pedido que estava rodando quando o escritório caiu não está mais rodando
  const p = lerProjetos();
  for (const x of Object.values(p.itens)) if (x.status === 'gerando' || x.status === 'ajustando') {
    x.status = 'interrompido'; logar(x, 'o escritório reiniciou no meio do trabalho — clique em Retomar');
  }
  U.gravar('projetos.json', p);
}

const CONFIG_PADRAO = { paralelo: 2, horasPorUST: 1, modelo: '' };
const config = () => Object.assign({}, CONFIG_PADRAO, U.ler('fabrica-config.json', {}));
const configurar = c => U.gravar('fabrica-config.json', Object.assign(config(), {
  paralelo: Math.max(1, Math.min(4, Number(c.paralelo) || 2)), horasPorUST: Math.max(0.1, Number(c.horasPorUST) || 1),
  modelo: String(c.modelo || '').replace(/[^a-z0-9.\-]/gi, '').slice(0, 40) }));

const lerProjetos = () => U.ler('projetos.json', { itens: {} });
function salvarProjeto(p) { const d = lerProjetos(); d.itens[p.id] = p; U.gravar('projetos.json', d); return p; }
function logar(p, txt) {
  p.log = p.log || [];
  p.log.push({ t: Date.now(), txt: String(txt).slice(0, 400) });
  if (p.log.length > 400) p.log.splice(0, p.log.length - 400);
}

/* ---------- squad: quem do time pega o pedido ---------- */
const PAPEIS = [
  { re: /./, chaves: ['techlead', 'arquiteto'] },
  { re: /tela|site|portal|web|painel|dashboard|front|formul|cidad/i, chaves: ['frontend', 'vue', 'nextjs', 'ux'] },
  { re: /api|servidor|back|integra|cadastro|sistema/i, chaves: ['node', 'java', 'dotnet', 'python', 'golang', 'php'] },
  { re: /banco|dados|relat[óo]rio|cadastro|sql/i, chaves: ['dba', 'engdados'] },
  { re: /app|celular|mobile|android|ios/i, chaves: ['mobile', 'kotlin', 'swift'] },
  { re: /\bbi\b|indicador|gr[áa]fico|painel|\bia\b|intelig/i, chaves: ['dados', 'powerbi', 'llm'] },
  { re: /gov\.br|login|assinatura|siafi|e-sus|receita/i, chaves: ['integracoes'] },
  { re: /mapa|geo|territ/i, chaves: ['gis'] },
  { re: /whats|chat|bot|atendimento/i, chaves: ['chatbot'] },
  { re: /./, chaves: ['qa', 'seguranca'] }
];
function montarSquad(pedido) {
  const time = (D.equipe() || []).filter(a => !a.boss && (a.dept === 'servico' || a.dept === 'fabrica2'));
  const ocupados = new Set(Object.values(lerProjetos().itens).filter(p => ['gerando', 'ajustando', 'na fila'].includes(p.status))
    .flatMap(p => (p.squad || []).map(s => s.id)));
  const squad = [];
  for (const papel of PAPEIS) {
    if (!papel.re.test(pedido)) continue;
    const cand = papel.chaves.map(k => time.find(a => a.key === k)).filter(Boolean);
    const escolhido = cand.find(a => !ocupados.has(a.id) && !squad.includes(a)) || cand.find(a => !squad.includes(a));
    if (escolhido) squad.push(escolhido);
    if (squad.length >= 6) break;
  }
  return squad.map(a => ({ id: a.id, nome: a.name, papel: a.role }));
}

const slug = t => U.semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sistema';

function criar(b) {
  const pedido = String(b.pedido || '').trim();
  if (pedido.length < 15) throw new Error('descreva o sistema com um pouco mais de detalhe (mínimo 15 caracteres)');
  const nome = String(b.nome || '').trim().slice(0, 60) || pedido.split(/[.,\n]/)[0].slice(0, 50);
  let s = slug(nome), n = 2;
  const usados = new Set(Object.values(lerProjetos().itens).map(p => p.slug));
  while (fs.existsSync(path.join(PASTA, s)) || usados.has(s)) s = slug(nome) + '-' + n++;
  const p = {
    id: U.id('prj-'), slug: s, nome, pedido, cliente: String(b.cliente || '').slice(0, 120),
    licitacaoId: b.licitacaoId || null, prioridade: Number(b.prioridade) || 2,
    squad: montarSquad(pedido + ' ' + (b.stack || '')), stack: String(b.stack || '').slice(0, 200),
    status: 'na fila', criadoEm: U.agoraISO(), log: [], custo: 0, ajustes: []
  };
  logar(p, 'pedido recebido · squad: ' + (p.squad.map(x => x.nome + ' (' + x.papel + ')').join(', ') || 'a definir'));
  salvarProjeto(p);
  setImmediate(girarFila);
  return p;
}

/* ---------- fila ---------- */
const rodando = new Map();      // id -> processo do agente
function girarFila() {
  const lim = config().paralelo;
  const fila = Object.values(lerProjetos().itens).filter(p => p.status === 'na fila' && !rodando.has(p.id))
    .sort((a, b) => a.prioridade - b.prioridade || a.criadoEm.localeCompare(b.criadoEm));
  while (rodando.size < lim && fila.length) {
    const p = fila.shift();
    executar(p.id, null).catch(e => console.error('  fábrica:', e.message));
  }
}

function instrucoes(p, porta) {
  const H = config().horasPorUST;
  return `Você é o squad da Fábrica de Software da V4 fábricagov (softhouse para órgãos públicos).
Squad deste pedido: ${p.squad.map(s => s.nome + ' — ' + s.papel).join('; ') || 'time da fábrica'}.

PEDIDO DO CEO:
"""${p.pedido}"""
${p.stack ? 'Preferência de tecnologia: ' + p.stack + '\n' : ''}${p.cliente ? 'Órgão/cliente: ' + p.cliente + '\n' : ''}
Escreva o código do sistema COMPLETO nesta pasta (diretório atual). Você só tem ferramentas de ler e escrever arquivos; quem executa os testes e liga o sistema é o CEO, pelo painel. Regras:
1. Tem que rodar só com Node.js 18+ e "node server.js", sem instalar nada (só módulos nativos: http, fs, path, crypto). Se precisar de banco, use arquivos JSON numa pasta data/. Front-end em HTML/CSS/JS puro servido pelo próprio server.js.
2. O server.js escuta em process.env.PORT (padrão ${porta}) e só em 127.0.0.1.
3. Crie v4.json: {"nome": "...", "descricao": "uma frase", "comando": "node", "args": ["server.js"], "porta": ${porta}, "abre": "/"}.
4. Visual profissional e acessível (padrão gov.br/eMAG: contraste, rótulos, navegação por teclado), responsivo no celular.
5. Dados de exemplo claramente marcados como exemplo. Nada de dado pessoal real. Senhas com hash (crypto.scrypt) se houver login.
6. Testes com node:test em tests/*.test.js que sobem o servidor numa porta livre e testam as rotas principais. Revise o código com cuidado: o painel roda "node --test" em cada arquivo de tests/.
7. README.md: o que é e como rodar. RELATORIO.md: funcionalidades entregues, arquitetura, telas, testes escritos, pendências, e uma tabela de esforço em UST por atividade (1 UST = ${H} hora(s) de trabalho técnico) com o total.
Entregue algo que funciona de ponta a ponta antes de enfeitar.

No final responda SOMENTE com JSON: {"resumo":"2-3 frases","funcionalidades":["..."],"ust":número total,"pendencias":["..."]}`;
}

async function executar(idP, ajuste) {
  const d = lerProjetos(); const p = d.itens[idP];
  if (!p) throw new Error('projeto não encontrado');
  if (rodando.has(idP)) throw new Error('esse projeto já está rodando');
  rodando.set(idP, null);
  const pasta = path.join(PASTA, p.slug);
  fs.mkdirSync(pasta, { recursive: true });
  if (!p.porta) p.porta = await D.portaLivre(4501, Object.values(d.itens).map(x => x.porta).filter(Boolean));
  p.status = ajuste ? 'ajustando' : 'gerando';
  p.inicio = p.inicio || U.agoraISO();
  if (ajuste) { p.ajustes.push({ quando: U.agoraISO(), texto: ajuste }); logar(p, '✏️ ajuste pedido: ' + ajuste); }
  else logar(p, '🚀 squad começou a construir em projetos/' + p.slug);
  salvarProjeto(p);

  let ultimoGravar = 0;
  const prompt = ajuste
    ? `O CEO pediu este ajuste no sistema desta pasta:\n"""${ajuste}"""\nFaça o ajuste (só lendo e escrevendo arquivos), atualize os testes e o RELATORIO.md (inclua o ajuste e as UST dele) e responda SOMENTE com o mesmo formato JSON de antes, com "ust" sendo só o esforço deste ajuste.`
    : instrucoes(p, p.porta);
  const r = await IA.rodar({
    prompt, cwd: pasta, modo: 'acceptEdits', resume: ajuste ? p.sessao : null, modelo: config().modelo || null,
    // só arquivos: sem terminal, sem internet
    ferramentas: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite'],
    limiteMs: 40 * 60000,
    aoProcesso: proc => rodando.set(idP, proc),
    aoEvento: ev => {
      const linhas = IA.descreverEvento(ev);
      if (!linhas) return;
      const atual = lerProjetos().itens[idP] || p;
      for (const l of linhas) logar(atual, l);
      if (Date.now() - ultimoGravar > 1500) { ultimoGravar = Date.now(); salvarProjeto(atual); }
    }
  });
  rodando.delete(idP);

  const fim = lerProjetos().itens[idP] || p;
  fim.sessao = r.sessao || fim.sessao;
  fim.custo = (fim.custo || 0) + (r.custo || 0);
  if (fim.status === 'cancelado') { salvarProjeto(fim); setImmediate(girarFila); return fim; }
  if (!r.ok) {
    fim.status = 'erro'; fim.erro = r.motivo; logar(fim, '❌ ' + r.motivo);
    salvarProjeto(fim); setImmediate(girarFila);
    return fim;
  }
  const res = IA.extrairJSON(r.texto) || { resumo: r.texto.slice(0, 600) };
  const ust = U.numJS(res.ust);
  if (ajuste) {
    fim.ajustes[fim.ajustes.length - 1].ust = ust; fim.ust = U.numJS(fim.ust) + ust;
    fim.entrega = Object.assign({}, fim.entrega || {}, { resumo: res.resumo || (fim.entrega || {}).resumo });
  } else { fim.ust = ust; fim.entrega = res; }
  fim.fim = U.agoraISO();
  Object.assign(fim, contarCodigo(pasta));
  fim.status = fs.existsSync(path.join(pasta, 'server.js')) ? 'pronto' : 'erro';
  if (fim.status === 'erro') fim.erro = 'o squad terminou sem criar server.js';
  fim.testes = null;          // código mudou: testes precisam rodar de novo
  logar(fim, fim.status === 'pronto' ? '✅ código entregue: ' + (res.resumo || '') + ' — clique em Rodar testes e em Ligar prévia' : '❌ ' + fim.erro);
  if (fim.status === 'pronto') registrar(fim, pasta);
  salvarProjeto(fim);
  if (D.avisar) D.avisar('Fábrica V4: ' + fim.nome + (fim.status === 'pronto' ? ' pronto' : ' com erro'),
    (fim.status === 'pronto' ? (res.resumo || '') + '\nUST: ' + fim.ust : fim.erro)).catch(() => {});
  setImmediate(girarFila);
  return fim;
}

/* ---------- testes: só quando o CEO clica ---------- */
function rodarTestes(idP) {
  const d = lerProjetos(); const p = d.itens[idP];
  if (!p) return Promise.reject(new Error('projeto não encontrado'));
  if (rodando.has(idP)) return Promise.reject(new Error('o squad ainda está escrevendo esse projeto'));
  const pasta = path.join(PASTA, p.slug);
  if (!fs.existsSync(path.join(pasta, 'tests'))) return Promise.reject(new Error('o projeto não tem pasta tests/'));
  return new Promise(resolve => {
    let saida = '';
    // lista os arquivos: "node --test pasta/" não funciona em todas as versões do Node
    const arquivos = fs.readdirSync(path.join(pasta, 'tests')).filter(f => /\.(test\.)?[cm]?js$/.test(f)).map(f => path.join('tests', f));
    if (!arquivos.length) return resolve({ ok: false, passaram: 0, falharam: 0, saida: 'nenhum arquivo .js em tests/' });
    const proc = spawn(process.execPath, ['--test', ...arquivos], { cwd: pasta, env: Object.assign({}, process.env, { PORT: '0' }) });
    const prazo = setTimeout(() => { try { proc.kill(); } catch (e) {} saida += '\n(interrompido: passou de 3 minutos)'; }, 3 * 60000);
    proc.stdout.on('data', x => { saida += x; }); proc.stderr.on('data', x => { saida += x; });
    proc.on('exit', code => {
      clearTimeout(prazo);
      const n = re => { const m = saida.match(re); return m ? Number(m[1]) : 0; };
      const t = { quando: U.agoraISO(), ok: code === 0 && n(/# fail (\d+)/) === 0, passaram: n(/# pass (\d+)/), falharam: n(/# fail (\d+)/), saida: saida.slice(-12000) };
      const atual = lerProjetos(); const x = atual.itens[idP];
      x.testes = t; logar(x, (t.ok ? '🧪 testes ok: ' : '🧪 testes falharam: ') + t.passaram + ' passaram, ' + t.falharam + ' falharam');
      U.gravar('projetos.json', atual);
      resolve(t);
    });
    proc.on('error', e => { clearTimeout(prazo); resolve({ ok: false, saida: e.message }); });
  });
}

function contarCodigo(pasta) {
  let arquivos = 0, linhas = 0;
  const anda = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) anda(f);
      else if (/\.(js|mjs|ts|html|css|json|md|py|sql)$/i.test(e.name)) {
        arquivos++; try { linhas += fs.readFileSync(f, 'utf8').split('\n').length; } catch (x) {}
      }
    }
  };
  try { anda(pasta); } catch (e) {}
  return { arquivos, linhas };
}

/** põe o sistema no registro do escritório e no computador do tech lead do squad */
function registrar(p, pasta) {
  if (p.sistemaId) return;
  let man = {};
  try { man = JSON.parse(fs.readFileSync(path.join(pasta, 'v4.json'), 'utf8')); } catch (e) { /* usa o padrão */ }
  const r = D.novoSistema({ id: 'v4-' + p.slug, nome: String(man.nome || p.nome).slice(0, 60), tipo: 'local', pasta, comando: 'node',
                            args: 'server.js', porta: p.porta, abre: man.abre || '/', sobre: man.descricao || p.pedido.slice(0, 300) });
  if (!r.ok) { logar(p, '⚠️ não registrei no escritório: ' + r.motivo); return; }
  p.sistemaId = r.id;
  const time = D.equipe();
  const lider = p.squad[0] && time.find(a => a.id === p.squad[0].id);
  if (lider) { lider.sistema = r.id; lider.system = man.nome || p.nome; D.gravarEquipe(time); logar(p, '🖥️ o computador de ' + lider.name + ' agora abre este sistema'); }
}

function cancelar(idP) {
  const proc = rodando.get(idP);
  const d = lerProjetos(); const p = d.itens[idP]; if (!p) return null;
  if (['na fila', 'gerando', 'ajustando'].includes(p.status)) { p.status = 'cancelado'; logar(p, '⏹ cancelado pelo CEO'); }
  U.gravar('projetos.json', d);
  if (proc && proc.kill) { try { proc.kill(); } catch (e) {} }
  return p;
}
function retomar(idP) {
  const d = lerProjetos(); const p = d.itens[idP]; if (!p) return null;
  if (['erro', 'cancelado', 'interrompido'].includes(p.status)) { p.status = 'na fila'; logar(p, '↻ voltou para a fila'); }
  U.gravar('projetos.json', d); setImmediate(girarFila); return p;
}
function ajustar(idP, texto) {
  texto = String(texto || '').trim();
  if (texto.length < 5) throw new Error('descreva o ajuste');
  const p = lerProjetos().itens[idP]; if (!p) throw new Error('projeto não encontrado');
  if (!p.sessao) throw new Error('esse projeto ainda não tem sessão para continuar — retome primeiro');
  if (rodando.has(idP)) throw new Error('o squad ainda está trabalhando nesse projeto');
  executar(idP, texto).catch(e => console.error('  fábrica ajuste:', e.message));
  return { ok: true };
}
function apagar(idP) {
  cancelar(idP);
  const d = lerProjetos(); const p = d.itens[idP]; if (!p) return false;
  if (p.sistemaId && D.tirarSistema) D.tirarSistema(p.sistemaId);
  delete d.itens[idP]; U.gravar('projetos.json', d);
  return true;   // a pasta do código fica: apagar código é decisão sua, no disco
}

function lista() {
  return Object.values(lerProjetos().itens).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .map(p => Object.assign({}, p, { log: (p.log || []).slice(-6), testes: p.testes ? Object.assign({}, p.testes, { saida: undefined }) : null,
                                     rodando: rodando.has(p.id) }));
}
function detalhe(idP) {
  const p = lerProjetos().itens[idP]; if (!p) return null;
  const pasta = path.join(PASTA, p.slug);
  const leia = f => { try { return fs.readFileSync(path.join(pasta, f), 'utf8').slice(0, 200000); } catch (e) { return null; } };
  const arvore = [];
  const anda = (dir, rel) => { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) anda(path.join(dir, e.name), r); else arvore.push(r);
  } } catch (x) {} };
  anda(pasta, '');
  return Object.assign({}, p, { relatorio: leia('RELATORIO.md'), readme: leia('README.md'), arvore: arvore.slice(0, 400), pasta,
                                rodando: rodando.has(p.id) });
}
function lerArquivo(idP, rel) {
  const p = lerProjetos().itens[idP]; if (!p) return null;
  const base = path.join(PASTA, p.slug);
  const alvo = path.normalize(path.join(base, String(rel || '')));
  if (!alvo.startsWith(base + path.sep)) return null;
  try { const st = fs.statSync(alvo); if (st.size > 500000) return '(arquivo grande demais para mostrar)'; return fs.readFileSync(alvo, 'utf8'); }
  catch (e) { return null; }
}
function zip(idP) {
  const p = lerProjetos().itens[idP]; if (!p) return null;
  return { nome: p.slug + '.zip', buf: U.zipPasta(path.join(PASTA, p.slug)) };
}

module.exports = { init, config, configurar, criar, lista, detalhe, lerArquivo, zip, cancelar, retomar, ajustar, apagar,
                   girarFila, montarSquad, rodarTestes };
