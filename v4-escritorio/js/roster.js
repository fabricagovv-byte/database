/* ===========================================================
   roster.js — quem trabalha na V4 fábricagov.
   BOSSES  : o CEO (sempre em serviço, na Diretoria)
   CATALOG : os agentes de cada sala. "sala" diz onde fica a mesa.
   =========================================================== */
const ROSTER = (() => {

  const KEY = 'v4-fabricagov-equipe-v1';

  /* ===========================================================
     O DONO — o nome vem de data/config.json ("dono")
     =========================================================== */
  const BOSSES = [
    {
      id: 'boss-1', name: (window.ESCRITORIO && ESCRITORIO.dono) || 'Arthur Miguel',
      role: 'CEO & Fundador · Diretoria',
      emoji: '👑', boss: true, dept: 'diretoria', slotId: 'DIR-1',
      status: 'trabalhando', locked: true,
      source: 'Diretoria', sistema: null,
      brief: 'Dono da V4 fábricagov. Define as licitações em que a casa entra, aprova propostas e acompanha a fábrica.',
      look: {
        skin: '#e0a878', hair: '#140f0c', style: 'fade',
        shirt: '#111827', pants: '#1e293b', shoes: '#15181f',
        glasses: 'retangular', beard: 'cavanhaque', tattoo: false, cap: false,
        uniforme: false
      }
    }
  ];

  /* ===========================================================
     BANCO DE TALENTOS
     sala: servico (fábrica) | licitacoes | financeiro | comercial
     inicio: 'descanso' = começa na sala de games, para o prédio já
             nascer com gente circulando
     =========================================================== */
  const ag = (key, name, role, emoji, sala, desc, why, look, extra) =>
    Object.assign({ key, name, role, emoji, sala, cat: sala === 'servico' ? 'dev' : sala,
                    desc, why, look }, extra || {});

  const CATALOG = [
    /* ---------- FÁBRICA DE SOFTWARE ---------- */
    ag('arquiteto', 'Caio', 'Arquiteto de Software', '🏛️', 'servico',
       'Desenha a arquitetura dos sistemas: módulos, integrações, filas e padrões de segurança.',
       'Sistema público vive anos. Arquitetura boa evita reescrever tudo no próximo contrato.',
       { skin: '#f0c29b', hair: '#3d2a1a', style: 'curto', shirt: '#1f2937', glasses: 'retangular', beard: 'cheia' }),
    ag('techlead', 'Marina', 'Tech Lead', '🧭', 'servico',
       'Divide o trabalho, revisa código e destrava o time quando alguém empaca.',
       'É quem garante que a entrega do termo de referência saia no prazo e com qualidade.',
       { skin: '#c9854f', hair: '#140f0c', style: 'longo', shirt: '#7c6cff', glasses: 'redondo' }),
    ag('frontend', 'Lucas', 'Front-end React & Angular', '⚛️', 'servico',
       'Telas, formulários e portais do cidadão em React e Angular, com acessibilidade (eMAG).',
       'Órgão público exige acessibilidade. Front-end bem feito passa na homologação de primeira.',
       { skin: '#f7d7bd', hair: '#a8702f', style: 'ondulado', shirt: '#38bdf8' }),
    ag('node', 'Beatriz', 'Back-end Node.js & TypeScript', '🟩', 'servico',
       'APIs REST e GraphQL em Node.js/TypeScript, filas e serviços em tempo real.',
       'APIs rápidas de entregar e fáceis de manter para os sistemas web do contrato.',
       { skin: '#e0a878', hair: '#6b4423', style: 'rabo', shirt: '#22c55e' }),
    ag('java', 'Rodrigo', 'Back-end Java & Spring', '☕', 'servico',
       'Sistemas corporativos em Java/Spring Boot, muito pedidos em editais de governo.',
       'Grande parte do legado público roda em Java. Sem ele, metade dos editais fica de fora.',
       { skin: '#a2643b', hair: '#140f0c', style: 'raspado', shirt: '#f59e0b', beard: 'cavanhaque' }),
    ag('dotnet', 'Felipe', 'Back-end .NET & C#', '🟪', 'servico',
       'Aplicações em .NET/C#, integrações com SQL Server e ambientes Microsoft dos órgãos.',
       'Muitos órgãos padronizaram em .NET — atender esse parque abre contratos de sustentação.',
       { skin: '#f0c29b', hair: '#241a13', style: 'fade', shirt: '#a855f7' }),
    ag('python', 'Juliana', 'Python, Django & automações', '🐍', 'servico',
       'Back-end em Django/FastAPI, robôs de coleta e automações de rotina.',
       'É a linguagem dos robôs que alimentam o radar de licitações e dos relatórios.',
       { skin: '#7a4a2c', hair: '#140f0c', style: 'afro', shirt: '#facc15', glasses: 'redondo' }),
    ag('php', 'Gustavo', 'PHP & Laravel', '🐘', 'servico',
       'Portais, sistemas municipais e manutenção de legado em PHP/Laravel.',
       'Prefeituras têm muito sistema em PHP. Sustentação é receita recorrente.',
       { skin: '#e0a878', hair: '#3d2a1a', style: 'cacheado', shirt: '#6366f1', beard: 'cheia' }),
    ag('golang', 'Renan', 'Go & microsserviços', '🐹', 'servico',
       'Microsserviços de alta performance em Go, mensageria e gateways.',
       'Para os módulos que precisam aguentar pico de acesso, como inscrições e consultas.',
       { skin: '#f7d7bd', hair: '#d9b56a', style: 'moicano', shirt: '#00add8' }),
    ag('mobile', 'Larissa', 'Mobile Flutter & React Native', '📱', 'servico',
       'Apps Android e iOS para cidadãos e servidores em campo.',
       'Edital de app é cada vez mais comum: agendamento, fiscalização, saúde.',
       { skin: '#f0c29b', hair: '#8b5cf6', style: 'chanel', shirt: '#f472b6' }),
    ag('devops', 'Thiago', 'DevOps & Cloud', '☁️', 'servico',
       'Esteira CI/CD, Docker, Kubernetes e nuvem (inclusive nuvem de governo).',
       'Deploy sem susto e ambiente de homologação sempre de pé para o fiscal do contrato.',
       { skin: '#c9854f', hair: '#140f0c', style: 'curto', shirt: '#0ea5e9', cap: true }),
    ag('dba', 'Patrícia', 'DBA PostgreSQL & Oracle', '🗄️', 'servico',
       'Modelagem, performance e backup de bancos PostgreSQL, Oracle e SQL Server.',
       'Dado público não pode se perder. Backup testado é cláusula de contrato.',
       { skin: '#f7d7bd', hair: '#5a3a22', style: 'coque', shirt: '#14b8a6', glasses: 'retangular' }),
    ag('qa', 'Dan', 'QA & testes automatizados', '🧪', 'servico',
       'Testes automatizados, regressão e roteiros de homologação antes de cada entrega.',
       'Entrega reprovada na homologação atrasa a medição e o pagamento.',
       { skin: '#f7d7bd', hair: '#8e8e93', style: 'curto', shirt: '#0ea5e9', glasses: 'redondo' }),
    ag('seguranca', 'Vitor', 'Segurança da informação & LGPD', '🛡️', 'servico',
       'Pentest, análise de vulnerabilidades, LGPD e boas práticas do GSI.',
       'Edital de governo cobra segurança e LGPD. É requisito, não diferencial.',
       { skin: '#5a3620', hair: '#140f0c', style: 'raspado', shirt: '#1f2937', beard: 'cheia' }),
    ag('dados', 'Camila', 'Dados & IA', '🧠', 'servico',
       'Painéis de BI, ciência de dados e modelos de IA para triagem de editais.',
       'Transforma dado público em painel para o gestor — e ajuda a escolher onde competir.',
       { skin: '#f0c29b', hair: '#140f0c', style: 'longo', shirt: '#8b5cf6', glasses: 'redondo' }),
    ag('ux', 'Sofia', 'UX/UI Design & acessibilidade', '🎨', 'servico',
       'Pesquisa com usuários, protótipos no Figma e padrão visual gov.br.',
       'Sistema que o servidor entende de primeira gera menos chamado de suporte.',
       { skin: '#e0a878', hair: '#f472b6', style: 'franja', shirt: '#fb7185' }),
    ag('integracoes', 'André', 'Integrações gov (gov.br, SIAFI, APIs)', '🔗', 'servico',
       'Login gov.br, assinatura digital, SIAFI, e-SUS, Receita e outras APIs públicas.',
       'Quase todo sistema público precisa conversar com outro. Integração é o que mais trava projeto.',
       { skin: '#a2643b', hair: '#241a13', style: 'fade', shirt: '#2563eb' }),
    ag('scrum', 'Paula', 'Scrum Master & PMO', '🗂️', 'servico',
       'Cerimônias ágeis, cronograma, relatórios de medição e contato com o fiscal do contrato.',
       'Contrato público é medido por entrega. Alguém precisa manter o cronograma em dia.',
       { skin: '#f7d7bd', hair: '#a8702f', style: 'rabo', shirt: '#14b8a6' }, { inicio: 'descanso' }),
    ag('rpa', 'Bruno', 'Low-code & RPA', '🤖', 'servico',
       'Robôs de processo e soluções low-code para rotinas repetitivas do órgão.',
       'Entrega rápida de valor em processos burocráticos, sem projeto longo.',
       { skin: '#c9854f', hair: '#3d2a1a', style: 'curto', shirt: '#e9edf8', beard: 'cavanhaque' }, { inicio: 'descanso' }),
    ag('suporte', 'Henrique', 'Suporte N2 & sustentação', '🎧', 'servico',
       'Atende chamados, corrige incidentes e cuida do SLA dos sistemas em produção.',
       'SLA estourado vira glosa na fatura. Sustentação bem feita protege o caixa.',
       { skin: '#7a4a2c', hair: '#140f0c', style: 'cacheado', shirt: '#38bdf8' }, { inicio: 'descanso' }),

    /* ---------- FÁBRICA 2 · SQUADS (ala leste) ---------- */
    ag('vue', 'Igor', 'Front-end Vue.js & Nuxt', '🟢', 'fabrica2',
       'Interfaces em Vue/Nuxt para portais e sistemas internos.',
       'Muitos portais públicos novos saem em Vue. Ter os dois grandes frameworks amplia os editais que a V4 atende.',
       { skin: '#f0c29b', hair: '#3d2a1a', style: 'curto', shirt: '#42b883' }),
    ag('nextjs', 'Bianca', 'Full-stack Next.js', '▲', 'fabrica2',
       'Aplicações completas em Next.js com renderização no servidor e APIs.',
       'Entrega front e back juntos em projetos menores — o caminho mais curto do pedido ao sistema no ar.',
       { skin: '#e0a878', hair: '#140f0c', style: 'longo', shirt: '#e9edf8' }),
    ag('kotlin', 'Rafaela', 'Android nativo (Kotlin)', '🤖', 'fabrica2',
       'Apps Android nativos para fiscalização em campo, câmera, GPS e modo offline.',
       'Fiscal de obra e agente de saúde trabalham sem sinal: app nativo offline faz diferença.',
       { skin: '#c9854f', hair: '#140f0c', style: 'rabo', shirt: '#7f52ff' }),
    ag('swift', 'Pedro', 'iOS nativo (Swift)', '🍎', 'fabrica2',
       'Apps iOS nativos e publicação na App Store em nome do órgão.',
       'Edital de app costuma pedir as duas lojas. Sem iOS, a proposta fica incompleta.',
       { skin: '#f7d7bd', hair: '#6b4423', style: 'ondulado', shirt: '#f05138' }),
    ag('rust', 'Matheus', 'Rust & alta performance', '🦀', 'fabrica2',
       'Serviços críticos de alta performance e segurança de memória.',
       'Para módulos que processam muito dado ou não podem cair.',
       { skin: '#a2643b', hair: '#241a13', style: 'moicano', shirt: '#dea584' }),
    ag('ruby', 'Elisa', 'Ruby on Rails', '💎', 'fabrica2',
       'Sistemas web em Rails e manutenção de plataformas já existentes.',
       'Algumas plataformas públicas abertas rodam em Rails — sustentação é contrato recorrente.',
       { skin: '#f0c29b', hair: '#e63946', style: 'chanel', shirt: '#cc342d' }),
    ag('delphi', 'Sérgio', 'Delphi & sistemas legados', '🏺', 'fabrica2',
       'Manutenção e migração de sistemas em Delphi, comuns em prefeituras e autarquias.',
       'Muito sistema municipal ainda é Delphi. Quem migra para web ganha o contrato da modernização.',
       { skin: '#e0a878', hair: '#8e8e93', style: 'curto', shirt: '#334155', glasses: 'retangular', beard: 'cheia' }),
    ag('cobol', 'Walter', 'COBOL & mainframe', '🖥️', 'fabrica2',
       'Sustentação e modernização de sistemas COBOL em mainframe.',
       'Folha, tributos e previdência de vários entes ainda rodam em mainframe. Pouca gente faz.',
       { skin: '#f7d7bd', hair: '#d9d9d9', style: 'raspado', shirt: '#1e3a8a', glasses: 'redondo' }),
    ag('abap', 'Lívia', 'SAP / ABAP', '🔷', 'fabrica2',
       'Customizações ABAP e integrações com SAP em estatais e grandes órgãos.',
       'Estatais e tribunais usam SAP. Integração com ele aparece em edital grande.',
       { skin: '#7a4a2c', hair: '#140f0c', style: 'coque', shirt: '#0faaff' }),
    ag('engdados', 'Gabriel', 'Engenharia de dados (ETL, Airflow)', '🔀', 'fabrica2',
       'Pipelines de dados, ETL, data lake e integração de bases públicas.',
       'Dado espalhado em dez sistemas só vira indicador com pipeline bem feito.',
       { skin: '#c9854f', hair: '#3d2a1a', style: 'fade', shirt: '#017cee' }),
    ag('powerbi', 'Tatiane', 'Power BI & painéis gerenciais', '📊', 'fabrica2',
       'Painéis gerenciais e de transparência em Power BI e ferramentas livres.',
       'Prefeito quer ver indicador. Painel bonito e certo abre portas para o próximo contrato.',
       { skin: '#f0c29b', hair: '#a8702f', style: 'longo', shirt: '#f2c811' }),
    ag('llm', 'Nina', 'IA generativa & LLMs', '✨', 'fabrica2',
       'Assistentes com IA, busca em documentos e automação de atendimento com LLMs.',
       'IA no serviço público é a pauta do momento — e precisa de cuidado com LGPD.',
       { skin: '#e0a878', hair: '#140f0c', style: 'franja', shirt: '#d97757' }),
    ag('gis', 'Clara', 'Geoprocessamento (PostGIS, QGIS)', '🗺️', 'fabrica2',
       'Mapas, cadastro territorial, IPTU georreferenciado e PostGIS.',
       'Cadastro imobiliário e planejamento urbano pedem GIS. É nicho com pouca concorrência.',
       { skin: '#f7d7bd', hair: '#5a3a22', style: 'cacheado', shirt: '#4caf50' }),
    ag('chatbot', 'Vinícius', 'Chatbots & WhatsApp', '💬', 'fabrica2',
       'Robôs de atendimento ao cidadão no WhatsApp e no site.',
       'Atendimento por WhatsApp desafoga a central de qualquer prefeitura.',
       { skin: '#a2643b', hair: '#140f0c', style: 'curto', shirt: '#25d366' }),
    ag('sre', 'Fábio', 'SRE & observabilidade', '📈', 'fabrica2',
       'Monitoramento, alertas, SLO e resposta a incidentes em produção.',
       'SLA de contrato público se cumpre com observabilidade, não com sorte.',
       { skin: '#f0c29b', hair: '#241a13', style: 'curto', shirt: '#f46800', beard: 'cavanhaque' }),
    ag('carga', 'Renata', 'Testes de carga & performance', '🏋️', 'fabrica2',
       'Testes de carga e estresse antes de inscrições, matrículas e consultas em massa.',
       'Sistema que cai no dia da matrícula vira notícia. Ela evita isso.',
       { skin: '#c9854f', hair: '#140f0c', style: 'rabo', shirt: '#0ea5e9' }),
    ag('acessibilidade', 'Murilo', 'Acessibilidade digital (eMAG/WCAG)', '♿', 'fabrica2',
       'Auditoria e correção de acessibilidade pelo eMAG e WCAG.',
       'Acessibilidade é exigência legal em sistema público e item de homologação.',
       { skin: '#f7d7bd', hair: '#6b4423', style: 'ondulado', shirt: '#2563eb', glasses: 'redondo' }),
    ag('requisitos', 'Simone', 'Analista de requisitos & negócios', '📝', 'fabrica2',
       'Transforma o termo de referência em histórias, regras de negócio e critérios de aceite.',
       'Requisito bem escrito evita retrabalho e glosa na medição.',
       { skin: '#7a4a2c', hair: '#140f0c', style: 'chanel', shirt: '#a78bfa', glasses: 'retangular' }),

    /* ---------- BUSCA DE LICITAÇÕES ---------- */
    ag('radar', 'Otávio', 'Radar de licitações (PNCP & portais)', '🔎', 'licitacoes',
       'Varre PNCP, Compras.gov.br, BLL, Licitações-e e portais estaduais atrás de editais de software.',
       'É o topo do funil: edital que ninguém viu é contrato que a V4 não disputa.',
       { skin: '#f0c29b', hair: '#241a13', style: 'curto', shirt: '#f97316', glasses: 'retangular' }),
    ag('edital', 'Helena', 'Análise de edital & termo de referência', '📑', 'licitacoes',
       'Lê o edital e o TR, aponta exigências, riscos, prazos e se vale disputar.',
       'Decidir rápido se entra ou não poupa horas de proposta perdida.',
       { skin: '#e0a878', hair: '#6b4423', style: 'coque', shirt: '#fb923c', glasses: 'redondo' }),
    ag('habilitacao', 'Marcos', 'Habilitação & certidões', '📂', 'licitacoes',
       'Mantém certidões, atestados de capacidade técnica e documentos de habilitação em dia.',
       'Certidão vencida desclassifica proposta vencedora. Ele não deixa isso acontecer.',
       { skin: '#a2643b', hair: '#140f0c', style: 'fade', shirt: '#334155', beard: 'cavanhaque' }),
    ag('precos', 'Fernanda', 'Proposta de preços & planilhas', '💲', 'licitacoes',
       'Monta a planilha de custos (UST, ponto de função, horas) e a proposta comercial.',
       'Preço bem calculado ganha a disputa sem virar contrato no prejuízo.',
       { skin: '#f7d7bd', hair: '#d9b56a', style: 'longo', shirt: '#22c55e' }),
    ag('pregao', 'Ricardo', 'Pregoeiro de disputa (lances)', '⚡', 'licitacoes',
       'Acompanha a sessão pública, dá lances e responde ao pregoeiro no chat.',
       'Na hora do lance, segundos e estratégia decidem quem leva.',
       { skin: '#c9854f', hair: '#8e8e93', style: 'curto', shirt: '#ef4444' }),
    ag('juridico', 'Aline', 'Jurídico de licitações (Lei 14.133)', '⚖️', 'licitacoes',
       'Impugnações, pedidos de esclarecimento, recursos e contrarrazões.',
       'Edital direcionado se derruba com impugnação bem escrita — e recurso salva vitória.',
       { skin: '#5a3620', hair: '#140f0c', style: 'chanel', shirt: '#1f2937', glasses: 'retangular' }),

    /* ---------- FINANCEIRO ---------- */
    ag('contas', 'Rafael', 'Contas a pagar & receber', '🧾', 'financeiro',
       'Controla pagamentos, recebimentos dos órgãos e conciliação bancária.',
       'Órgão público paga por empenho e medição. Alguém precisa cobrar cada parcela.',
       { skin: '#c9854f', hair: '#1a120d', style: 'curto', shirt: '#22c55e', glasses: 'retangular', beard: 'cheia' }),
    ag('faturamento', 'Cláudia', 'Faturamento & notas fiscais', '🧮', 'financeiro',
       'Emite notas por medição, confere glosas e acompanha empenhos e liquidações.',
       'Nota emitida certa na hora certa é dinheiro entrando no prazo.',
       { skin: '#f0c29b', hair: '#5a3a22', style: 'coque', shirt: '#16a34a' }),
    ag('fiscal', 'Eduardo', 'Fiscal & tributário', '📊', 'financeiro',
       'Retenções na fonte, tributos, regime tributário e obrigações acessórias.',
       'Retenção errada em contrato público come a margem sem ninguém perceber.',
       { skin: '#f7d7bd', hair: '#8e8e93', style: 'curto', shirt: '#0f766e', glasses: 'redondo' }),
    ag('controladoria', 'Mônica', 'Controladoria & fluxo de caixa', '💰', 'financeiro',
       'Fluxo de caixa, margem por contrato e garantias contratuais (seguro-garantia).',
       'Mostra quanto cada contrato dá de lucro de verdade e quanto dá para investir.',
       { skin: '#7a4a2c', hair: '#140f0c', style: 'afro', shirt: '#84cc16' }),

    /* ---------- COMERCIAL ---------- */
    ag('prevendas', 'Diego', 'Pré-vendas & demonstrações', '🎯', 'comercial',
       'Faz provas de conceito e demonstrações técnicas exigidas em edital.',
       'Prova de conceito reprovada desclassifica. Ele prepara a demo para passar.',
       { skin: '#f0c29b', hair: '#241a13', style: 'fade', shirt: '#f43f5e', beard: 'cavanhaque' }),
    ag('relacionamento', 'Natália', 'Relacionamento com órgãos públicos', '🤝', 'comercial',
       'Acompanha clientes atuais, planos de contratação anual e oportunidades de aditivo.',
       'Cliente bem atendido renova, adere à ata e indica a V4 para outros órgãos.',
       { skin: '#e0a878', hair: '#140f0c', style: 'longo', shirt: '#e11d48' }),
    ag('contratos', 'Leandro', 'Gestão de contratos & atas (SRP)', '📜', 'comercial',
       'Prazos, aditivos, reajustes, atas de registro de preço e adesões (carona).',
       'Ata de registro de preço bem gerida vira vários contratos com uma licitação só.',
       { skin: '#a2643b', hair: '#3d2a1a', style: 'curto', shirt: '#be123c', glasses: 'retangular' }),
    ag('marketing', 'Carla', 'Marketing institucional', '📣', 'comercial',
       'Portfólio, cases públicos, site e presença em eventos de inovação em governo.',
       'Portfólio forte ajuda a conseguir atestado e a ser lembrado na fase de planejamento.',
       { skin: '#f7d7bd', hair: '#e63946', style: 'ondulado', shirt: '#fb7185' }, { inicio: 'descanso' }),

    /* ---------- exemplo do motor ---------- */
    {
      key: 'exemplo', name: 'EXEMPLO', role: 'Agente de demonstração', emoji: '🧩',
      cat: 'detectado', system: 'Agente de exemplo', sistema: 'exemplo', sala: 'servico',
      desc: 'Um sistema mínimo que vem junto, na pasta exemplo-agente: sobe na porta 4401 e mostra uma página.',
      why: 'Serve de molde. Clique no computador dele para ver o escritório ligar, embutir e conversar com um sistema.',
      look: { skin: '#c9854f', hair: '#140f0c', style: 'cacheado', shirt: '#38bdf8', pants: '#26304a', glasses: null, beard: null }
    }
  ];

  /* ===========================================================
     ESTADO
     =========================================================== */
  let team = [];

  function defaults() {
    const base = BOSSES.map(b => Object.assign({}, b, { look: Object.assign({}, b.look) }));
    // o prédio já nasce com o quadro completo: todo agente com sala
    for (const c of CATALOG) {
      if (c.key === 'exemplo') continue;
      const a = fromCatalog(c);
      if (c.inicio) a.status = c.inicio;
      base.push(a);
    }
    return base;
  }

  function fromCatalog(c) {
    return {
      id: 'ag-' + c.key,
      key: c.key,
      name: c.name,
      role: c.role,
      emoji: c.emoji,
      system: c.system || null,
      sistema: c.sistema || null,
      path: c.path || null,
      brief: c.desc,
      dept: c.sala || 'servico',
      slotId: null,
      status: 'trabalhando',
      boss: false,
      locked: false,
      look: AVATAR.makeLook(c.key, c.look)
    };
  }

  /* ===========================================================
     PERSISTÊNCIA

     O disco manda. A equipe já morava só no localStorage do navegador
     e um dia voltou inteira ao padrão: nome que você deu, contratação,
     estação, horário — tudo perdido de uma vez, sem aviso. O navegador
     limpa storage quando quer. Agora o arquivo é data/equipe.json, no
     servidor, e o localStorage é só um espelho para quando ele estiver
     fora do ar.
     =========================================================== */
  const doLocal = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return d && Array.isArray(d.team) && d.team.length ? d.team : null;
    } catch (e) { return null; }
  };

  let versaoSalva = 2;
  async function load() {
    let vindoDoDisco = null;
    versaoSalva = 2;
    try {
      const d = await (await fetch('/api/equipe')).json();
      if (d && Array.isArray(d.team) && d.team.length) { vindoDoDisco = d.team; versaoSalva = d.v || 1; }
    } catch (e) { /* servidor fora: vale o que o navegador tiver */ }
    if (!vindoDoDisco) { try { const l = JSON.parse(localStorage.getItem(KEY) || 'null'); if (l && l.team && l.team.length) versaoSalva = l.v || 1; } catch (e) {} }

    team = vindoDoDisco || doLocal() || defaults();
    recompor();              // equipe salva antes pode não ter os campos novos
    // v2: a ala leste (Fábrica 2) chegou depois — quem já tinha equipe salva ganha os squads uma vez
    if (versaoSalva < 2) {
      for (const c of CATALOG) if (c.sala === 'fabrica2' && !team.some(a => a.key === c.key)) team.push(fromCatalog(c));
      versaoSalva = 2; save();
    }
    if (!vindoDoDisco) save();   // primeira vez ou migração: carimba no disco
  }

  /** reencaixa campos que chegaram depois de a equipe já ter sido salva,
      como o id do sistema que o agente opera */
  function recompor() {
    for (const a of team) {
      const c = CATALOG.find(c => c.key === a.key);
      if (c) {
        if (!a.sistema && c.sistema) a.sistema = c.sistema;
        if (!a.boss && c.sala && !a.dept) a.dept = c.sala;
        if (c.path && a.path !== c.path) a.path = c.path;
      }
      const b = BOSSES.find(b => b.id === a.id);
      if (b && !a.sistema && b.sistema) a.sistema = b.sistema;
      // sem look o boneco não é desenhado: fica um funcionário invisível na
      // mesa. Reconstrói a partir da key, que é determinística — o mesmo
      // agente volta com a mesma cara de sempre.
      if (!a.look || !a.look.skin) {
        const base = (c && c.look) || (b && b.look) || {};
        a.look = AVATAR.makeLook(a.key || a.id, Object.assign({}, base));
      }
    }
  }

  let gravando = null;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ team, v: 2 })); }
    catch (e) { /* storage bloqueado: o disco ainda pega */ }
    // junta as chamadas seguidas num POST só — arrastar um agente dispara
    // save() várias vezes por segundo
    clearTimeout(gravando);
    gravando = setTimeout(() => {
      fetch('/api/equipe', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team, v: 2 })
      }).catch(() => { /* offline: fica o espelho do navegador */ });
    }, 300);
  }

  function reset() { team = defaults(); save(); }

  /* ---------- operações ---------- */
  function hire(key) {
    const c = CATALOG.find(c => c.key === key);
    if (!c || team.some(a => a.key === key)) return null;
    const a = fromCatalog(c);
    team.push(a); save();
    return a;
  }

  function hireCustom(data) {
    const key = 'custom-' + Date.now().toString(36);
    const a = {
      id: 'ag-' + key, key,
      name: data.name || 'Novo agente',
      role: data.role || 'Função a definir',
      emoji: data.emoji || '🤖',
      system: data.system || null, path: data.path || null,
      sistema: data.sistema || null, reuniao: data.reuniao !== false,
      brief: data.brief || '',
      dept: data.sala || 'servico', slotId: null, status: 'trabalhando',
      boss: false, locked: false, custom: true,
      look: AVATAR.makeLook(key, data.look || {})
    };
    team.push(a); save();
    return a;
  }

  function fire(id) {
    const i = team.findIndex(a => a.id === id);
    if (i < 0 || team[i].locked) return false;
    team.splice(i, 1); save();
    return true;
  }

  const get = (id) => team.find(a => a.id === id);
  const all = () => team;
  const isHired = (key) => team.some(a => a.key === key);
  const count = (st) => team.filter(a => a.status === st).length;

  return { BOSSES, CATALOG, load, save, reset, hire, hireCustom, fire,
           get, all, isHired, count, fromCatalog };
})();
