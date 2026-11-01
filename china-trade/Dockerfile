FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY chinatrade ./chinatrade
COPY web ./web
COPY alembic.ini ./
RUN pip install --no-cache-dir . && useradd -m app && mkdir -p /app/anexos && chown app /app/anexos
USER app
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && chinatrade servir --host 0.0.0.0 --porta 8000"]
