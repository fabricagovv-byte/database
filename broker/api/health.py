"""Verificação de saúde das dependências (Postgres e Redis)."""

from collections.abc import Callable

import redis
from sqlalchemy import create_engine, text

from broker.config import Settings

Verificador = Callable[[Settings], None]


def verificar_postgres(settings: Settings) -> None:
    engine = create_engine(
        settings.database_url, connect_args={"connect_timeout": int(settings.health_timeout_s) or 1}
    )
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()


def verificar_redis(settings: Settings) -> None:
    cliente = redis.Redis.from_url(settings.redis_url, socket_timeout=settings.health_timeout_s)
    try:
        cliente.ping()
    finally:
        cliente.close()


VERIFICADORES: dict[str, Verificador] = {"postgres": verificar_postgres, "redis": verificar_redis}


def checar(settings: Settings, verificadores: dict[str, Verificador] | None = None) -> dict[str, str]:
    resultado: dict[str, str] = {}
    for nome, verificar in (verificadores or VERIFICADORES).items():
        try:
            verificar(settings)
            resultado[nome] = "ok"
        except Exception as exc:  # qualquer falha de dependência degrada a saúde
            resultado[nome] = f"falha: {type(exc).__name__}"
    return resultado
