"""Modelo de dados (SQLAlchemy 2). PostgreSQL em produção, SQLite no desenvolvimento e nos testes.

Os cadastros do usuário (produtos, fornecedores, CRM, links, vendas…) ficam em `documento`, um registro por item,
sempre com dono (`usuario_id`) e o conteúdo cifrado com Fernet. Cotações são globais (`cotacao`).
As migrações ficam em chinatrade/migrations (Alembic).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import cfg


def agora() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Usuario(Base):
    __tablename__ = "usuario"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nome: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    senha_hash: Mapped[str] = mapped_column(String(300))
    papel: Mapped[str] = mapped_column(String(20), default="analista")  # admin | analista | leitor
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    mfa_segredo: Mapped[str | None] = mapped_column(String(300), nullable=True)  # cifrado
    mfa_ativo: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)
    ultimo_acesso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Sessao(Base):
    __tablename__ = "sessao"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Redefinicao(Base):
    __tablename__ = "redefinicao_senha"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"))
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    usado: Mapped[bool] = mapped_column(Boolean, default=False)


class Documento(Base):
    __tablename__ = "documento"
    __table_args__ = (UniqueConstraint("usuario_id", "colecao", "doc_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    colecao: Mapped[str] = mapped_column(String(40), index=True)
    doc_id: Mapped[str] = mapped_column(String(200))
    conteudo: Mapped[str] = mapped_column(Text)  # JSON cifrado
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, onupdate=agora)


class Cotacao(Base):
    __tablename__ = "cotacao"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    dados: Mapped[dict] = mapped_column(JSON)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, index=True)


class Anexo(Base):
    __tablename__ = "anexo"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(300))
    tipo: Mapped[str] = mapped_column(String(120))
    tamanho: Mapped[int] = mapped_column(Integer)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)


class Auditoria(Base):
    __tablename__ = "auditoria"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quando: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, index=True)
    usuario_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    acao: Mapped[str] = mapped_column(String(60), index=True)
    detalhe: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)


_engine = None
_fabrica: sessionmaker[Session] | None = None


def engine():
    global _engine, _fabrica
    if _engine is None:
        args = {"check_same_thread": False} if cfg.database_url.startswith("sqlite") else {}
        _engine = create_engine(cfg.database_url, connect_args=args, pool_pre_ping=True)
        _fabrica = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def reiniciar(url: str | None = None) -> None:
    """Troca o banco (usado nos testes)."""
    global _engine, _fabrica
    if url:
        cfg.database_url = url
    _engine, _fabrica = None, None
    engine()


def criar_tabelas() -> None:
    """Para desenvolvimento e testes. Em produção use `alembic upgrade head`."""
    Base.metadata.create_all(engine())


@contextmanager
def sessao() -> Iterator[Session]:
    engine()
    assert _fabrica is not None
    s = _fabrica()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def auditar(s: Session, acao: str, usuario_id: int | None = None, email: str | None = None,
            detalhe: str | None = None, ip: str | None = None) -> None:
    s.add(Auditoria(acao=acao, usuario_id=usuario_id, email=email, detalhe=detalhe, ip=ip))


def contar_falhas(s: Session, email: str, desde: datetime) -> int:
    return len(s.scalars(select(Auditoria.id).where(Auditoria.acao == "login_falhou", Auditoria.email == email,
                                                    Auditoria.quando >= desde)).all())
