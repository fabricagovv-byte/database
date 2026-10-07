"""Logs estruturados em JSON, com mascaramento de dados pessoais (LGPD)."""

import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_EMAIL = re.compile(r"\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")


def mascarar(texto: str) -> str:
    """Mascara CPF e e-mail em mensagens de log."""
    texto = _CPF.sub("***.***.***-**", texto)
    return _EMAIL.sub(r"\1***@\2", texto)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        dados: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "nivel": record.levelname,
            "logger": record.name,
            "mensagem": mascarar(record.getMessage()),
        }
        extra = getattr(record, "contexto", None)
        if isinstance(extra, dict):
            dados["contexto"] = {k: mascarar(str(v)) for k, v in extra.items()}
        if record.exc_info:
            dados["excecao"] = self.formatException(record.exc_info)
        return json.dumps(dados, ensure_ascii=False)


def configurar_logs(nivel: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    raiz = logging.getLogger()
    raiz.handlers[:] = [handler]
    raiz.setLevel(nivel)
