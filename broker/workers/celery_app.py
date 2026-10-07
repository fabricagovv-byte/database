"""Aplicação Celery (coleta de billing, inventário, apuração mensal, alertas)."""

from celery import Celery

from broker.config import get_settings

_settings = get_settings()

celery_app = Celery("broker", broker=_settings.redis_url, backend=_settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Sao_Paulo",
    enable_utc=True,
    task_acks_late=True,
    worker_hijack_root_logger=False,
)


@celery_app.task(name="broker.ping")
def ping() -> str:
    return "pong"
