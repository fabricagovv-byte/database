/* ===========================================================
   painel-demo.js — o painel sem servidor (link do celular, prévia)

   Quando o servidor do escritório não responde, o painel passa a usar este
   simulador: os mesmos caminhos da API, com dados de EXEMPLO guardados só
   neste navegador. Busca no PNCP, consulta de CNPJ, IA e WhatsApp de verdade
   precisam do escritório rodando no PC (npm start) — aqui elas explicam isso.
   =========================================================== */
window.PAINEL_DEMO = (() => {
  const CHAVE = 'v4-painel-demo-v1';
  const hoje = new Date();
  const emDias = d => new Date(hoje.getTime() + d * 86400000).toISOString().slice(0, 19);
  const diasAte = iso => iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null;
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const so = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const SO_PC = 'Na demonstração isso não roda: precisa do escritório ligado no PC (npm start na pasta v4-escritorio).';

  const MODALIDADES = { 1: 'Leilão eletrônico', 2: 'Diálogo competitivo', 3: 'Concurso', 4: 'Concorrência eletrônica', 5: 'Concorrência presencial',
    6: 'Pregão eletrônico', 7: 'Pregão presencial', 8: 'Dispensa', 9: 'Inexigibilidade', 10: 'Manifestação de interesse', 11: 'Pré-qualificação',
    12: 'Credenciamento', 13: 'Leilão presencial' };
  const STATUS = ['nova', 'em análise', 'vamos disputar', 'proposta enviada', 'ganhamos', 'perdemos', 'descartada'];

  const ed = (n, orgao, mun, uf, objeto, valor, dias, nota, termos) => ({
    id: 'EXEMPLO-' + n, cnpj: '00000000000' + String(n).padStart(3, '0'), orgao, esfera: 'Municipal', uf, municipio: mun,
    numero: n + '/2026', modalidade: 'Pregão eletrônico', codModalidade: 6, objeto, valor, srp: n % 2 === 0,
    publicacao: emDias(-3), abertura: emDias(-2), encerramento: emDias(dias), dias, nota, termos,
    link: 'https://pncp.gov.br/app/editais', situacao: 'Divulgada no PNCP'
  });
  const EDITAIS = [
    ed(101, 'Prefeitura Municipal de Exemplo do Norte (exemplo)', 'Exemplo do Norte', 'MG', 'Contratação de fábrica de software para desenvolvimento e sustentação de sistemas, medida em UST', 1850000, 18, 100, ['fabrica de software', 'sustentacao de sistemas', 'ust']),
    ed(102, 'Secretaria de Saúde de Vila Modelo (exemplo)', 'Vila Modelo', 'SP', 'Desenvolvimento de aplicativo de agendamento de consultas e portal do cidadão', 640000, 25, 70, ['aplicativo', 'portal']),
    ed(103, 'Câmara Municipal de Serra Exemplo (exemplo)', 'Serra Exemplo', 'GO', 'Licença de uso de software de gestão legislativa com implantação e treinamento', 210000, 9, 95, ['licenca de uso', 'software de gestao', 'software']),
    ed(104, 'Prefeitura Municipal de Porto Teste (exemplo)', 'Porto Teste', 'BA', 'Serviços de business intelligence e painéis de indicadores para a gestão', 380000, 4, 55, ['business intelligence']),
    ed(105, 'Autarquia de Águas de Exemplópolis (exemplo)', 'Exemplópolis', 'PR', 'Digitalização e gestão eletrônica de documentos do acervo', 290000, 31, 80, ['digitalizacao', 'gestao eletronica de documentos']),
    ed(106, 'Instituto de Previdência Modelo (exemplo)', 'Cidade Modelo', 'RS', 'Hospedagem em nuvem, backup e banco de dados do sistema previdenciário', 520000, 14, 70, ['hospedagem', 'backup', 'banco de dados'])
  ];

  function semente() {
    const ctr = 'ctr-exemplo';
    return {
      ultima: { quando: new Date().toISOString(), total: EDITAIS.length, itens: EDITAIS },
      carteira: { 'EXEMPLO-101': Object.assign({}, EDITAIS[0], { status: 'vamos disputar', notas: 'exemplo' }),
                  'EXEMPLO-103': Object.assign({}, EDITAIS[2], { status: 'em análise' }) },
      projetos: [{
        id: 'prj-exemplo', slug: 'protocolo-digital', nome: 'Protocolo Digital (exemplo)', status: 'pronto', criadoEm: new Date(Date.now() - 3600e3).toISOString(),
        pedido: 'Sistema web de protocolo de documentos: cidadão abre pedido, servidor despacha entre setores, consulta pelo número e painel de prazos.',
        squad: [{ nome: 'Marina', papel: 'Tech Lead' }, { nome: 'Lucas', papel: 'Front-end React & Angular' }, { nome: 'Beatriz', papel: 'Back-end Node.js & TypeScript' }, { nome: 'Dan', papel: 'QA & testes automatizados' }],
        ust: 168, arquivos: 14, linhas: 1460, porta: 4501, testes: { ok: true, passaram: 12, falharam: 0 }, custo: 0,
        log: [{ t: Date.now() - 3500e3, txt: '🚀 squad começou a construir em projetos/protocolo-digital' },
              { t: Date.now() - 3000e3, txt: 'criando server.js' }, { t: Date.now() - 2500e3, txt: 'criando public/index.html' },
              { t: Date.now() - 2000e3, txt: 'criando tests/protocolo.test.js' }, { t: Date.now() - 1500e3, txt: '✅ código entregue — exemplo da demonstração' }],
        relatorio: '# Relatório — Protocolo Digital (exemplo)\n\n## Funcionalidades\n\n- Abertura de protocolo com anexo\n- Despacho entre setores\n- Consulta pública pelo número\n- Painel de prazos\n\n## Testes\n\n12 testes escritos com node:test.\n\n## Esforço\n\n| Atividade | UST |\n| --- | ---: |\n| Levantamento e modelagem | 24 |\n| Back-end e API | 56 |\n| Telas | 48 |\n| Testes | 24 |\n| Documentação | 16 |\n| **Total** | **168** |\n',
        arvore: ['README.md', 'RELATORIO.md', 'v4.json', 'server.js', 'public/index.html', 'public/app.js', 'public/estilo.css', 'tests/protocolo.test.js']
      }],
      contatos: [
        { id: 'c1', tipo: 'prefeitura', nome: 'Prefeitura Municipal de Exemplo do Norte (exemplo)', municipio: 'Exemplo do Norte', uf: 'MG', prefeito: 'Nome do Prefeito (exemplo)', partido: '—', email: 'compras@exemplodonorte.exemplo', telefone: '(00) 0000-0000', status: 'em negociação', fonte: 'exemplo' },
        { id: 'c2', tipo: 'orgao', nome: 'Secretaria de Saúde de Vila Modelo (exemplo)', municipio: 'Vila Modelo', uf: 'SP', email: 'licitacao@vilamodelo.exemplo', telefone: '(00) 0000-0001', status: 'contatado', fonte: 'exemplo' },
        { id: 'c3', tipo: 'prefeitura', nome: 'Prefeitura Municipal de Porto Teste (exemplo)', municipio: 'Porto Teste', uf: 'BA', prefeito: 'Nome da Prefeita (exemplo)', email: '', telefone: '', status: 'novo', fonte: 'exemplo' }
      ],
      lancamentos: [
        { id: 'f1', tipo: 'receita', data: isoMes(-1, 10), valor: 85000, categoria: 'Contrato público', descricao: 'Exemplo: medição do contrato', situacao: 'realizado', contrato: 'Exemplo do Norte' },
        { id: 'f2', tipo: 'despesa', data: isoMes(-1, 28), valor: 42000, categoria: 'Folha e pró-labore', descricao: 'Exemplo: folha', situacao: 'realizado', contrato: '' },
        { id: 'f3', tipo: 'despesa', data: isoMes(0, 5), valor: 6800, categoria: 'Impostos', descricao: 'Exemplo: impostos', situacao: 'realizado', contrato: '' },
        { id: 'f4', tipo: 'receita', data: isoMes(0, 12), valor: 91000, categoria: 'Contrato público', descricao: 'Exemplo: medição do mês', situacao: 'previsto', contrato: 'Exemplo do Norte' },
        { id: 'f5', tipo: 'despesa', data: isoMes(0, 20), valor: 3500, categoria: 'Infraestrutura/nuvem', descricao: 'Exemplo: nuvem', situacao: 'previsto', contrato: '' }
      ],
      saldoInicial: 50000,
      contratos: [{ id: ctr, nome: 'Fábrica de software (exemplo)', orgao: 'Prefeitura de Exemplo do Norte', tetoUST: 5000, valorUST: 92, horasPorUST: 1,
                    inicio: hoje.getFullYear() + '-01-01', fim: hoje.getFullYear() + '-12-31', metaMensal: 0, criadoEm: new Date().toISOString() }],
      demandas: [
        { id: 'os1', contratoId: ctr, titulo: 'Exemplo: Portal do cidadão', ust: 1800, prioridade: 1, status: 'em execução', squad: ['Lucas', 'Beatriz', 'Sofia'], criadoEm: '1' },
        { id: 'os2', contratoId: ctr, titulo: 'Exemplo: App de fiscalização', ust: 2200, prioridade: 2, status: 'backlog', squad: [], criadoEm: '2' },
        { id: 'os3', contratoId: ctr, titulo: 'Exemplo: Painel BI', ust: 1500, prioridade: 3, status: 'backlog', squad: [], criadoEm: '3' },
        { id: 'os4', contratoId: ctr, titulo: 'Exemplo: Ajustes de acessibilidade', ust: 600, prioridade: 4, status: 'backlog', squad: [], criadoEm: '4' }
      ],
      capacidadeHorasMes: 120,
      whatsapp: { ativo: false, phoneId: '', verifyToken: '', versao: 'v21.0', autorizados: [], respostaPublica: 'Olá! Você falou com a V4 fábricagov. Nossa equipe responde em breve.', temToken: false, temSegredo: false },
      perfil: { grupos: [{ nome: 'Desenvolvimento de software', termos: 'desenvolvimento de software,fábrica de software,sistema web,aplicativo,ust', excluir: 'medicamento' }], ruido: 'sistema de registro de preços' },
      radar: { ativo: false, hora: 7, minuto: 0, dias: [1, 2, 3, 4, 5], notaMin: 40, filtros: {}, ultimo: null }
    };
  }
  function isoMes(delta, dia) { const d = new Date(hoje.getFullYear(), hoje.getMonth() + delta, dia); return d.toISOString().slice(0, 10); }

  let S;
  try { S = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { S = null; }
  if (!S || !S.ultima) S = semente();
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(S)); } catch (e) { /* só memória */ } };

  const EQUIPE = ['Caio', 'Marina', 'Lucas', 'Beatriz', 'Rodrigo', 'Felipe', 'Juliana', 'Gustavo', 'Renan', 'Larissa', 'Thiago', 'Patrícia', 'Dan', 'Vitor', 'Camila', 'Sofia'];
  const tarefas = {};
  const tarefa = r => { const id = uid('t-'); tarefas[id] = { id, status: 'ok', resultado: r }; return { tarefa: id }; };

  /* ---------- financeiro ---------- */
  function resumoFin() {
    const r = { saldoInicial: S.saldoInicial, receitas: 0, despesas: 0, aReceber: 0, aPagar: 0, porMes: {}, porCategoria: {}, porContrato: {} };
    for (const l of S.lancamentos) {
      const rec = l.tipo === 'receita';
      if (l.situacao === 'previsto') { if (rec) r.aReceber += l.valor; else r.aPagar += l.valor; }
      else { if (rec) r.receitas += l.valor; else r.despesas += l.valor; }
      const m = l.data.slice(0, 7);
      r.porMes[m] = r.porMes[m] || { receitas: 0, despesas: 0, previstoEntrada: 0, previstoSaida: 0 };
      r.porMes[m][l.situacao === 'previsto' ? (rec ? 'previstoEntrada' : 'previstoSaida') : (rec ? 'receitas' : 'despesas')] += l.valor;
      r.porCategoria[l.tipo + '|' + l.categoria] = (r.porCategoria[l.tipo + '|' + l.categoria] || 0) + l.valor;
    }
    r.saldo = r.saldoInicial + r.receitas - r.despesas;
    r.saldoProjetado = r.saldo + r.aReceber - r.aPagar;
    r.margem = r.receitas ? (r.receitas - r.despesas) / r.receitas : 0;
    r.meses = Object.keys(r.porMes).sort();
    return r;
  }
  function relatorioFin() {
    const r = resumoFin();
    return ['# Relatório financeiro — V4 fábricagov (demonstração)', '', '| Indicador | Valor |', '| --- | ---: |',
      `| Saldo atual | ${brl(r.saldo)} |`, `| Receitas realizadas | ${brl(r.receitas)} |`, `| Despesas realizadas | ${brl(r.despesas)} |`,
      `| A receber | ${brl(r.aReceber)} |`, `| A pagar | ${brl(r.aPagar)} |`, `| Saldo projetado | ${brl(r.saldoProjetado)} |`, '',
      '## Por mês', '', '| Mês | Receitas | Despesas |', '| --- | ---: | ---: |', ...r.meses.map(m => `| ${m} | ${brl(r.porMes[m].receitas)} | ${brl(r.porMes[m].despesas)} |`)].join('\n');
  }

  /* ---------- UST (mesma regra do servidor) ---------- */
  function distribuir(cid) {
    const c = S.contratos.find(x => x.id === cid); if (!c) throw new Error('contrato não encontrado');
    let meses = 12; if (c.inicio && c.fim) meses = Math.max(1, Math.round((new Date(c.fim) - new Date(c.inicio)) / (30.44 * 86400000)));
    const cap = S.capacidadeHorasMes * meses / (c.horasPorUST || 1);
    const carga = new Map(EQUIPE.map(n => [n, 0]));
    const ordem = { entregue: 0, 'em execução': 1, backlog: 2 };
    const dem = S.demandas.filter(x => x.contratoId === cid && x.status !== 'cancelada')
      .sort((a, b) => ordem[a.status] - ordem[b.status] || a.prioridade - b.prioridade || String(a.criadoEm).localeCompare(String(b.criadoEm)));
    let usado = 0; const aceitas = [], fora = [];
    for (const x of dem) {
      if (x.status !== 'backlog' || usado + x.ust <= c.tetoUST) {
        usado += x.ust;
        let p = (x.squad || []).filter(n => carga.has(n));
        if (!p.length) p = [...carga.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.max(1, Math.min(4, Math.ceil(x.ust / Math.max(1, cap * .5))))).map(e => e[0]);
        const parte = x.ust / p.length;
        aceitas.push(Object.assign({}, x, { alocacao: p.map(n => { carga.set(n, carga.get(n) + parte); return { agente: n, ust: +parte.toFixed(2) }; }) }));
      } else fora.push(x);
    }
    const falta = Math.max(0, c.tetoUST - usado); let sobra = falta; const cabem = [];
    for (const x of fora.slice().sort((a, b) => a.ust - b.ust)) if (x.ust <= sobra) { cabem.push(x); sobra -= x.ust; }
    const porAgente = [...carga.entries()].filter(e => e[1] > 0).map(([agente, ust]) => ({ agente, ust: +ust.toFixed(2), horas: +(ust * c.horasPorUST).toFixed(1), ocupacao: +(ust / cap * 100).toFixed(0) })).sort((a, b) => b.ust - a.ust);
    return { contrato: c, quando: new Date().toISOString(), teto: c.tetoUST, usado, falta, percentual: +(usado / c.tetoUST * 100).toFixed(1),
      valorUsado: usado * c.valorUST, valorTeto: c.tetoUST * c.valorUST, entregue: dem.filter(x => x.status === 'entregue').reduce((s, x) => s + x.ust, 0),
      aceitas, fora, cabem, porAgente, capacidadeUSTporAgente: +cap.toFixed(1), meses, sobrecarregados: porAgente.filter(a => a.ocupacao > 100).map(a => a.agente) };
  }
  function relatorioUST(r) {
    return [`# Relatório de UST — ${r.contrato.nome} (demonstração)`, '', '| Indicador | Valor |', '| --- | ---: |',
      `| Teto | ${r.teto} UST (${brl(r.valorTeto)}) |`, `| Distribuído | ${r.usado} UST (${r.percentual}%) |`, `| Falta para o teto | ${r.falta} UST |`, '',
      '## Demandas aceitas', '', '| Prior. | Demanda | UST | Agentes |', '| ---: | --- | ---: | --- |',
      ...r.aceitas.map(x => `| ${x.prioridade} | ${x.titulo} | ${x.ust} | ${x.alocacao.map(a => a.agente + ' (' + a.ust + ')').join(', ')} |`),
      '', '## Por agente', '', '| Agente | UST | Ocupação |', '| --- | ---: | ---: |', ...r.porAgente.map(a => `| ${a.agente} | ${a.ust} | ${a.ocupacao}% |`),
      ...(r.fora.length ? ['', '## Fora do teto', '', ...r.fora.map(x => `- ${x.titulo} — ${x.ust} UST`)] : [])].join('\n');
  }

  /* ---------- robô (simulador) ---------- */
  function robo(t) {
    t = so(t).trim();
    const linha = (l, i) => `${i + 1}. [${l.nota}] ${l.orgao}\n${l.objeto.slice(0, 120)}\n💰 ${brl(l.valor)} · ⏳ ${diasAte(l.encerramento)} dia(s)`;
    if (!t || /^(oi|ola|menu|ajuda)/.test(t)) return 'V4 fábricagov — comandos:\n• licitacoes\n• buscar <palavras>\n• carteira\n• fabrica\n• ust\n• caixa\n(demonstração com dados de exemplo)';
    if (/^licita/.test(t)) return 'Top da última busca (exemplo):\n\n' + S.ultima.itens.slice(0, 5).map(linha).join('\n\n');
    if (/^buscar/.test(t)) { const p = t.replace(/^buscar\s*/, ''); const r = S.ultima.itens.filter(l => !p || so(l.objeto).includes(p)); return `Busca "${p}" nos exemplos: ${r.length}\n\n` + r.slice(0, 5).map(linha).join('\n\n'); }
    if (/^carteira/.test(t)) return 'Carteira (exemplo):\n\n' + Object.values(S.carteira).map(linha).join('\n\n');
    if (/^fabrica/.test(t)) return 'Fábrica:\n' + S.projetos.map(p => `• ${p.nome} — ${p.status}${p.ust ? ' · ' + p.ust + ' UST' : ''}`).join('\n');
    if (/^ust/.test(t)) return 'UST:\n' + S.contratos.map(c => { const r = distribuir(c.id); return `• ${c.nome}: ${r.usado}/${r.teto} (${r.percentual}%)`; }).join('\n');
    if (/^(caixa|saldo|financeiro)/.test(t)) { const r = resumoFin(); return `Caixa (exemplo):\nSaldo: ${brl(r.saldo)}\nA receber: ${brl(r.aReceber)}\nProjetado: ${brl(r.saldoProjetado)}`; }
    return 'Não entendi. Mande "ajuda".';
  }

  /* ---------- fábrica simulada: o pedido "anda" na tela ---------- */
  const PASSOS = ['planejando o sistema', 'criando server.js', 'criando public/index.html', 'criando public/app.js', 'criando data/exemplo.json', 'criando tests/app.test.js', 'escrevendo README.md e RELATORIO.md'];
  function avancar() {
    for (const p of S.projetos) {
      if (p.status !== 'gerando') continue;
      const passo = Math.floor((Date.now() - new Date(p.inicio).getTime()) / 2500);
      while (p.log.length - 1 < Math.min(passo, PASSOS.length)) p.log.push({ t: Date.now(), txt: PASSOS[p.log.length - 1] });
      if (passo > PASSOS.length) {
        p.status = 'pronto'; p.ust = 40 + Math.round(p.pedido.length / 6); p.arquivos = 7; p.linhas = 600;
        p.log.push({ t: Date.now(), txt: '✅ código entregue (simulação da demonstração)' });
        p.relatorio = `# Relatório — ${p.nome}\n\n> Demonstração: no PC, o Claude Code escreve o código de verdade nesta etapa.\n\n## Pedido\n\n${p.pedido}\n\n## Esforço\n\n| Atividade | UST |\n| --- | ---: |\n| Total | ${p.ust} |\n`;
        p.arvore = ['README.md', 'RELATORIO.md', 'v4.json', 'server.js', 'public/index.html', 'public/app.js', 'tests/app.test.js'];
      }
    }
    gravar();
  }

  const corpoProj = p => Object.assign({}, p, { pasta: 'projetos/' + p.slug + ' (no PC)', rodando: p.status === 'gerando' });

  /* ---------- roteador ---------- */
  const rotas = [];
  const r = (m, re, fn) => rotas.push({ m, re: new RegExp('^' + re + '$'), fn });

  r('GET', '/resumo', () => {
    const cart = Object.values(S.carteira).map(l => Object.assign(l, { dias: diasAte(l.encerramento) }));
    const ps = {}; S.projetos.forEach(p => { ps[p.status] = (ps[p.status] || 0) + 1; });
    const f = resumoFin();
    return { licitacoes: { carteira: cart.length, porStatus: {}, ultimaBusca: { quando: S.ultima.quando, total: S.ultima.total },
             proximas: cart.filter(l => ['vamos disputar', 'em análise', 'proposta enviada'].includes(l.status)) },
             fabrica: { total: S.projetos.length, porStatus: ps, ust: S.projetos.reduce((s, p) => s + (p.ust || 0), 0) },
             comercial: { total: S.contatos.length, comEmail: S.contatos.filter(c => c.email).length },
             financeiro: { saldo: f.saldo, aReceber: f.aReceber, aPagar: f.aPagar, saldoProjetado: f.saldoProjetado },
             ust: { contratos: S.contratos.length, teto: S.contratos.reduce((s, c) => s + c.tetoUST, 0) },
             whatsapp: Object.assign({ pronto: false, falta: ['token de acesso'] }, S.whatsapp) };
  });
  r('GET', '/tarefas/([\\w-]+)', m => { const t = tarefas[m[1]]; if (!t) throw new Error('tarefa não encontrada'); return t; });
  r('GET', '/ia', () => ({ instalado: null }));

  r('GET', '/licitacoes/meta', () => ({ modalidades: MODALIDADES, esferas: ['Federal', 'Estadual', 'Municipal', 'Distrital'], status: STATUS, perfil: S.perfil, radar: S.radar }));
  r('POST', '/licitacoes/buscar', (m, b) => {
    const pal = so(b.palavras).split(',').map(x => x.trim()).filter(Boolean);
    const itens = EDITAIS.map(l => Object.assign({}, l, { dias: diasAte(l.encerramento), naCarteira: !!S.carteira[l.id], status: S.carteira[l.id] ? S.carteira[l.id].status : null }))
      .filter(l => l.nota >= (Number(b.notaMin) || 0) && (!b.ufs || !b.ufs.length || b.ufs.includes(l.uf)) &&
                   (!pal.length || pal.some(p => so(l.objeto).includes(p))) && (!b.valorMin || l.valor >= Number(b.valorMin)) && (!b.valorMax || l.valor <= Number(b.valorMax)));
    S.ultima = { quando: new Date().toISOString(), total: itens.length, itens }; gravar();
    return tarefa({ total: itens.length, bruto: EDITAIS.length, consultas: 0, erros: [], aviso: 'Demonstração: os filtros foram aplicados sobre editais de EXEMPLO. A busca real no PNCP roda no PC.' });
  });
  r('GET', '/licitacoes/ultima', () => S.ultima);
  r('GET', '/licitacoes/carteira', () => Object.values(S.carteira).map(l => Object.assign(l, { dias: diasAte(l.encerramento) })));
  r('POST', '/licitacoes/salvar', (m, b) => { const l = S.ultima.itens.find(x => x.id === b.id); if (!l) throw new Error('não achei'); S.carteira[l.id] = Object.assign({}, l, { status: 'nova' }); gravar(); return S.carteira[l.id]; });
  r('POST', '/licitacoes/atualizar', (m, b) => { const l = S.carteira[b.id]; if (!l) throw new Error('não está na carteira'); ['status', 'notas', 'valorProposta'].forEach(k => { if (k in b) l[k] = b[k]; }); gravar(); return l; });
  r('POST', '/licitacoes/remover', (m, b) => { delete S.carteira[b.id]; gravar(); return { ok: true }; });
  r('POST', '/licitacoes/analisar', (m, b) => {
    const base = S.carteira[b.id] || S.ultima.itens.find(x => x.id === b.id); if (!base) throw new Error('não achei');
    const l = S.carteira[b.id] = Object.assign({}, base, { status: base.status && base.status !== 'nova' ? base.status : 'em análise' });
    const dias = diasAte(l.encerramento);
    l.analise = { quando: new Date().toISOString(), dias, nota: l.nota, recomendacao: dias < 3 ? 'avaliar com o time' : l.nota >= 60 ? 'disputar' : 'avaliar com o time',
      sinais: /ust/i.test(l.objeto) ? ['Medido em UST — usar a calculadora de UST'] : [], totalItens: 1,
      itens: [{ n: 1, descricao: l.objeto, qtd: 1, unidade: 'serviço', total: l.valor }], arquivos: [],
      checklist: ['Ler edital e termo de referência completos', 'Certidões negativas válidas', 'Atestados de capacidade técnica', 'Planilha de custos (UST/PF/horas)'],
      aviso: 'Demonstração: no PC a análise lê os itens e arquivos oficiais do PNCP.',
      ia: b.ia ? { erro: SO_PC } : null };
    gravar(); return tarefa(l);
  });
  r('PUT', '/licitacoes/perfil', (m, b) => { S.perfil = b; gravar(); return b; });
  r('POST', '/licitacoes/perfil/padrao', () => S.perfil);
  r('PUT', '/licitacoes/radar', (m, b) => { Object.assign(S.radar, b); gravar(); return S.radar; });
  r('POST', '/licitacoes/radar/rodar', () => { throw new Error(SO_PC); });
  r('POST', '/licitacoes/fabrica', (m, b) => { const l = S.carteira[b.id] || S.ultima.itens.find(x => x.id === b.id); return criarProjeto({ nome: 'Protótipo ' + l.municipio, pedido: 'Protótipo para o edital: ' + l.objeto, cliente: l.orgao }); });

  function criarProjeto(b) {
    if (String(b.pedido || '').trim().length < 15) throw new Error('descreva o sistema com um pouco mais de detalhe (mínimo 15 caracteres)');
    const p = { id: uid('prj-'), slug: so(b.nome || 'sistema').replace(/[^a-z0-9]+/g, '-'), nome: b.nome || String(b.pedido).slice(0, 40), pedido: b.pedido, cliente: b.cliente || '',
      squad: [{ nome: 'Marina', papel: 'Tech Lead' }, { nome: 'Lucas', papel: 'Front-end' }, { nome: 'Beatriz', papel: 'Back-end Node.js' }, { nome: 'Dan', papel: 'QA' }],
      status: 'gerando', criadoEm: new Date().toISOString(), inicio: new Date().toISOString(), ust: 0, custo: 0,
      log: [{ t: Date.now(), txt: '🚀 squad começou (simulação: no PC o Claude Code escreve o código de verdade)' }] };
    S.projetos.unshift(p); gravar(); return p;
  }
  r('GET', '/fabrica', () => { avancar(); return { projetos: S.projetos.map(p => Object.assign({}, p, { log: p.log.slice(-6), rodando: p.status === 'gerando' })), config: { paralelo: 2, horasPorUST: 1, modelo: '' } }; });
  r('POST', '/fabrica', (m, b) => criarProjeto(b));
  r('PUT', '/fabrica/config', (m, b) => b);
  r('GET', '/fabrica/([\\w-]+)', m => { avancar(); const p = S.projetos.find(x => x.id === m[1]); if (!p) throw new Error('projeto não encontrado'); return corpoProj(p); });
  r('GET', '/fabrica/([\\w-]+)/arquivo', () => ({ texto: '// Demonstração: o código de verdade fica na pasta projetos/ no PC.\n' }));
  r('POST', '/fabrica/([\\w-]+)/testes', m => { const p = S.projetos.find(x => x.id === m[1]); return tarefa({ ok: true, passaram: p.testes ? p.testes.passaram : 6, falharam: 0, saida: '# demonstração: no PC roda node --test de verdade\n# pass ' + (p.testes ? p.testes.passaram : 6) + '\n# fail 0' }); });
  r('POST', '/fabrica/([\\w-]+)/ligar', () => { throw new Error(SO_PC); });
  r('POST', '/fabrica/([\\w-]+)/desligar', () => ({ ok: true }));
  r('POST', '/fabrica/([\\w-]+)/ajustar', () => { throw new Error(SO_PC); });
  r('POST', '/fabrica/([\\w-]+)/(cancelar|retomar)', (m) => { const p = S.projetos.find(x => x.id === m[1]); p.status = m[2] === 'cancelar' ? 'cancelado' : 'gerando'; if (m[2] === 'retomar') { p.inicio = new Date().toISOString(); p.log = p.log.slice(0, 1); } gravar(); return p; });
  r('POST', '/fabrica/([\\w-]+)/apagar', m => { S.projetos = S.projetos.filter(x => x.id !== m[1]); gravar(); return { ok: true }; });

  r('GET', '/comercial', (m, b, q) => {
    const t = so(q.get('q'));
    return { status: ['novo', 'contatado', 'em negociação', 'cliente', 'sem interesse'],
      itens: S.contatos.filter(c => (!q.get('uf') || c.uf === q.get('uf')) && (!q.get('tipo') || c.tipo === q.get('tipo')) && (!q.get('status') || c.status === q.get('status')) &&
        (q.get('comEmail') !== '1' || c.email) && (!t || so(c.nome + c.municipio + (c.prefeito || '')).includes(t))) };
  });
  r('POST', '/comercial/atualizar', (m, b) => { const c = S.contatos.find(x => x.id === b.id); Object.assign(c, { status: b.status || c.status }); gravar(); return c; });
  r('POST', '/comercial/novo', (m, b) => { const c = Object.assign({ id: uid('c'), status: 'novo', fonte: 'cadastro manual' }, b); S.contatos.push(c); gravar(); return c; });
  r('POST', '/comercial/abordagem', (m, b) => { const c = S.contatos.find(x => x.id === b.id);
    return tarefa({ texto: `Assunto: Apresentação institucional — V4 fábricagov\n\nPrezados(as) da ${c.nome},\n\n(Demonstração: no PC a Natália escreve este e-mail com IA, usando os editais do órgão.)\n\nAtenciosamente,\nNatália — Relacionamento Institucional, V4 fábricagov` }); });
  ['/comercial/importar-editais', '/comercial/municipios', '/comercial/cnpj', '/comercial/tse'].forEach(x => r('POST', x, () => { throw new Error(SO_PC); }));

  r('GET', '/whatsapp', () => ({ config: Object.assign({ pronto: false, falta: ['token de acesso', 'ID do número', 'App Secret'] }, S.whatsapp), log: [] }));
  r('PUT', '/whatsapp', (m, b) => { Object.assign(S.whatsapp, { ativo: b.ativo, phoneId: b.phoneId, verifyToken: b.verifyToken, versao: b.versao, respostaPublica: b.respostaPublica,
    autorizados: String(b.autorizados || '').split(/[,\n;]/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 10) }); gravar(); return S.whatsapp; });
  r('POST', '/whatsapp/testar', () => { throw new Error(SO_PC); });
  r('POST', '/whatsapp/simular', (m, b) => ({ resposta: robo(b.texto) }));

  r('GET', '/financeiro', (m, b, q) => ({ lancamentos: S.lancamentos.filter(l => !q.get('mes') || l.data.startsWith(q.get('mes'))).sort((a, c) => c.data.localeCompare(a.data)),
    resumo: resumoFin(), categorias: { receita: ['Contrato público', 'Sustentação', 'Licença/SaaS', 'Consultoria', 'Outras receitas'],
      despesa: ['Folha e pró-labore', 'Impostos', 'Infraestrutura/nuvem', 'Ferramentas e licenças', 'Garantias e seguros', 'Certidões e cartório', 'Marketing', 'Escritório', 'IA e APIs', 'Outras despesas'] } }));
  r('POST', '/financeiro', (m, b) => { const v = Math.abs(Number(b.valor)); if (!v) throw new Error('informe o valor');
    const l = { id: uid('f'), tipo: b.tipo === 'despesa' ? 'despesa' : 'receita', data: b.data || new Date().toISOString().slice(0, 10), valor: v, categoria: b.categoria || '', descricao: b.descricao || (b.tipo === 'despesa' ? 'Despesa' : 'Receita'), situacao: b.situacao === 'previsto' ? 'previsto' : 'realizado', contrato: b.contrato || '' };
    S.lancamentos.push(l); gravar(); return l; });
  r('POST', '/financeiro/remover', (m, b) => { S.lancamentos = S.lancamentos.filter(l => l.id !== b.id); gravar(); return { ok: true }; });
  r('POST', '/financeiro/saldo-inicial', (m, b) => { S.saldoInicial = Number(b.valor) || 0; gravar(); return { saldoInicial: S.saldoInicial }; });
  r('POST', '/financeiro/importar', () => { throw new Error(SO_PC); });
  r('GET', '/financeiro/relatorio', () => ({ texto: relatorioFin() }));

  r('GET', '/ust', () => ({ contratos: S.contratos, demandas: S.demandas, capacidadeHorasMes: S.capacidadeHorasMes }));
  r('POST', '/ust/contrato', (m, b) => { if (!(Number(b.tetoUST) > 0)) throw new Error('informe a quantidade máxima de UST (teto)');
    let c = S.contratos.find(x => x.id === b.id); if (!c) { c = { id: uid('ctr-'), criadoEm: new Date().toISOString() }; S.contratos.push(c); }
    Object.assign(c, { nome: b.nome || 'Contrato', orgao: b.orgao || '', tetoUST: Number(b.tetoUST), valorUST: Number(b.valorUST) || 0, horasPorUST: Number(b.horasPorUST) || 1, inicio: b.inicio || '', fim: b.fim || '', metaMensal: Number(b.metaMensal) || 0 });
    gravar(); return c; });
  r('POST', '/ust/contrato/remover', (m, b) => { S.contratos = S.contratos.filter(x => x.id !== b.id); gravar(); return { ok: true }; });
  r('POST', '/ust/demanda', (m, b) => { if (!(Number(b.ust) > 0)) throw new Error('informe as UST da demanda');
    let d = S.demandas.find(x => x.id === b.id); if (!d) { d = { id: uid('os-'), criadoEm: new Date().toISOString() }; S.demandas.push(d); }
    Object.assign(d, { contratoId: b.contratoId, titulo: b.titulo || 'Demanda', ust: Number(b.ust), prioridade: Number(b.prioridade) || 3, status: b.status || 'backlog', squad: b.squad || [] });
    gravar(); return d; });
  r('POST', '/ust/demanda/remover', (m, b) => { S.demandas = S.demandas.filter(x => x.id !== b.id); gravar(); return { ok: true }; });
  r('POST', '/ust/capacidade', (m, b) => { S.capacidadeHorasMes = Number(b.horas) || 120; gravar(); return { capacidadeHorasMes: S.capacidadeHorasMes }; });
  r('POST', '/ust/importar-fabrica', (m, b) => { let n = 0; for (const p of S.projetos) if (p.ust && !S.demandas.some(d => d.id === 'os-' + p.id)) {
    S.demandas.push({ id: 'os-' + p.id, contratoId: b.contratoId, titulo: 'Fábrica: ' + p.nome, ust: p.ust, prioridade: 3, status: p.status === 'pronto' ? 'entregue' : 'em execução', squad: p.squad.map(s => s.nome), criadoEm: p.criadoEm }); n++; }
    gravar(); return { novas: n }; });
  r('GET', '/ust/distribuir', (m, b, q) => distribuir(q.get('contrato')));
  r('GET', '/ust/relatorio', (m, b, q) => ({ texto: relatorioUST(distribuir(q.get('contrato'))) }));

  async function chamar(metodo, url, corpo) {
    const u = new URL(url, 'http://demo');
    for (const x of rotas) {
      if (x.m !== metodo) continue;
      const m = u.pathname.match(x.re);
      if (m) return JSON.parse(JSON.stringify(x.fn(m, corpo || {}, u.searchParams)));
    }
    throw new Error(SO_PC);
  }
  function reiniciar() { S = semente(); gravar(); }
  return { chamar, reiniciar, SO_PC };
})();
