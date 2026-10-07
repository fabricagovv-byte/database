# Progresso

| Marco | Situação | Observações |
| --- | --- | --- |
| 1. Fundação | concluído | monorepo, docker-compose (Postgres, Redis, Keycloak, API, worker, frontend), CI, `/health`, `/metrics` |
| 2. Domínio de faturamento + CLI | pendente | |
| 3. Persistência e API | pendente | |
| 4. Operação | pendente | |
| 5. Provisionamento | pendente | |
| 6. FinOps | pendente | |
| 7. Portal | pendente | |
| 8. Adaptadores reais | pendente | |
| 9. Endurecimento | pendente | |

## Marco 1 — Fundação

- Backend FastAPI com `/health` (verifica Postgres e Redis; 503 se degradado), `/metrics` (Prometheus),
  logs JSON com mascaramento de CPF/e-mail, cabeçalhos de segurança HTTP, OpenTelemetry opcional
  (ativado por `OTEL_EXPORTER_OTLP_ENDPOINT`).
- Worker Celery com tarefa `broker.ping`; Alembic inicializado (sem modelos).
- Keycloak com realm `cvm`: 6 papéis, um usuário por papel, MFA (TOTP) obrigatório, PKCE no portal.
- Frontend React + TS + Vite em pt-BR mostrando a situação da plataforma; ESLint (com jsx-a11y),
  Vitest e Playwright.
- CI: ruff, mypy, pytest com Postgres/Redis, pip-audit; ESLint, tsc, Vitest, Playwright, npm audit;
  validação do compose.
