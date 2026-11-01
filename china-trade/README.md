# China Trade & Market Intelligence

Sistema de pesquisa e importação da China, CRM de fornecedores, vendas, links, carteira e mercado financeiro,
com agentes, alertas e exportação de tudo.

**Abrir agora (sem instalar nada):** https://claude.ai/artifact/EjSqfTT8VtXuKMyGNkNCrx
— entra com a sua conta do claude.ai, sem login extra; os dados ficam no banco do artefato e só você os vê.

## Três jeitos de usar a mesma tela

A página (`web/index.html` + `web/app.js`) descobre sozinha onde está rodando:

| Modo | Onde | Login | Dados | Cotações |
| --- | --- | --- | --- | --- |
| claude.ai | link acima | conta do claude.ai | banco do artefato (só dono/editores) | coleção `cotacoes_feed`, preenchida pelo coletor/rotina, ou lançamento manual |
| servidor | `docker compose up` | e-mail + senha + MFA | PostgreSQL, documentos cifrados por usuário | ao vivo: worker a cada 60 s + WebSocket |
| local | abrir o HTML direto | — | localStorage do navegador | manual |

## Subir o servidor (login, banco de dados e bolsa ao vivo 24 h)

```bash
cd china-trade
cp .env.example .env        # defina POSTGRES_PASSWORD e CT_CHAVE_CRIPTO
docker compose up --build   # abre em http://localhost:8000
```

O primeiro cadastro vira **administrador**. Depois: Configurações → Ativar MFA.
Sem e-mail configurado, o código de "Esqueci a senha" aparece no log do servidor (`docker compose logs api`).

Desenvolvimento sem Docker (SQLite):

```bash
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
CT_WORKER_EMBUTIDO=1 .venv/bin/chinatrade servir     # http://127.0.0.1:8000
.venv/bin/pytest && .venv/bin/ruff check chinatrade tests
```

## Módulos

Dashboard · Bolsa (B3, EUA, índices, ETFs) · Criptomoedas · Moedas e Câmbio (com calculadora, spread, IOF e histórico) ·
Trade Intelligence (RSI, MACD, médias, volatilidade, suportes/resistências, backtesting, paper trading, análise por IA) ·
Importações da China (CHINA SCANNER nas 7 plataformas, custo nacionalizado e margem) · Produtos em Alta · Fornecedores
(comparação por produto) · CRM (funil, contatos, tarefas) · Vendas e Clientes (lucro por venda, estoque) · Meus Links ·
Carteira e Watchlist · Alertas · Relatórios e Exportar (Excel, CSV, JSON, restaurar backup) · Administração · Configurações.

Os 7 agentes (MARKET WATCH, CRYPTO RADAR, FOREX MONITOR, CHINA SCANNER, TREND HUNTER, IMPORT ANALYST, CRM ASSISTANT)
rodam na página e na API (`POST /api/agentes/{id}`), e cada execução fica registrada com fontes e limitações.

## Fontes de dados: o que já funciona e o que falta

| Fonte | Situação |
| --- | --- |
| Binance (cripto, tempo real) · Yahoo Finance (bolsas, ~15 min de atraso) · AwesomeAPI (câmbio indicativo) · PTAX Banco Central | prontas, sem chave |
| brapi.dev (B3) · Alpha Vantage (EUA) | prontas; defina `BRAPI_TOKEN` / `ALPHAVANTAGE_KEY` |
| Google Trends via **pytrends** | pronta (`POST /api/tendencias`, `chinatrade tendencias ...`); sujeita a limites do Google |
| Tradução PT→chinês via **Aliyun Machine Translation** (`aliyun-python-sdk-alimt`) | pronta; defina `ALIYUN_ACCESS_KEY_ID/SECRET`. Sem chave usa glossário interno (no claude.ai, a IA traduz) |
| 1688 / Alibaba Open Platform | adaptador com assinatura pronto; precisa de app aprovado em open.1688.com + token OAuth |
| AliExpress, Made-in-China, Global Sources, DHgate, Taobao | sem API pública gratuita: a busca abre o site oficial com o termo traduzido |
| E-mail (SMTP) · WhatsApp Business Cloud API | prontos; defina as variáveis do `.env` |

Nada é inventado: sem fonte, a tela mostra "sem dados". Cada cotação mostra fonte, horário e se é tempo real, atrasada,
indicativa ou manual. Tributos são estimativas (II/IPI por NCM, ICMS por dentro, Remessa Conforme) e não substituem o despachante.

## Cotações no link do claude.ai

A página do claude.ai não pode chamar sites externos. As cotações chegam como um documento novo na coleção
`cotacoes_feed` (a página lê o mais recente). Para gerar esse documento:

```bash
chinatrade coletar-cotacoes --formato artifact --saida feed.json
```

e gravar `feed.json` no banco do artefato (uma rotina agendada do Claude Code pode fazer isso de hora em hora,
desde que o ambiente libere os domínios das fontes acima).

## Segurança

Senhas com scrypt · sessão em cookie HttpOnly/SameSite=Strict · MFA TOTP · bloqueio após 5 erros em 15 min ·
proteção CSRF por cabeçalho · perfis admin/analista/leitor · cada usuário só vê os próprios dados · documentos e anexos
cifrados (Fernet) · auditoria de logins e alterações · CSP restritiva · captura de título de links com proteção a SSRF ·
chaves de API só no servidor.

## Estrutura

    chinatrade/api.py            FastAPI (auth, cadastros, cotações, WebSocket, anexos, exportação, agentes)
    chinatrade/worker.py         coletor de cotações + alertas agendados
    chinatrade/db.py             modelos SQLAlchemy; migrações Alembic em chinatrade/migrations
    chinatrade/seguranca.py      senhas, sessões, TOTP, criptografia
    chinatrade/dominio/          custo de importação e indicadores (mesmas fórmulas da página)
    chinatrade/integracoes/      mercado, China (Aliyun, 1688), Google Trends, e-mail, WhatsApp, links
    chinatrade/agentes.py        os 7 agentes
    web/                         a página (uma só para os três modos)

Escolha de arquitetura: o pedido citava Next.js; usamos uma única página em JavaScript puro, servida pelo FastAPI e pelo
claude.ai, para não manter duas interfaces. Ela tem a mesma função e não exige build.
