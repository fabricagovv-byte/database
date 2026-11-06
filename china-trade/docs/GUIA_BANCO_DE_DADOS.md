# Guia do Banco de Dados — China Trade

## 1. Onde seus dados estão salvos agora

Tudo o que você cadastra no link do claude.ai (produtos, ofertas, fornecedores, vendas, links, fotos e anúncios)
fica salvo **na sua conta do claude.ai**, no banco de dados do artefato.

- Só você vê os dados; quem receber o link sem ser editor não lê nada.
- Salva sozinho a cada alteração.
- Abre igual no celular e no computador com a mesma conta.
- Cópia de segurança semanal: **Relatórios e Exportar → Backup completo (JSON)** (ou Planilha Excel).

## 2. Banco de dados próprio (servidor com login, PostgreSQL e cotações a cada minuto)

1. **Onde rodar:** no seu computador para testar, ou numa VPS Linux (2 GB de memória) para usar pela internet.
2. **Instale o Docker:** Docker Desktop (docker.com) no computador; na VPS Ubuntu:
   `curl -fsSL https://get.docker.com | sh`
3. **Baixe o projeto:**
   ```bash
   git clone https://github.com/fabricagovv-byte/database.git
   cd database && git checkout claude/focused-archimedes-erhhju && cd china-trade
   ```
4. **Configuração e chave de criptografia:**
   ```bash
   cp .env.example .env
   python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"
   ```
   Cole a chave em `CT_CHAVE_CRIPTO=` e troque `POSTGRES_PASSWORD`. Guarde a chave: sem ela os dados não abrem.
5. **Ligue tudo:** `docker compose up -d --build` (PostgreSQL, Redis, API e coletor de cotações).
6. **Abra** `http://localhost:8000` (ou `http://IP-DO-SERVIDOR:8000`) e clique em *Criar conta* — a primeira conta vira administradora.
7. **MFA:** Configurações → Segurança da conta → Ativar MFA (Google Authenticator, Authy…).
8. **Traga os dados do claude.ai:** no link, Relatórios → Backup completo (JSON); no servidor, Relatórios → Importar arquivo.
9. **HTTPS com domínio:**
   ```bash
   sudo apt install -y caddy
   echo 'seudominio.com.br {
     reverse_proxy localhost:8000
   }' | sudo tee /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Depois defina `CT_COOKIE_SEGURO=true` no `.env` e rode `docker compose up -d` de novo.
10. **Backup diário do banco:**
    `docker compose exec -T postgres pg_dump -U chinatrade chinatrade > backup-$(date +%F).sql`
11. **Chaves opcionais** no `.env`: `BRAPI_TOKEN` (B3), `ALIYUN_ACCESS_KEY_ID/SECRET` (tradução para o 1688),
    `SMTP_*` (alertas por e-mail), `WHATSAPP_TOKEN` (alertas por WhatsApp).

Comandos úteis: `docker compose logs -f api` (o que o sistema está fazendo), `docker compose down` (desligar sem apagar dados).

## 3. Cotações e gráficos

- **Link do claude.ai:** uma rotina coleta cotações no Yahoo Finance de hora em hora (10h–18h, dias úteis) e grava
  velas diárias e o gráfico de 15 minutos; a página atualiza sozinha.
- **Servidor próprio:** o coletor roda a cada 60 segundos e envia os preços na hora para a tela.
- Bolsas no Yahoo Finance têm ~15 minutos de atraso. Sem dado, aparece "sem dados" — nada é inventado.
