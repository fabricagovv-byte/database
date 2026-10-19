FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git tesseract-ocr tesseract-ocr-por && rm -rf /var/lib/apt/lists/*
RUN useradd -m escritorio
WORKDIR /app
COPY pyproject.toml ./
COPY escritorio ./escritorio
RUN pip install --no-cache-dir -e . pytest
USER escritorio
ENV ESCRITORIO_DB=/dados/escritorio.db ESCRITORIO_ARQUIVOS=/dados/arquivos ESCRITORIO_SANDBOX_RAIZ=/dados/sandbox
EXPOSE 8100
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8100/health')"
CMD ["escritorio", "servir", "--host", "0.0.0.0", "--porta", "8100", "--sem-worker"]
