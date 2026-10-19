# V4 fábricagov — Escritório de Agentes

Prédio virtual da **V4 fábricagov Ltda**, softhouse para órgãos públicos
(desenvolvimento de software, busca de licitações e disputa de pregões).
Visual isométrico estilo Habbo, com cara de big tech: cada agente de IA é um
boneco com mesa e computador próprios, e o computador dele abre o sistema que
ele opera.

Dono: **Arthur Miguel** (CEO & Fundador).

## O prédio

| Sala | O que tem |
| --- | --- |
| **Diretoria · CEO** | sala do Arthur Miguel: mesa executiva, piso de madeira, logo da V4, placa do CEO, quadro de ideias, agenda, bandeira do Brasil, troféus e sofás |
| **Fábrica 2 · Squads** | ala leste com 18 estações: Vue, Next.js, Android (Kotlin), iOS (Swift), Rust, Rails, Delphi e COBOL (legado), SAP/ABAP, engenharia de dados, Power BI, IA generativa, GIS, chatbots/WhatsApp, SRE, testes de carga, acessibilidade e requisitos |
| **Fábrica de Software** | open space com 20 estações: arquitetura, tech lead, front-end, Node, Java, .NET, Python, PHP, Go, mobile, DevOps, DBA, QA, segurança/LGPD, dados & IA, UX, integrações gov, Scrum, RPA e suporte. Painéis de esteira CI/CD e stacks |
| **Busca de Licitações** | 6 mesas: radar de editais (PNCP, Compras.gov.br, BLL, Licitações-e), análise de edital, habilitação, preços, pregão e jurídico (Lei 14.133). Painel de radar e tela da sala de disputa |
| **Financeiro** | 4 mesas: contas, faturamento, fiscal e controladoria. Tela de fluxo de caixa e cofre |
| **Comercial** | 4 mesas: pré-vendas, relacionamento com órgãos, contratos/atas SRP e marketing. Tela de pipeline |
| **Sala de Reunião** | mesa de 10 lugares e painel de videoconferência; a reunião dos agentes acontece aqui |
| **Games & Descanso** | fliperamas, sinuca, pebolim, pingue-pongue, videogame, puffs, cápsulas de soneca e café |
| **Lobby** | entrada principal com catracas, recepção, parede da marca, totem e elevadores |

Em volta: fachada com a logo, calçada, árvores, postes, rua com faixa de
pedestres e carros. Os agentes entram pela porta do prédio e andam até a
própria mesa; no descanso vão para a sala de games.

A logo fica em `img/` (versão branca, preta e só o símbolo V4).

## Painel V4 (botão 🗂️ Painel, ou http://localhost:4321/painel.html)

| Aba | O que faz |
| --- | --- |
| **Licitações** | Busca direto no PNCP (API pública oficial): editais recebendo proposta agora ou publicados nos últimos dias. Filtros por modalidade, estado, esfera, valor, município, prazo mínimo, palavras obrigatórias e excluídas. Cada edital ganha uma nota de aderência (0–100) pelo perfil da V4, que você edita. Carteira com situação (nova → em análise → vamos disputar → proposta enviada → ganhamos/perdemos), análise com itens e arquivos oficiais, checklist, parecer da IA (Helena) e botão para pedir protótipo à fábrica. Radar diário avisa as novas no celular e no WhatsApp. Exporta CSV. |
| **Fábrica** | Você descreve o sistema; o squad certo do time pega o pedido e o Claude Code escreve o código numa pasta própria (`projetos/<nome>`), com testes, README e RELATORIO.md com as UST. O registro mostra em tempo real o que está sendo criado. Você roda os testes, liga a prévia (aparece dentro do painel e no computador do tech lead no escritório), pede ajustes e baixa o código em .zip. Vários pedidos em paralelo (1 a 4). |
| **Comercial** | Contatos institucionais públicos: e-mail e telefone que o órgão declarou no CNPJ (Receita, via BrasilAPI), lista de prefeituras do IBGE e prefeitos eleitos dos dados abertos do TSE (você envia o CSV). Situação do relacionamento, rascunho de e-mail de apresentação com IA (o envio é seu) e exportação CSV. |
| **WhatsApp** | Robô pela API oficial da Meta (WhatsApp Cloud API). Números autorizados consultam licitações, busca, carteira, detalhe, radar, fábrica, UST e caixa; os demais recebem resposta automática e ficam registrados para o comercial. Tem simulador para testar sem gastar. |
| **Financeiro** | Seus lançamentos (realizado/previsto, categoria, contrato), saldo, projeção, margem, gráfico por mês, importação e exportação CSV e relatório. |
| **UST** | Contrato com a quantidade máxima de UST (teto) e valor da UST. Demandas manuais ou vindas da fábrica. A distribuição aceita demandas até bater o teto, reparte entre os agentes respeitando a capacidade de cada um, mostra quanto falta e o que cabe, e gera relatório (.md e .csv). |

O que precisa de você:

- **IA (fábrica, análise de edital, rascunho de e-mail):** o [Claude Code](https://claude.com/claude-code) instalado e logado nesta máquina. Cada uso consome a cota do seu plano.
- **WhatsApp:** um app na Meta for Developers com o WhatsApp (token, ID do número, App Secret) e um endereço HTTPS público apontando para este computador, por exemplo `cloudflared tunnel --url http://localhost:4321`. Só `/webhook/whatsapp` aceita acesso de fora, e só com a assinatura da Meta.
- **Prefeitos:** o TSE publica nome e partido dos eleitos, não e-mail nem telefone. Os contatos são os institucionais do cadastro do CNPJ.

Segurança da fábrica: os agentes que escrevem o código só têm ferramentas de ler e escrever arquivos dentro da pasta do projeto. Rodar testes e ligar o sistema são sempre um clique seu no painel.

Tudo do painel fica em `data/painel/` (fora do git). O código gerado fica em `projetos/` (também fora do git).

Testes do painel: `node --test tests/*.test.js` (sobe o escritório com PNCP, Receita, IBGE e Claude falsos).

## Começar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
git clone <url-deste-repositório> escritorio-de-agentes
cd v4-escritorio
npm start
```

Abra **http://localhost:4321**. O prédio já abre com a equipe completa
(53 bonecos). O agente de exemplo (pasta `exemplo-agente`) fica no banco de
agentes: contrate e clique no computador dele para ver o fluxo de ligar e
embutir um sistema.

No Windows:
- **`INICIAR ESCRITORIO.cmd`** sobe o escritório e o religa se ele cair.
- **`CRIAR ATALHO.ps1`** cria um atalho na área de trabalho. Para rodar: botão
  direito no arquivo e depois **Executar com o PowerShell**. O atalho liga o
  escritório, se estiver desligado, e abre o navegador.

## Colocar os seus agentes

Na aba **Contratar**, clique em **+ Cadastrar agente**, escolha a sala
(Fábrica, Licitações, Financeiro ou Comercial) e o tipo de sistema:

| Sistema do agente | O que preencher |
| --- | --- |
| **Roda nesta máquina** | pasta do projeto, comando (`npm`, `node`, `python`…), argumentos (`run dev`) e uma porta livre |
| **Site / URL** | o endereço. Se o site recusar abrir em iframe, marque "usar o espelho" |
| **Nenhum** | só o boneco, sem sistema |

O escritório sobe o sistema local com a variável `PORT` igual à porta
informada. Se o seu projeto escolhe a porta de outro jeito, passe nos
argumentos (ex.: `run dev -- --port 4402`).

Tudo fica em `data/sistemas.json`, que também pode ser editado à mão. Os campos
estão explicados no topo de `data/sistemas.exemplo.json`.

Por segurança, o escritório escuta só em `127.0.0.1`, executa só o que está no
registro e recusa comando com `& | ; < > $` e crase. Ele também ignora pedido
vindo de outro site aberto no navegador.

## Conversar com um agente

No monitor, **💬 Conversar** abre uma sessão do [Claude Code](https://claude.com/claude-code)
dentro da pasta do sistema:

- **Investigar** só lê e explica.
- **Resolver** pode editar o projeto.

Precisa do Claude Code instalado e logado nesta máquina.

## Reunião dos agentes

Na sala de reunião, **▶ Reunir agora** junta os agentes que têm sistema local.
Cada um lê o próprio projeto e diz três coisas:

1. um número real;
2. uma melhoria;
3. o que precisa de outro agente.

No fim, um briefing junta tudo.

Cada fala é uma chamada ao Claude e consome a cota do seu plano. Por isso o
horário automático vem **desligado**. Para ligar, e para dar uma meta à
reunião, use `data/config.json` (veja abaixo).

## Configuração

Copie `data/config.exemplo.json` para `data/config.json` e ajuste:

- `nome`, `subtitulo`: o topo da tela e o letreiro das paredes.
- `dono`: o nome no boneco e na placa da Diretoria (padrão: Arthur Miguel).
- `empresa`: uma frase sobre o negócio, que vira contexto na reunião.
- `porta`: a porta do escritório (padrão 4321).
- `reuniao.automatica`, `dias`, `hora`: a reunião em horário fixo.
- `reuniao.meta`: `descricao`, `alvo`, `feito`, `unidade` e `ate` aparecem no
  placar e orientam a conversa.

Para mudar as cores, edite as variáveis no topo de `css/style.css`. A planta
do prédio está em `js/world.js` (salas, portas e painéis), os móveis em
`js/furniture.js` e a equipe em `js/roster.js`.

## Avisos no celular

**🔔 Avisos** manda notificação pelo app gratuito [ntfy](https://ntfy.sh) ou
pelo WhatsApp via CallMeBot. O escritório avisa quando:

- um sistema caiu e não voltou;
- a reunião terminou;
- uma ação da agenda rodou.

Seus sistemas também podem pedir um aviso:

```http
POST http://localhost:4321/api/avisar
{ "titulo": "Meu agente", "texto": "3 pedidos esperando", "prioridade": "normal" }
```

## Agenda

`data/agenda.json` liga ou desliga um sistema numa data marcada. O exemplo está
no comentário da seção AGENDA em `server.js`.

## O que fica fora do git

Configuração, equipe, avisos (com a chave do CallMeBot), atas e estado ficam em
`data/` e são ignorados pelo git. Só os dois arquivos `*.exemplo.json` são
versionados.

## Estrutura

```
server.js          servidor: arquivos da tela, API, sobe/vigia sistemas, espelho
reuniao.js         reunião dos agentes (Claude Code em cada pasta)
avisos.js          ntfy e CallMeBot
index.html         a tela do prédio
painel.html        o Painel V4 (js/painel.js, css/painel.css)
painel/            servidor do painel: licitações (PNCP), fábrica, comercial, WhatsApp, financeiro, UST
tests/             testes do painel
img/               logo da V4 fábricagov
js/                motor isométrico, salas, móveis, bonecos, painéis
css/style.css      tema
exemplo-agente/    o menor sistema que o escritório sabe operar
data/              seus dados (fora do git, menos os exemplos)
```

## Licença

MIT. Veja [LICENSE](LICENSE).
