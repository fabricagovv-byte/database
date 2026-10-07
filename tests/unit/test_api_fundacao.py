from fastapi.testclient import TestClient

from broker.api.main import create_app
from broker.config import Settings
from broker.logging_config import mascarar


def _ok(_: Settings) -> None:
    return None


def _falha(_: Settings) -> None:
    raise ConnectionError("indisponível")


def _cliente(verificadores):  # type: ignore[no-untyped-def]
    return TestClient(create_app(Settings(), verificadores=verificadores))


def test_health_ok_quando_dependencias_respondem():
    r = _cliente({"postgres": _ok, "redis": _ok}).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["componentes"] == {"postgres": "ok", "redis": "ok"}


def test_health_degradado_retorna_503():
    r = _cliente({"postgres": _ok, "redis": _falha}).get("/health")
    assert r.status_code == 503
    assert r.json()["status"] == "degradado"
    assert r.json()["componentes"]["redis"] == "falha: ConnectionError"


def test_cabecalhos_de_seguranca():
    r = _cliente({"postgres": _ok}).get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" in r.headers


def test_metrics_expoe_prometheus():
    cliente = _cliente({"postgres": _ok})
    cliente.get("/health")
    r = cliente.get("/metrics")
    assert r.status_code == 200
    assert "broker_http_requisicoes_total" in r.text


def test_openapi_documentado():
    r = _cliente({}).get("/openapi.json")
    assert r.json()["info"]["title"] == "Cloud Broker CVM — API"


def test_mascaramento_lgpd():
    texto = mascarar("Usuário joao.silva@cvm.gov.br CPF 123.456.789-09")
    assert "joao.silva" not in texto
    assert "123.456.789-09" not in texto
    assert "j***@cvm.gov.br" in texto
