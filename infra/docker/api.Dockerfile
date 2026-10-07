
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --create-home --uid 10001 broker
COPY pyproject.toml README.md alembic.ini ./
COPY broker ./broker
# CA extra opcional (proxy corporativo): docker build --secret id=ca_extra,src=<arquivo.crt>
RUN --mount=type=secret,id=ca_extra,required=false \
    if [ -f /run/secrets/ca_extra ]; then export PIP_CERT=/run/secrets/ca_extra; fi; pip install .
COPY tests/aceitacao/dados ./dados-demo
USER broker
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
CMD ["uvicorn", "broker.api.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
