/* ===========================================================
   painel/util.js — utilidades comuns do Painel V4 (sem dependências)
   =========================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let DADOS = null;                       // pasta data/painel
function init(root) {
  DADOS = path.join(root, 'data', 'painel');
  fs.mkdirSync(DADOS, { recursive: true });
  return DADOS;
}
const arq = nome => path.join(DADOS, nome);

function ler(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(arq(nome), 'utf8')); }
  catch (e) { return typeof padrao === 'function' ? padrao() : padrao; }
}
/** grava em arquivo temporário e renomeia: um desligamento no meio não corrompe o JSON */
function gravar(nome, dados) {
  const f = arq(nome), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, f);
  return dados;
}

const id = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const agoraISO = () => new Date().toISOString();
const num = v => { const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const numJS = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** GET que devolve texto; segue até 3 redirecionamentos e tenta de novo em falha de rede */
function baixar(url, { timeout = 45000, tentativas = 3, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const vai = (u, redir) => {
      const mod = u.startsWith('https:') ? https : http;
      const req = mod.get(u, { headers: Object.assign({ 'User-Agent': 'V4-fabricagov-painel/1.0', 'Accept': 'application/json, */*' }, headers), timeout }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redir < 3) {
          res.resume(); return vai(new URL(res.headers.location, u).toString(), redir + 1);
        }
        const partes = [];
        res.on('data', c => partes.push(c));
        res.on('end', () => {
          const corpo = Buffer.concat(partes).toString('utf8');
          if (res.statusCode === 204) return resolve('');
          if (res.statusCode >= 500 && ++n < tentativas) return setTimeout(() => vai(u, 0), 1500 * n);
          if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' em ' + u));
          resolve(corpo);
        });
      });
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', e => { if (++n < tentativas) setTimeout(() => vai(u, 0), 1500 * n); else reject(e); });
    };
    vai(url, 0);
  });
}
async function baixarJSON(url, opts) {
  const t = await baixar(url, opts);
  return t.trim() ? JSON.parse(t) : null;
}

/** POST JSON para APIs externas (WhatsApp Cloud API) */
function postarJSON(url, corpo, headers = {}) {
  return new Promise((resolve, reject) => {
    const dados = Buffer.from(JSON.stringify(corpo));
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 30000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': dados.length }, headers) }, res => {
      let t = ''; res.on('data', c => { t += c; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(t); } catch (e) { /* texto puro */ }
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + t.slice(0, 300)));
        resolve(j || t);
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end(dados);
  });
}

/** lê o corpo da requisição (limite em bytes); devolve { bruto, json } */
function lerCorpo(req, limite = 2e6) {
  return new Promise((resolve, reject) => {
    const partes = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limite) { req.destroy(); reject(new Error('corpo grande demais')); } else partes.push(c); });
    req.on('end', () => {
      const bruto = Buffer.concat(partes);
      let json = null;
      try { json = bruto.length ? JSON.parse(bruto.toString('utf8')) : {}; } catch (e) { json = null; }
      resolve({ bruto, json });
    });
    req.on('error', reject);
  });
}

function responder(res, code, dados) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}
function enviarArquivo(res, nome, tipo, conteudo) {
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Disposition': 'attachment; filename="' + nome.replace(/"/g, '') + '"', 'Cache-Control': 'no-store' });
  res.end(conteudo);
}

/** CSV com ; (abre direto no Excel em português) */
function csv(linhas, colunas) {
  const esc = v => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [colunas.map(c => esc(c.titulo)).join(';')]
    .concat(linhas.map(l => colunas.map(c => esc(typeof c.v === 'function' ? c.v(l) : l[c.v])).join(';'))).join('\r\n');
}
/** lê CSV com ; ou , e aspas */
function lerCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(x => x !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo); if (linha.some(x => x !== '')) linhas.push(linha);
  return linhas;
}

const brl = v => 'R$ ' + numJS(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- ZIP sem compressão (método store), para baixar o código ---------- */
const TAB_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TAB_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipPasta(pasta, ignorar = /(^|\/)(node_modules|\.git|\.venv|__pycache__|dist|build)(\/|$)/) {
  const arquivos = [];
  const anda = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (ignorar.test(r)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p, r);
      else if (e.isFile() && fs.statSync(p).size < 20 * 1024 * 1024) arquivos.push({ r, buf: fs.readFileSync(p) });
    }
  };
  anda(pasta, '');
  const locais = [], centrais = []; let off = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.r, 'utf8'), crc = crc32(a.buf);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(a.buf.length, 18); h.writeUInt32LE(a.buf.length, 22); h.writeUInt16LE(nome.length, 26);
    locais.push(h, nome, a.buf);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(a.buf.length, 20); c.writeUInt32LE(a.buf.length, 24); c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(off, 42);
    centrais.push(c, nome);
    off += 30 + nome.length + a.buf.length;
  }
  const tamCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

module.exports = { init, arq, ler, gravar, id, agoraISO, num, numJS, baixar, baixarJSON, postarJSON,
                   lerCorpo, responder, enviarArquivo, csv, lerCSV, brl, semAcento, zipPasta, crc32 };
