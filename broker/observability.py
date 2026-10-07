"""OpenTelemetry: ativado apenas quando OTEL_EXPORTER_OTLP_ENDPOINT estiver definido."""

import os

from fastapi import FastAPI


def configurar_telemetria(app: FastAPI) -> bool:
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provedor = TracerProvider(resource=Resource.create({"service.name": "broker-api"}))
    provedor.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provedor)
    FastAPIInstrumentor.instrument_app(app)
    return True
