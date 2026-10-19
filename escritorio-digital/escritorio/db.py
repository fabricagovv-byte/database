"""Banco de dados (SQLite em WAL). Esquema escrito para ser portável a PostgreSQL."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

ESQUEMA = """
CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY,
  razao_social TEXT NOT NULL, nome_fantasia TEXT, cnpj TEXT NOT NULL UNIQUE,
  regime_tributario TEXT, fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  margem_minima_pct TEXT NOT NULL DEFAULT '10', capital_giro_disponivel TEXT NOT NULL DEFAULT '0',
  risco_maximo TEXT NOT NULL DEFAULT 'medio', regioes TEXT, cnaes TEXT,
  hora_relatorio TEXT NOT NULL DEFAULT '18:00',
  origem TEXT, responsavel TEXT, atualizado_em TEXT, validacao TEXT NOT NULL DEFAULT 'nao_validado'
);
CREATE TABLE IF NOT EXISTS usuario (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL, telefone_whatsapp TEXT, ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessao (
  token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuario(id), expira_em TEXT NOT NULL
);
-- Permissão por objeto: usuários não-admin só veem contratos/oportunidades liberados aqui.
CREATE TABLE IF NOT EXISTS acesso (
  usuario_id INTEGER NOT NULL REFERENCES usuario(id), objeto_tipo TEXT NOT NULL, objeto_id INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, objeto_tipo, objeto_id)
);
CREATE TABLE IF NOT EXISTS servico (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  nome TEXT NOT NULL, categoria TEXT NOT NULL, descricao TEXT, unidade_cobranca TEXT NOT NULL,
  capacidade_mensal TEXT, tecnologias TEXT, profissionais TEXT, custo_unitario TEXT, restricoes TEXT,
  palavras_chave TEXT, palavras_excluir TEXT, origem TEXT, responsavel TEXT, atualizado_em TEXT,
  validacao TEXT NOT NULL DEFAULT 'nao_validado'
);
CREATE TABLE IF NOT EXISTS funcionario (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  nome TEXT NOT NULL, funcao TEXT NOT NULL, qualificacoes TEXT, registro_profissional TEXT,
  horas_mes INTEGER NOT NULL DEFAULT 160, horas_alocadas INTEGER NOT NULL DEFAULT 0,
  custo_hora TEXT, situacao TEXT NOT NULL DEFAULT 'disponivel', atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS fornecedor (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  nome TEXT NOT NULL, cnpj TEXT, contato TEXT, categorias TEXT, papel TEXT NOT NULL DEFAULT 'fornecimento',
  situacao TEXT NOT NULL DEFAULT 'cadastrado', atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS oportunidade (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  fonte TEXT NOT NULL, id_externo TEXT, link TEXT, orgao TEXT, orgao_cnpj TEXT, uf TEXT, municipio TEXT,
  objeto TEXT NOT NULL, modalidade TEXT, valor_estimado TEXT, data_abertura TEXT, data_encerramento TEXT,
  fuso_sessao TEXT NOT NULL DEFAULT 'America/Sao_Paulo', aderencia INTEGER,
  situacao TEXT NOT NULL DEFAULT 'encontrada', consultado_em TEXT, dados TEXT,
  UNIQUE (empresa_id, fonte, id_externo)
);
CREATE TABLE IF NOT EXISTS documento (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  oportunidade_id INTEGER REFERENCES oportunidade(id), contrato_id INTEGER REFERENCES contrato(id),
  titulo TEXT NOT NULL, tipo TEXT NOT NULL, tipo_confianca TEXT, arquivo TEXT, sha256 TEXT, mime TEXT,
  paginas INTEGER, paginas_sem_texto TEXT, leitura TEXT, validade TEXT, versao INTEGER NOT NULL DEFAULT 1,
  substitui_id INTEGER REFERENCES documento(id), origem TEXT, responsavel TEXT,
  validacao TEXT NOT NULL DEFAULT 'nao_validado', criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documento_pagina (
  documento_id INTEGER NOT NULL REFERENCES documento(id), pagina INTEGER NOT NULL, texto TEXT NOT NULL,
  PRIMARY KEY (documento_id, pagina)
);
CREATE TABLE IF NOT EXISTS requisito (
  id INTEGER PRIMARY KEY, oportunidade_id INTEGER NOT NULL REFERENCES oportunidade(id),
  documento_id INTEGER REFERENCES documento(id), categoria TEXT NOT NULL, chave TEXT NOT NULL,
  descricao TEXT NOT NULL, pagina INTEGER, trecho TEXT, valor_exigido TEXT
);
CREATE TABLE IF NOT EXISTS conformidade (
  id INTEGER PRIMARY KEY, oportunidade_id INTEGER NOT NULL REFERENCES oportunidade(id),
  requisito_id INTEGER NOT NULL REFERENCES requisito(id), situacao TEXT NOT NULL,
  evidencia TEXT, pendencia TEXT, responsavel TEXT, prazo TEXT, gerado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cotacao (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  oportunidade_id INTEGER REFERENCES oportunidade(id), fornecedor_id INTEGER NOT NULL REFERENCES fornecedor(id),
  item TEXT NOT NULL, quantidade TEXT NOT NULL, preco_unitario TEXT NOT NULL, frete TEXT NOT NULL DEFAULT '0',
  validade TEXT NOT NULL, prazo_entrega_dias INTEGER, garantia TEXT,
  confirmada_fornecedor_em TEXT, validada_agentes_em TEXT, aprovada_em TEXT,
  situacao TEXT NOT NULL DEFAULT 'recebida', criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analise (
  id INTEGER PRIMARY KEY, oportunidade_id INTEGER NOT NULL REFERENCES oportunidade(id),
  versao INTEGER NOT NULL, entrada TEXT NOT NULL, resultado TEXT NOT NULL, hash TEXT NOT NULL,
  criado_em TEXT NOT NULL, UNIQUE (oportunidade_id, versao)
);
CREATE TABLE IF NOT EXISTS aprovacao (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  acao TEXT NOT NULL, objeto_tipo TEXT NOT NULL, objeto_id INTEGER NOT NULL, versao INTEGER NOT NULL,
  hash TEXT NOT NULL, valor TEXT, resumo TEXT, solicitante TEXT NOT NULL,
  aprovador_id INTEGER REFERENCES usuario(id), situacao TEXT NOT NULL DEFAULT 'pendente',
  validade TEXT, canal TEXT, justificativa TEXT, criado_em TEXT NOT NULL, decidido_em TEXT, consumido_em TEXT
);
CREATE TABLE IF NOT EXISTS contrato (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  oportunidade_id INTEGER REFERENCES oportunidade(id), numero TEXT, orgao TEXT, objeto TEXT NOT NULL,
  tipo_objeto TEXT NOT NULL, valor_total TEXT NOT NULL, modelo_cobranca TEXT NOT NULL,
  valor_unidade TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, ordem_servico TEXT,
  situacao TEXT NOT NULL, regras TEXT, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS obrigacao (
  id INTEGER PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES contrato(id),
  clausula TEXT, descricao TEXT NOT NULL, tipo TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projeto (
  id INTEGER PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES contrato(id),
  nome TEXT NOT NULL, plano TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agente (
  id TEXT PRIMARY KEY, numero INTEGER NOT NULL, nome TEXT NOT NULL, departamento TEXT NOT NULL,
  missao TEXT NOT NULL, limites TEXT NOT NULL, entradas TEXT, ferramentas TEXT, entregaveis TEXT,
  criterio_conclusao TEXT, revisor TEXT, limite_custo TEXT, limite_minutos INTEGER,
  escalonamento TEXT, implementacao TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'disponivel', tarefa_atual_id INTEGER, ultimo_evento_id INTEGER,
  custo_acumulado TEXT NOT NULL DEFAULT '0', versao_config INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS squad (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  oportunidade_id INTEGER REFERENCES oportunidade(id), contrato_id INTEGER REFERENCES contrato(id),
  nome TEXT NOT NULL, tipo TEXT NOT NULL, lider TEXT REFERENCES agente(id), orcamento_ia TEXT,
  criterios_aceite TEXT, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS squad_membro (
  squad_id INTEGER NOT NULL REFERENCES squad(id), membro_tipo TEXT NOT NULL, membro_id TEXT NOT NULL,
  papel TEXT, motivo TEXT, substituto TEXT, PRIMARY KEY (squad_id, membro_tipo, membro_id)
);
CREATE TABLE IF NOT EXISTS chamado (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  contrato_id INTEGER REFERENCES contrato(id), sistema TEXT, solicitante TEXT, canal TEXT NOT NULL,
  descricao TEXT NOT NULL, severidade TEXT, no_escopo INTEGER, situacao TEXT NOT NULL DEFAULT 'aberto',
  faltando TEXT, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tarefa (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  contrato_id INTEGER REFERENCES contrato(id), oportunidade_id INTEGER REFERENCES oportunidade(id),
  chamado_id INTEGER REFERENCES chamado(id), projeto_id INTEGER REFERENCES projeto(id),
  titulo TEXT NOT NULL, tipo TEXT NOT NULL, executor_tipo TEXT NOT NULL, executor_id TEXT,
  revisor TEXT, estado TEXT NOT NULL DEFAULT 'criada', depende_de INTEGER REFERENCES tarefa(id),
  parametros TEXT, idempotency_key TEXT UNIQUE, tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 3, proxima_execucao TEXT, lease_ate TEXT, heartbeat_em TEXT,
  worker TEXT, resultado TEXT, erro TEXT, custo TEXT NOT NULL DEFAULT '0', prazo TEXT,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tarefa_fila ON tarefa (estado, proxima_execucao);
-- Registro de efeitos externos: chave única impede repetir nota, mensagem, implantação.
CREATE TABLE IF NOT EXISTS efeito_externo (
  chave TEXT PRIMARY KEY, tarefa_id INTEGER, tipo TEXT NOT NULL, situacao TEXT NOT NULL,
  resposta TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execucao_ferramenta (
  id INTEGER PRIMARY KEY, tarefa_id INTEGER REFERENCES tarefa(id), ferramenta TEXT NOT NULL,
  comando TEXT NOT NULL, diretorio TEXT, codigo_saida INTEGER, saida TEXT, sha256_saida TEXT,
  inicio TEXT NOT NULL, fim TEXT
);
CREATE TABLE IF NOT EXISTS entrega (
  id INTEGER PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES contrato(id),
  tarefa_id INTEGER REFERENCES tarefa(id), descricao TEXT NOT NULL, quantidade TEXT, unidade TEXT,
  evidencias TEXT NOT NULL, executor TEXT, revisor TEXT, situacao TEXT NOT NULL DEFAULT 'realizada',
  motivo_rejeicao TEXT, criado_em TEXT NOT NULL, aceita_em TEXT
);
CREATE TABLE IF NOT EXISTS medicao (
  id INTEGER PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES contrato(id), periodo TEXT NOT NULL,
  itens TEXT NOT NULL, quantidade_reconhecida TEXT NOT NULL, valor_faturavel TEXT NOT NULL,
  glosa TEXT NOT NULL DEFAULT '0', situacao TEXT NOT NULL DEFAULT 'rascunho', criado_em TEXT NOT NULL,
  aceita_em TEXT
);
CREATE TABLE IF NOT EXISTS nota_fiscal (
  id INTEGER PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES contrato(id),
  medicao_id INTEGER NOT NULL REFERENCES medicao(id), valor TEXT NOT NULL, tributos TEXT,
  situacao TEXT NOT NULL DEFAULT 'previa', idempotency_key TEXT NOT NULL UNIQUE,
  numero_oficial TEXT, retorno TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lancamento (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  contrato_id INTEGER REFERENCES contrato(id), tipo TEXT NOT NULL, categoria TEXT NOT NULL,
  descricao TEXT NOT NULL, valor TEXT NOT NULL, vencimento TEXT NOT NULL, situacao TEXT NOT NULL DEFAULT 'aberto',
  origem_tipo TEXT, origem_id INTEGER, responsavel TEXT, proxima_acao TEXT, liquidado_em TEXT,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tributo_regra (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id), nome TEXT NOT NULL,
  aliquota_pct TEXT NOT NULL, base TEXT NOT NULL DEFAULT 'receita_bruta', aplica_categoria TEXT,
  municipio TEXT, retido INTEGER NOT NULL DEFAULT 0, vigencia_inicio TEXT NOT NULL, vigencia_fim TEXT,
  fonte TEXT NOT NULL, validado_contador INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mensagem (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id),
  canal TEXT NOT NULL, canal_ref TEXT NOT NULL, autor_tipo TEXT NOT NULL, autor_id TEXT NOT NULL,
  texto TEXT NOT NULL, privado INTEGER NOT NULL DEFAULT 0, origem TEXT NOT NULL DEFAULT 'painel',
  id_externo TEXT UNIQUE, criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mensagem_canal ON mensagem (canal, canal_ref, id);
CREATE TABLE IF NOT EXISTS link_seguro (
  jti TEXT PRIMARY KEY, escopo TEXT NOT NULL, criado_por INTEGER, expira_em TEXT NOT NULL,
  revogado INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relatorio (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresa(id), data TEXT NOT NULL,
  conteudo TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integracao (
  nome TEXT PRIMARY KEY, situacao TEXT NOT NULL, detalhe TEXT, verificado_em TEXT,
  falhas_seguidas INTEGER NOT NULL DEFAULT 0, aberto_ate TEXT
);
-- Auditoria append-only com encadeamento de hash. Toda mudança relevante gera um evento.
CREATE TABLE IF NOT EXISTS evento (
  id INTEGER PRIMARY KEY, empresa_id INTEGER, contrato_id INTEGER, oportunidade_id INTEGER,
  tipo TEXT NOT NULL, ator_tipo TEXT NOT NULL, ator_id TEXT NOT NULL, objeto_tipo TEXT, objeto_id TEXT,
  resumo TEXT NOT NULL, dados TEXT, criado_em TEXT NOT NULL, hash_anterior TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS evento_sem_update BEFORE UPDATE ON evento
BEGIN SELECT RAISE(ABORT, 'eventos de auditoria são imutáveis'); END;
CREATE TRIGGER IF NOT EXISTS evento_sem_delete BEFORE DELETE ON evento
BEGIN SELECT RAISE(ABORT, 'eventos de auditoria são imutáveis'); END;
"""


def agora() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Banco:
    """Conexão por thread; transações explícitas via `tx()`."""

    def __init__(self, caminho: str) -> None:
        self.caminho = caminho
        self._local = threading.local()
        self.trava_escrita = threading.RLock()
        with self.trava_escrita:
            self.conn().executescript(ESQUEMA)

    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "c", None)
        if c is None:
            c = sqlite3.connect(self.caminho, timeout=30, isolation_level=None, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA foreign_keys=ON")
            c.execute("PRAGMA busy_timeout=30000")
            self._local.c = c
        return c

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        c = self.conn()
        with self.trava_escrita:
            if c.in_transaction:  # transação aninhada: reaproveita a externa
                yield c
                return
            c.execute("BEGIN IMMEDIATE")
            try:
                yield c
            except BaseException:
                c.execute("ROLLBACK")
                raise
            c.execute("COMMIT")

    def um(self, sql: str, *p: Any) -> dict[str, Any] | None:
        r = self.conn().execute(sql, p).fetchone()
        return dict(r) if r else None

    def todos(self, sql: str, *p: Any) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn().execute(sql, p).fetchall()]

    def inserir(self, tabela: str, dados: dict[str, Any]) -> int:
        cols = ", ".join(dados)
        marc = ", ".join("?" for _ in dados)
        with self.tx() as c:
            cur = c.execute(f"INSERT INTO {tabela} ({cols}) VALUES ({marc})", [_val(v) for v in dados.values()])  # noqa: S608
            return int(cur.lastrowid or 0)

    def atualizar(self, tabela: str, id_: Any, dados: dict[str, Any], chave: str = "id") -> None:
        sets = ", ".join(f"{k}=?" for k in dados)
        with self.tx() as c:
            c.execute(f"UPDATE {tabela} SET {sets} WHERE {chave}=?", [*[_val(v) for v in dados.values()], id_])  # noqa: S608


def _val(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    if v is not None and not isinstance(v, (str, int, float, bytes)):
        return str(v)
    return v
