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

## Começar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
git clone <url-deste-repositório> escritorio-de-agentes
cd v4-escritorio
npm start
```

Abra **http://localhost:4321**. O prédio já abre com a equipe completa
(35 bonecos). O agente de exemplo (pasta `exemplo-agente`) fica no banco de
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
index.html         a tela
img/               logo da V4 fábricagov
js/                motor isométrico, salas, móveis, bonecos, painéis
css/style.css      tema
exemplo-agente/    o menor sistema que o escritório sabe operar
data/              seus dados (fora do git, menos os exemplos)
```

## Licença

MIT. Veja [LICENSE](LICENSE).
