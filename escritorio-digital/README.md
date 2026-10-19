# Escritório Digital Multiagentes — licitações e execução de contratos

Administrador: Arthur Miguel. Fase 1 entregue: fluxo completo **empresa → documentos → edital → análise →
custos → aprovação → contrato → squad → execução real → evidência → medição → faturamento → a receber**,
com escritório ao vivo alimentado só por eventos reais.

- Arquitetura, agentes, squads, aprovações, modelo de dados, matriz de cenários, backlog, implantação e
  dependências pendentes: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Plano de implementação (metodologia superpowers): [`docs/superpowers/plans/`](docs/superpowers/plans/)
- Evidências da execução de 19/10/2026 (busca real no PNCP, editais reais lidos, ciclo completo,
  telas): [`docs/evidencias/`](docs/evidencias/)

## Rodar

```bash
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                                  # 21 testes, incluindo os 18 fluxos de aceite
.venv/bin/escritorio inicializar --razao-social "Sua Empresa" --cnpj "..." --admin-email voce@empresa
ESCRITORIO_SEGREDO_LINKS="$(openssl rand -base64 48)" .venv/bin/escritorio servir --porta 8100
# abra http://127.0.0.1:8100 e entre com a senha exibida na inicialização
```

Demonstração completa contra o servidor em execução:
`python scripts/operar.py --email ... --senha ... --sandbox /caminho/autorizado`
(empresa, certidões e contrato são de DEMONSTRAÇÃO; a busca e os editais do PNCP são reais).

## O que é real, simulado e pendente

| | |
| --- | --- |
| Real | PNCP (busca + download + leitura), execução de testes e git em sandbox, cálculos, aprovações, auditoria, SSE |
| Simulado | emissor fiscal `simulador_local` (notas "emitida_simulacao", fora da receita faturada) |
| Aguardando credencial | WhatsApp Cloud API, IA (Claude) |
| Pendente | OCR, portal do fornecedor, notícias, emissor autorizado, PostgreSQL, SSO/MFA |
