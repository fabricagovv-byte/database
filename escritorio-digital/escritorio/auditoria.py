"""Eventos de auditoria encadeados por SHA-256. Também alimentam o escritório ao vivo."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .db import Banco, agora

GENESIS = "0" * 64
_SEGREDOS = re.compile(
    r"(?i)(senha|password|token|secret|api[_-]?key|authorization|certificado)(\"?\s*[:=]\s*\"?)([^\s\",}]+)"
)
_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")


def sanitizar(texto: str) -> str:
    """Remove segredos e CPFs de textos que vão para log/evento."""
    texto = _SEGREDOS.sub(lambda m: f"{m.group(1)}{m.group(2)}***", texto)
    return _CPF.sub("***.***.***-**", texto)


def _hash(anterior: str, corpo: dict[str, Any]) -> str:
    bruto = anterior + json.dumps(corpo, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(bruto.encode()).hexdigest()


def registrar(
    db: Banco,
    tipo: str,
    resumo: str,
    *,
    ator_tipo: str = "sistema",
    ator_id: str = "sistema",
    empresa_id: int | None = None,
    contrato_id: int | None = None,
    oportunidade_id: int | None = None,
    objeto_tipo: str | None = None,
    objeto_id: Any = None,
    dados: dict[str, Any] | None = None,
) -> int:
    with db.tx() as c:
        ult = c.execute("SELECT hash FROM evento ORDER BY id DESC LIMIT 1").fetchone()
        anterior = ult["hash"] if ult else GENESIS
        corpo = {
            "empresa_id": empresa_id,
            "contrato_id": contrato_id,
            "oportunidade_id": oportunidade_id,
            "tipo": tipo,
            "ator_tipo": ator_tipo,
            "ator_id": ator_id,
            "objeto_tipo": objeto_tipo,
            "objeto_id": None if objeto_id is None else str(objeto_id),
            "resumo": sanitizar(resumo),
            "dados": sanitizar(json.dumps(dados or {}, ensure_ascii=False, default=str)),
            "criado_em": agora(),
        }
        h = _hash(anterior, corpo)
        cur = c.execute(
            "INSERT INTO evento (empresa_id, contrato_id, oportunidade_id, tipo, ator_tipo, ator_id, objeto_tipo,"
            " objeto_id, resumo, dados, criado_em, hash_anterior, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (*corpo.values(), anterior, h),
        )
        eid = int(cur.lastrowid or 0)
        if ator_tipo == "agente":
            c.execute("UPDATE agente SET ultimo_evento_id=? WHERE id=?", (eid, ator_id))
        return eid


def verificar_cadeia(db: Banco) -> dict[str, Any]:
    anterior = GENESIS
    n = 0
    for e in db.todos("SELECT * FROM evento ORDER BY id"):
        corpo = {k: e[k] for k in (
            "empresa_id", "contrato_id", "oportunidade_id", "tipo", "ator_tipo", "ator_id", "objeto_tipo",
            "objeto_id", "resumo", "dados", "criado_em")}
        if e["hash_anterior"] != anterior or _hash(anterior, corpo) != e["hash"]:
            return {"integra": False, "evento_corrompido": e["id"], "verificados": n}
        anterior = e["hash"]
        n += 1
    return {"integra": True, "verificados": n, "ultimo_hash": anterior}
