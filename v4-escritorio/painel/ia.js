/* ===========================================================
   painel/ia.js — roda o Claude Code (CLI) desta máquina.

   É o mesmo claude que o escritório já usa para conversar com os agentes.
   O prompt vai pela entrada padrão, nunca pela linha de comando, então não
   há escape nenhum a fazer. Sem shell: argumentos chegam intactos.
   =========================================================== */
const { spawn } = require('child_process');

let BIN = 'claude';
let VAZIA = null;
function init(bin, pastaVazia) { BIN = bin || BIN; VAZIA = pastaVazia || VAZIA; }

/* Para ler edital ou escrever e-mail o agente não precisa da máquina: roda
   numa pasta vazia, nega tudo que não foi liberado (dontAsk) e ainda tem
   arquivos e terminal bloqueados — texto de edital não vira ordem aqui. */
const SEM_MAQUINA = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Task', 'WebSearch'];
function consultar(prompt, { web = false, limiteMs, aoEvento } = {}) {
  return rodar({ prompt, cwd: VAZIA || undefined, modo: 'dontAsk', ferramentas: web ? ['WebFetch'] : [],
                 bloquear: web ? SEM_MAQUINA : SEM_MAQUINA.concat('WebFetch'), limiteMs, aoEvento });
}

/**
 * @param o.prompt        texto do pedido
 * @param o.cwd           pasta onde o agente trabalha
 * @param o.modo          'plan' (só lê) | 'acceptEdits' (escreve arquivos)
 * @param o.ferramentas   lista para --allowedTools
 * @param o.sistema       texto extra de sistema (--append-system-prompt)
 * @param o.resume        session_id para continuar uma conversa
 * @param o.aoEvento      callback(evento) com o progresso em tempo real
 * @param o.limiteMs      prazo máximo
 */
function rodar(o) {
  return new Promise(resolve => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
                  '--permission-mode', o.modo || 'plan'];
    if (o.ferramentas && o.ferramentas.length) args.push('--allowedTools', o.ferramentas.join(','));
    if (o.bloquear && o.bloquear.length) args.push('--disallowedTools', o.bloquear.join(','));
    if (o.sistema) args.push('--append-system-prompt', o.sistema);
    if (o.resume) args.push('--resume', o.resume);
    if (o.modelo) args.push('--model', o.modelo);

    let proc;
    try {
      proc = spawn(BIN, args, { cwd: o.cwd || process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, motivo: 'não consegui executar o claude: ' + e.message });
    }
    if (o.aoProcesso) o.aoProcesso(proc);
    let resto = '', erro = '', final = null, sessao = null;
    const prazo = setTimeout(() => { try { proc.kill(); } catch (e) {} }, o.limiteMs || 10 * 60000);

    proc.stdin.on('error', () => {});
    proc.stdin.end(o.prompt, 'utf8');
    proc.stdout.on('data', d => {
      resto += d;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, i).trim(); resto = resto.slice(i + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch (e) { continue; }
        if (ev.session_id) sessao = ev.session_id;
        if (ev.type === 'result') final = ev;
        if (o.aoEvento) { try { o.aoEvento(ev); } catch (e) { /* quem escuta não derruba o agente */ } }
      }
    });
    proc.stderr.on('data', d => { erro += d; });
    proc.on('error', e => { clearTimeout(prazo); resolve({ ok: false, motivo: 'não consegui executar o claude: ' + e.message + ' — o Claude Code está instalado?' }); });
    proc.on('exit', code => {
      clearTimeout(prazo);
      const texto = final ? String(final.result || '') : '';
      if (/not logged in|please run \/login|invalid api key/i.test(texto + erro))
        return resolve({ ok: false, motivo: 'O Claude Code não está autenticado nesta máquina. Rode "claude" no terminal e faça login.' });
      if (!final) return resolve({ ok: false, motivo: (erro || 'o agente parou sem resposta (código ' + code + ')').slice(-600), sessao });
      resolve({ ok: !final.is_error, texto, sessao, custo: final.total_cost_usd || 0, duracaoMs: final.duration_ms || 0,
                motivo: final.is_error ? texto.slice(0, 600) : null });
    });
  });
}

/** resumo de uma linha para mostrar o que o agente está fazendo agora */
function descreverEvento(ev) {
  if (ev.type !== 'assistant' || !ev.message || !Array.isArray(ev.message.content)) return null;
  const out = [];
  for (const c of ev.message.content) {
    if (c.type === 'tool_use') {
      const i = c.input || {};
      const alvo = i.file_path || i.path || i.command || i.pattern || i.url || '';
      const nomes = { Write: 'criando', Edit: 'editando', MultiEdit: 'editando', Read: 'lendo', Bash: 'rodando',
                      Glob: 'procurando', Grep: 'procurando', WebFetch: 'consultando', TodoWrite: 'planejando' };
      out.push((nomes[c.name] || c.name) + (alvo ? ' ' + String(alvo).replace(/\s+/g, ' ').slice(0, 140) : ''));
    } else if (c.type === 'text' && c.text && c.text.trim()) {
      out.push('💬 ' + c.text.trim().replace(/\s+/g, ' ').slice(0, 220));
    }
  }
  return out.length ? out : null;
}

/** extrai o primeiro bloco JSON de um texto (o modelo às vezes cerca com ```json) */
function extrairJSON(texto) {
  const m = String(texto || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  const alvo = m ? m[1] : String(texto || '');
  const ini = alvo.search(/[\[{]/);
  if (ini < 0) return null;
  const fecha = alvo[ini] === '{' ? '}' : ']';
  // tenta do fecho mais distante para o mais próximo
  for (let fim = alvo.lastIndexOf(fecha); fim > ini; fim = alvo.lastIndexOf(fecha, fim - 1)) {
    try { return JSON.parse(alvo.slice(ini, fim + 1)); } catch (e) { /* tenta um fecho antes */ }
  }
  return null;
}

module.exports = { init, rodar, consultar, descreverEvento, extrairJSON };
