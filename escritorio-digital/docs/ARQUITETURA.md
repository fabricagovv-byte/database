# Escritório Digital — produto, arquitetura e operação

Administrador: **Arthur Miguel**. Versão 0.1 (fase 1 — núcleo ponta a ponta), 19/10/2026.

## 1. Visão do produto e escopo

Plataforma onde a empresa cadastra serviços, documentos, pessoas e fornecedores; recebe editais de fonte
oficial; obtém análise com referência de página; calcula viabilidade de forma determinística; aprova
decisões por versão; e, após contratar, acompanha execução, evidências, medição, faturamento e recebimento —
com um escritório ao vivo que só mostra o que está registrado em eventos.

| Situação | Itens |
| --- | --- |
| **Implementado e testado** | cadastro (empresa, serviços, pessoas, fornecedores, tributos, documentos com validade/validação); leitura de PDF por página com detecção de página sem texto; classificação de documento; extração de 24 tipos de requisito com página e trecho; matriz de conformidade; retificação com diff e expiração de aprovações; cotação com 3 eventos separados; viabilidade (custo, tributos parametrizados, preço por divisor, margem, fluxo de caixa, capital de giro); aprovações vinculadas a hash da versão, com validade, uso único e separação de funções; resultado ≠ autorização; contrato com mapeamento de cláusulas e divergência da proposta; plano de projeto com rastreabilidade; squads por tipo de objeto; chamados (painel, chat, WhatsApp) com severidade e escopo pela regra do contrato; execução real de testes em sandbox; registro de diff git; revisão (executor não revisa a si mesmo); entregas com evidência; medição (sem conversão automática entre unidades) com aceite e glosa; prévia de nota, emissão com idempotência; financeiro (contratado ≠ faturado ≠ recebido); perguntas financeiras; chat geral/contrato/individual; conversas privadas; mensagem → tarefa; atas → avaliações (nunca execução direta); relatório diário; links seguros assinados; auditoria encadeada e imutável; exportação; isolamento por contrato; motor com lease, heartbeat, retentativa, backoff, recuperação e efeito externo único |
| **Conectado (real)** | PNCP — busca de contratações e download dos arquivos (API pública); execução de comandos em sandbox local; git |
| **Simulado (identificado como tal)** | emissor fiscal `simulador_local` — notas ficam `emitida_simulacao` e não contam como receita faturada |
| **Implementado, aguardando credencial** | WhatsApp Cloud API (webhook com verificação HMAC, deduplicação, envio idempotente); camada de IA (Claude) |
| **Pendente** | OCR; portal do fornecedor; notícias; emissor fiscal autorizado; cofre de segredos gerenciado; PostgreSQL; SSO/MFA; publicação em produção por pipeline |

## 2. Arquitetura

```
 navegador (24 módulos) ──HTTPS──► API FastAPI ──► SQLite (WAL)  ◄── worker (fila persistente)
        ▲  SSE /api/eventos/stream     │  │            ▲ eventos encadeados SHA-256      │
        └──────────────────────────────┘  │            │                                 ├─► PNCP (oficial)
 WhatsApp Cloud API ──webhook HMAC──────► │            └── arquivos (por SHA-256)         ├─► sandbox (pytest, git)
                                          └─► links assinados /l/{token} (somente leitura) ├─► emissor fiscal
                                                                                           └─► IA (opcional)
```

- **Núcleo determinístico**: dinheiro (`Decimal`, HALF_UP), tributos, prazos, permissões e estados
  (`escritorio/dominio`). IA nunca calcula valor.
- **Motor** (`escritorio/motor.py`): tarefa reivindicada com lease de 120 s; heartbeat; worker morto →
  tarefa recuperada; falha → backoff exponencial até `max_tentativas` e escalonamento ao supervisor de
  incidentes; `Bloqueio` (falta dado/integração) não conta como falha; `efeito_unico` registra cada efeito
  externo por chave e, se a queda ocorreu no meio, **consulta o provedor antes de repetir**.
- **Eventos**: toda mudança gera evento com hash encadeado; gatilhos do banco impedem UPDATE/DELETE.
- **Escritório ao vivo**: estado do agente deriva só da tarefa atual e do último evento real.
- **Ambientes**: variáveis `ESCRITORIO_*` separam desenvolvimento/homologação/produção (um banco e um
  segredo por ambiente). Migração para PostgreSQL prevista na fase 3 (esquema já portável).

## 3. Organograma de agentes

117 agentes em 9 departamentos (`escritorio/agentes.py`), cada um com missão, limites, entradas,
ferramentas, entregáveis, critério de conclusão, revisor, limite de custo/tempo e escalonamento.
Implementação declarada honestamente:

| Implementação | Qtde | Significado |
| --- | --- | --- |
| `deterministico` | 37 | habilidade implementada e coberta por teste |
| `ia_pendente` | 68 | depende de modelo de IA; hoje só organiza, registra e encaminha |
| `apoio_humano` | 12 | apoia profissional humano (jurídico, engenharia, atividades físicas) |

Ajuste/desativação: `PATCH /api/agentes/{id}` (somente admin; versão de configuração incrementa; agente
não altera a própria configuração).

## 4. Regras de formação de squads

`tipo_objeto()` pontua o objeto contra 4 perfis (software, digitalização, fornecimento, engenharia/obras).
- **Licitação**: núcleo de análise (leitor, habilitação, qualificação técnica, econômico-financeiro, prazos,
  custos, preço, tributário, jurídico) liderado pelo gestor de portfólio.
- **Execução**: equipe do perfil + condicionais (ex.: "banco de dados" → DBA; "legado" → especialista;
  "dados pessoais" → proteção de dados). Obras exigem responsável técnico humano com ART/RRT.

## 5. Fluxos e aprovações

Licitação: busca → download → leitura → requisitos → matriz → pendências (tarefas suas) → cotações
(fornecedor confirmou → agentes validaram → você aprovou) → viabilidade vN (hash) → pedido de aprovação →
você aprova digitando o código da versão → registro de proposta enviada (consome a aprovação) → resultado.

Contrato: "vencedora" ≠ início → contrato assinado + ordem de serviço → pedido de início → aprovação →
projeto, squad, tarefas → chamados → reprodução real → correção em branch → revisão → validação real →
entrega com evidência → aceite → medição → aceite/glosa → prévia da nota → aprovação → emissor → a receber →
recebido.

| Autonomia | Ações |
| --- | --- |
| Operacional (sem aprovação) | ler, analisar, rascunhar, classificar, testar em sandbox, alterar branch isolada |
| Delimitada | notificações internas, respostas de WhatsApp a usuário cadastrado |
| Aprovação explícita (painel, por versão) | participar/enviar proposta, lance, assinar, comprar, contratar, pagar, emitir nota, compartilhar dado sensível, mudar escopo, publicar em produção, iniciar execução |
| Proibida | falsificar, combinar preços, adulterar evidência, acesso não autorizado, ampliar a própria permissão, apagar auditoria |

Um "sim" por WhatsApp nunca aprova: a resposta instrui a aprovar no painel autenticado.

## 6. Modelo de dados

Tabelas em `escritorio/db.py`: empresa, usuario, sessao, acesso (permissão por objeto), servico, funcionario,
fornecedor, oportunidade, documento (+ documento_pagina, versão e `substitui_id`), requisito, conformidade,
cotacao, analise (versão + hash), aprovacao, contrato, obrigacao, projeto, agente, squad (+ squad_membro),
chamado, tarefa (estado de negócio + lease/heartbeat/tentativas = estado técnico), efeito_externo,
execucao_ferramenta, entrega, medicao, nota_fiscal, lancamento, tributo_regra, mensagem (id_externo único
= deduplicação), link_seguro, relatorio, integracao (circuit breaker), evento (auditoria imutável).

## 7. Matriz de cenários

| Evento | Detecção | Resposta automática | Aprovação | Evidência |
| --- | --- | --- | --- | --- |
| Edital sem anexos | PNCP retorna lista vazia | tarefa bloqueada "edital sem anexos" | — | evento `edital.sem_anexos` |
| PDF ilegível/página escaneada | < 40 caracteres na página | leitura "incompleta", parecer avisa que não cobre tudo | — | `paginas_sem_texto` |
| Requisito ambíguo | requisito sem valor comparável | `informacao_insuficiente` + tarefa sua | — | linha da matriz |
| Documento vencido | validade < sessão | `nao_atende`, pendência "renovar" | — | matriz |
| Certidão indisponível | documento ausente | `nao_atende` + tarefa | — | matriz |
| Atestado insuficiente | sem atestado / compatibilidade | `nao_atende` ou "conferir quantitativos" | — | matriz |
| Retificação após proposta pronta | novo doc tipo retificação | diff por página, aprovações expiram, reanálise | nova | `edital.retificado` |
| Prazo em fuso diferente | texto "horário de…" | `fuso_sessao` registrado; alerta de prazo | — | `alerta.prazo` |
| Lote incompatível | requisito sem capacidade | `nao_atende` | — | matriz |
| Fornecedor sem estoque / cotação vencida | validade < hoje | excluída do cálculo, alerta | — | alerta na análise |
| Mudança de preço | nova cotação | nova versão de análise; aprovação antiga não serve | nova | hash diferente |
| Margem abaixo do mínimo | cálculo | `nao_recomendado` | — | análise |
| Falta de capital de giro | fluxo mensal | `recomendado_com_condicoes` | — | análise |
| Tributo sem parametrização | sem regra vigente | cálculo provisório | contador | alerta |
| Vitória sem contrato | resultado "vencedora" | `vencida_aguardando_contrato`; lista do que falta | — | evento |
| Contrato diverge da proposta | valor ≠ proposta aprovada | divergência registrada | revisão | evento |
| Pedido fora do escopo | palavra de exclusão do contrato | proposta de mudança (não executa) | sim | chamado |
| Mudança em reunião | ata | tarefa de avaliação "planejada" | sim | `reuniao.registrada` |
| Cliente rejeita entrega | registro de rejeição | tarefa de retrabalho | — | entrega |
| Glosa | aceite com glosa | valor faturável reduzido | — | medição |
| Atraso de pagamento | vencimento < hoje | "recebimentos atrasados" | — | painel |
| Nota rejeitada | retorno do emissor | `rejeitada`, efeito liberado para nova tentativa | nova | retorno |
| Mensagem duplicada | `id_externo` repetido | ignorada | — | — |
| Integração indisponível | 3 falhas seguidas | circuit breaker 5 min | — | `integracao` |
| Credencial ausente/expirada | adaptador sem configuração | tarefa bloqueada, aviso no painel | — | erro da tarefa |
| Agente travado | lease vencido | recuperação automática | — | evento "recuperada" |
| Falha repetida | tentativas esgotadas | `falhou` + incidente | — | `incidente.agente` |
| Custo de IA acima do limite | (fase 2: medição de tokens) | — | — | pendente |
| Ferramenta de teste ausente | código 127/"No module" | bloqueio — não vira evidência | — | `ferramenta.erro` |
| Código sem testes | (fase 2: cobertura) | — | — | pendente |
| Falha após implantação | (fase 3: pipeline) | — | — | pendente |
| Migração irreversível | política: exige plano + backup | aprovação `publicar_producao` | sim | — |
| Instrução maliciosa em documento | documentos são dados | nenhum efeito (testado) | — | teste automatizado |
| Evidência ausente | revisão sem evidência | conclusão bloqueada | — | erro |
| Aprovação de versão antiga | hash diferente | bloqueio 409 | nova | evento |
| Acesso entre contratos | `acesso` por objeto | 403 + evento de segurança | — | `seguranca.acesso_negado` |
| Webhook falso | HMAC inválido | 401 + evento | — | `seguranca.webhook_invalido` |
| Situação nova | não prevista | **procedimento de exceção**: tarefa bloqueada, escalonada ao supervisor de incidentes, decisão humana registrada | sim | evento |

Não há garantia de que todos os casos possíveis estão previstos; o procedimento de exceção é o padrão seguro.

## 8. Backlog por fases

- **Fase 1 (entregue)**: núcleo ponta a ponta acima.
- **Fase 2**: IA conectada (redação de propostas técnicas, interpretação de cláusulas com citação de página,
  respostas dos agentes `ia_pendente`), controle de custo por token, OCR (tesseract), portal do fornecedor,
  planos/formulários editáveis (DOCX) a partir do modelo do edital.
- **Fase 3**: PostgreSQL, filas separadas, cofre de segredos, SSO + MFA, pipeline CI/CD com implantação
  aprovada e verificação de saúde pós-publicação, backups com teste de restauração.
- **Fase 4**: notícias e normas, emissor NFS-e autorizado, conciliação bancária, comissões e parcerias.

## 12. Implantação e operação

```bash
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
export ESCRITORIO_DB=/srv/escritorio/escritorio.db ESCRITORIO_ARQUIVOS=/srv/escritorio/arquivos \
       ESCRITORIO_SANDBOX_RAIZ=/srv/escritorio/sandbox ESCRITORIO_SEGREDO_LINKS="$(openssl rand -base64 48)" \
       ESCRITORIO_URL_PUBLICA=https://escritorio.suaempresa.com.br ESCRITORIO_HTTPS=1
.venv/bin/escritorio inicializar --razao-social "..." --cnpj "..." --admin-email voce@empresa --whatsapp 55DDDNUMERO
.venv/bin/escritorio servir --host 127.0.0.1 --porta 8100      # atrás de proxy HTTPS (Caddy/Nginx)
.venv/bin/escritorio verificar-auditoria                        # 0 = íntegra
.venv/bin/pytest                                                # 21 testes
```

Ou `docker compose -f escritorio-digital/docker-compose.yml up -d`. Saúde: `GET /health`.
Backup: copiar o arquivo do banco com `sqlite3 escritorio.db ".backup destino.db"` + pasta de arquivos.
Relatório diário: agendar `escritorio relatorio` no horário configurado (cron no fuso America/Sao_Paulo).

## 13. Dependências pendentes (exatas)

1. **Dados reais da empresa**: razão social, CNPJ, regime tributário, certidões, balanço, atestados.
2. **Contador**: alíquotas e retenções do seu regime/município (hoje "premissa de demonstração").
3. **WhatsApp**: conta Meta Business verificada + `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION`; URL pública HTTPS para o webhook.
4. **Emissor fiscal**: provedor autorizado (NFS-e do município/ADN ou empresa emissora) e certificado A1.
5. **IA**: `ANTHROPIC_API_KEY` e `pip install -e ".[ia]"`.
6. **Servidor**: VPS/nuvem com domínio e HTTPS para funcionamento contínuo (sem servidor ativo, nada roda 24h).
7. **Repositórios dos clientes**: acesso autorizado por contrato (caminho do sandbox ou URL git).
8. **OCR**: `apt install tesseract-ocr tesseract-ocr-por`.
