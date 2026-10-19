# Escritório Digital — Fase 1 (núcleo ponta a ponta) — Plano de implementação

> Metodologia: superpowers (writing-plans → test-driven-development → verification-before-completion).
> Cada tarefa termina com teste automatizado; nenhuma conclusão é declarada sem saída de comando.

**Objetivo:** primeiro fluxo completo e verificável:
empresa → documentos → edital → análise → custos → aprovação → contrato → squad → plano →
chamado → execução real de ferramenta → evidência → medição → faturamento (prévia) → a receber →
relatório diário, com escritório ao vivo alimentado só por eventos reais.

**Arquitetura (decisões):**
- Python 3.12 + FastAPI + SQLite (WAL). Esquema portável para PostgreSQL (fase 3).
- Fila persistente na própria base (lease, heartbeat, retentativa com backoff, idempotência).
- Eventos append-only com encadeamento SHA-256 (auditoria resistente a alteração).
- SSE para o escritório ao vivo; a interface só mostra o que está na tabela de eventos.
- Dinheiro em `Decimal` com arredondamento HALF_UP em centavos. Nenhum cálculo financeiro por IA.
- IA atrás de uma interface; sem chave configurada, agentes respondem só com dados e cálculos
  determinísticos e dizem que a IA não está conectada.

## Tarefas

- [x] T1 Banco, migração e auditoria encadeada — `escritorio/db.py`, `escritorio/auditoria.py`
- [x] T2 Domínio: dinheiro, tributos parametrizados, viabilidade, capital de giro
- [x] T3 Domínio: máquina de estados de tarefas; aprovações vinculadas a hash de versão
- [x] T4 Leitura de documentos (PDF por página, detecção de páginas sem texto) e extração de requisitos
- [x] T5 Matriz de conformidade (requisito × evidência da empresa, validade de certidões)
- [x] T6 Catálogo de 117 agentes + regras de squad por tipo de objeto
- [x] T7 Motor de tarefas (fila, worker, recuperação após falha sem duplicar efeito externo)
- [x] T8 Integração PNCP (busca e download reais), WhatsApp (webhook assinado, deduplicação), emissor fiscal (interface, não conectado)
- [x] T9 API + autenticação + permissão por contrato + links seguros assinados
- [x] T10 Interface web (24 módulos navegáveis; escritório ao vivo por SSE)
- [x] T11 Demonstração reproduzível dos 18 fluxos de aceite com evidências
