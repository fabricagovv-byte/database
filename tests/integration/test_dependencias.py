"""Requer Postgres e Redis (docker compose up postgres redis). Pulado se indisponíveis."""

import pytest

from broker.api.health import checar
from broker.config import Settings

pytestmark = pytest.mark.integration


def test_postgres_e_redis_respondem():
    resultado = checar(Settings(health_timeout_s=1))
    if any(v != "ok" for v in resultado.values()):
        pytest.skip(f"dependências indisponíveis: {resultado}")
    assert resultado == {"postgres": "ok", "redis": "ok"}
