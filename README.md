# Cloud Broker CVM — Plataforma de Gestão Multinuvem

Plataforma de gestão multinuvem e portal de gerenciamento do integrador de nuvens públicas
(cloud broker) que atenderá a Comissão de Valores Mobiliários no Pregão Eletrônico nº 90016/2026.

## Subir o ambiente

    cp .env.example .env      # troque as senhas
    docker compose up --build

| Serviço | Endereço |
| --- | --- |
| Portal (frontend) | http://localhost:5173 |
| API (OpenAPI em `/docs`) | http://localhost:8000 |
| Saúde / métricas | http://localhost:8000/health · http://localhost:8000/metrics |
| Keycloak (IdP simulado da CVM, realm `cvm`) | http://localhost:8080 |

Usuários de demonstração do realm `cvm` (um por papel): `cvm.gestor`, `cvm.fiscal`, `cvm.usuario`,
`broker.operador`, `broker.admin`, `auditor`. A senha inicial é temporária e o MFA (TOTP) é exigido no
primeiro acesso.

## Desenvolvimento

    uv venv -p 3.12 .venv && uv pip install -p .venv -e ".[dev]"
    .venv/bin/pytest tests/unit tests/integration
    .venv/bin/ruff check . && .venv/bin/mypy

    cd frontend && npm ci && npm run lint && npm test && npm run e2e

## Teste de aceitação

    .venv/bin/pytest tests/aceitacao

O kit em `tests/aceitacao/` é a referência do contrato e **não deve ser alterado**.

## Estrutura

    broker/domain/           regras puras (catálogo, medição, SLA, faturamento, UST, calendário)
    broker/adapters/csp/     adaptadores de provedor (azure, aws, gcp, fake)
    broker/adapters/persistence/  SQLAlchemy + Alembic
    broker/api/              FastAPI
    broker/workers/          Celery
    broker/cli.py            CLI (fechar-mes, validar-catalogo)
    frontend/                React + TypeScript + Vite
    infra/                   Terraform e Docker
    docs/                    documentação, premissas, dúvidas e progresso
