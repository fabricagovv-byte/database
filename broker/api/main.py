"""Aplicação FastAPI do Cloud Broker."""

import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from broker import __version__
from broker.api import health
from broker.config import Settings, get_settings
from broker.logging_config import configurar_logs
from broker.observability import configurar_telemetria

REQUISICOES = Counter("broker_http_requisicoes_total", "Requisições HTTP", ["metodo", "rota", "status"])
LATENCIA = Histogram("broker_http_latencia_segundos", "Latência das requisições HTTP", ["metodo", "rota"])

CABECALHOS_SEGURANCA = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def create_app(
    settings: Settings | None = None,
    verificadores: dict[str, health.Verificador] | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configurar_logs(settings.log_level)
    app = FastAPI(
        title="Cloud Broker CVM — API",
        description="API da Plataforma de Gestão Multinuvem (PE CVM 90016/2026).",
        version=__version__,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def seguranca_e_metricas(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        inicio = time.perf_counter()
        resposta = await call_next(request)
        rota = request.scope.get("route")
        caminho = getattr(rota, "path", "desconhecida")
        LATENCIA.labels(request.method, caminho).observe(time.perf_counter() - inicio)
        REQUISICOES.labels(request.method, caminho, str(resposta.status_code)).inc()
        for nome, valor in CABECALHOS_SEGURANCA.items():
            resposta.headers.setdefault(nome, valor)
        return resposta

    @app.get("/health", tags=["operação"], summary="Saúde da API e das dependências")
    def saude() -> JSONResponse:
        componentes = health.checar(settings, verificadores)
        ok = all(v == "ok" for v in componentes.values())
        corpo = {"status": "ok" if ok else "degradado", "versao": __version__, "componentes": componentes}
        return JSONResponse(corpo, status_code=200 if ok else 503)

    @app.get("/metrics", tags=["operação"], summary="Métricas no formato Prometheus")
    def metricas() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    configurar_telemetria(app)
    return app
