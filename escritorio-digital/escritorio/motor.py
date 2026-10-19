"""Motor de tarefas: fila persistente no banco, lease + heartbeat, retentativas com backoff,
recuperação após reinício e registro de efeitos externos idempotentes."""

from __future__ import annotations

import json
import os
import socket
import threading
import time
import traceback
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from . import auditoria
from .db import Banco, agora
from .dominio.regras import validar_transicao

LEASE_S = 120
Handler = Callable[[Banco, dict[str, Any]], dict[str, Any]]
HANDLERS: dict[str, Handler] = {}


class Bloqueio(Exception):
    """Tarefa não pode prosseguir (integração ausente, dado faltando). Não conta como falha."""


class EfeitoIncerto(Exception):
    """Chamada externa pode ter sido executada; exige verificação antes de nova tentativa."""


def handler(tipo: str) -> Callable[[Handler], Handler]:
    def reg(f: Handler) -> Handler:
        HANDLERS[tipo] = f
        return f
    return reg


def _ts(delta_s: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(seconds=delta_s)).isoformat(timespec="seconds")


def mudar_estado(db: Banco, tarefa_id: int, para: str, ator: str = "sistema:motor", motivo: str = "",
                 **extra: Any) -> None:
    with db.tx() as c:
        t = c.execute("SELECT * FROM tarefa WHERE id=?", (tarefa_id,)).fetchone()
        validar_transicao(t["estado"], para)
        campos = {"estado": para, "atualizado_em": agora(), **extra}
        sets = ", ".join(f"{k}=?" for k in campos)
        vals = [json.dumps(v, ensure_ascii=False, default=str) if isinstance(v, (dict, list)) else v
                for v in campos.values()]
        c.execute(f"UPDATE tarefa SET {sets} WHERE id=?", [*vals, tarefa_id])  # noqa: S608
        if t["executor_tipo"] == "agente" and t["executor_id"]:
            estado_ag = {"executando": "trabalhando", "bloqueada": "bloqueado", "pausada": "pausado",
                         "aguardando_aprovacao": "aguardando", "aguardando_aceite": "aguardando",
                         "em_revisao": "aguardando", "falhou": "bloqueado"}.get(para, "disponivel")
            c.execute("UPDATE agente SET estado=?, tarefa_atual_id=? WHERE id=?",
                      (estado_ag, None if estado_ag == "disponivel" else tarefa_id, t["executor_id"]))
        ator_tipo, _, ator_id = ator.partition(":")
        auditoria.registrar(
            db, "tarefa.estado", f"Tarefa #{tarefa_id} '{t['titulo']}': {t['estado']} → {para}"
            + (f" — {motivo}" if motivo else ""),
            ator_tipo=ator_tipo, ator_id=ator_id or ator, empresa_id=t["empresa_id"], contrato_id=t["contrato_id"],
            oportunidade_id=t["oportunidade_id"], objeto_tipo="tarefa", objeto_id=tarefa_id,
            dados={"de": t["estado"], "para": para, "motivo": motivo})
        if t["executor_tipo"] == "agente" and t["executor_id"] and ator_tipo != "agente":
            # o último evento real do agente é a mudança da sua própria tarefa
            ult = c.execute("SELECT MAX(id) m FROM evento").fetchone()["m"]
            c.execute("UPDATE agente SET ultimo_evento_id=? WHERE id=?", (ult, t["executor_id"]))


def criar_tarefa(db: Banco, empresa_id: int, titulo: str, tipo: str, *, executor_tipo: str = "agente",
                 executor_id: str | None = None, estado: str = "pronta", idempotency_key: str | None = None,
                 parametros: dict[str, Any] | None = None, **ref: Any) -> int:
    if idempotency_key:
        ex = db.um("SELECT id FROM tarefa WHERE idempotency_key=?", idempotency_key)
        if ex:
            return int(ex["id"])
    tid = db.inserir("tarefa", {
        "empresa_id": empresa_id, "titulo": titulo, "tipo": tipo, "executor_tipo": executor_tipo,
        "executor_id": executor_id, "estado": estado, "idempotency_key": idempotency_key,
        "parametros": parametros or {}, "criado_em": agora(), "atualizado_em": agora(), **ref})
    auditoria.registrar(db, "tarefa.criada", f"Tarefa #{tid} criada: {titulo} → {executor_tipo}:{executor_id}",
                        empresa_id=empresa_id, contrato_id=ref.get("contrato_id"),
                        oportunidade_id=ref.get("oportunidade_id"), objeto_tipo="tarefa", objeto_id=tid,
                        dados={"tipo": tipo, "estado": estado})
    if executor_tipo == "agente" and executor_id and estado in ("aguardando_aprovacao", "bloqueada"):
        db.atualizar("agente", executor_id, {"estado": "aguardando" if estado != "bloqueada" else "bloqueado",
                                             "tarefa_atual_id": tid})
    return tid


def recuperar_orfas(db: Banco) -> int:
    """Tarefas 'executando' com lease vencido (worker morreu) voltam para 'pronta'."""
    orfas = db.todos("SELECT id FROM tarefa WHERE estado='executando' AND lease_ate < ?", agora())
    for o in orfas:
        mudar_estado(db, o["id"], "pronta", motivo="lease expirado: worker reiniciado/travado — recuperada",
                     worker=None, lease_ate=None)
    return len(orfas)


def reivindicar(db: Banco, worker: str) -> dict[str, Any] | None:
    with db.tx() as c:
        t = c.execute(
            "SELECT t.* FROM tarefa t LEFT JOIN tarefa d ON d.id=t.depende_de "
            "WHERE t.estado='pronta' AND (t.proxima_execucao IS NULL OR t.proxima_execucao<=?) "
            "AND (t.depende_de IS NULL OR d.estado='concluida') ORDER BY t.id LIMIT 1", (agora(),)).fetchone()
        if not t or t["tipo"] not in HANDLERS:
            return None
        mudar_estado(db, t["id"], "executando", worker=worker, lease_ate=_ts(LEASE_S), heartbeat_em=agora(),
                     tentativas=t["tentativas"] + 1)
        return dict(c.execute("SELECT * FROM tarefa WHERE id=?", (t["id"],)).fetchone())


def heartbeat(db: Banco, tarefa_id: int) -> None:
    db.atualizar("tarefa", tarefa_id, {"heartbeat_em": agora(), "lease_ate": _ts(LEASE_S)})


def executar_uma(db: Banco, worker: str = "worker") -> dict[str, Any] | None:
    t = reivindicar(db, worker)
    if not t:
        return None
    try:
        res = HANDLERS[t["tipo"]](db, t)
        prox = res.pop("_proximo_estado", "em_revisao")
        mudar_estado(db, t["id"], prox, ator=f"agente:{t['executor_id']}" if t["executor_tipo"] == "agente"
                     else "sistema:motor", motivo=res.get("resumo", ""), resultado=res, erro=None, lease_ate=None)
        return {"tarefa": t["id"], "ok": True, "resultado": res}
    except Bloqueio as b:
        mudar_estado(db, t["id"], "bloqueada", motivo=str(b), erro=str(b), lease_ate=None)
        return {"tarefa": t["id"], "ok": False, "bloqueio": str(b)}
    except EfeitoIncerto as ei:
        mudar_estado(db, t["id"], "bloqueada", motivo=f"efeito externo incerto: {ei}. Verificação necessária",
                     erro=str(ei), lease_ate=None)
        return {"tarefa": t["id"], "ok": False, "incerto": str(ei)}
    except Exception as ex:
        erro = auditoria.sanitizar(f"{type(ex).__name__}: {ex}\n{traceback.format_exc(limit=3)}")
        if t["tentativas"] >= t["max_tentativas"]:
            mudar_estado(db, t["id"], "falhou", motivo=f"esgotou {t['max_tentativas']} tentativas", erro=erro,
                         lease_ate=None)
            auditoria.registrar(db, "incidente.agente", f"Tarefa #{t['id']} falhou definitivamente — escalada ao "
                                "supervisor de incidentes", ator_tipo="agente", ator_id="supervisor-de-incidentes",
                                empresa_id=t["empresa_id"], objeto_tipo="tarefa", objeto_id=t["id"])
        else:
            espera = 2 ** t["tentativas"] * 5
            mudar_estado(db, t["id"], "pronta", motivo=f"falha; nova tentativa em {espera}s", erro=erro,
                         proxima_execucao=_ts(espera), lease_ate=None)
        return {"tarefa": t["id"], "ok": False, "erro": erro.splitlines()[0]}


# ---------------------------------------------------------------- efeitos externos
def efeito_unico(db: Banco, chave: str, tipo: str, executar: Callable[[], dict[str, Any]],
                 verificar: Callable[[], dict[str, Any] | None], tarefa_id: int | None = None) -> dict[str, Any]:
    """Garante no máximo uma execução de um efeito externo (nota, mensagem, implantação).

    - concluído antes → devolve a resposta registrada, sem chamar de novo;
    - iniciado e sem confirmação (queda no meio) → consulta `verificar()` antes de repetir;
    """
    ex = db.um("SELECT * FROM efeito_externo WHERE chave=?", chave)
    if ex and ex["situacao"] == "concluido":
        return {**json.loads(ex["resposta"]), "_reaproveitado": True}
    if ex and ex["situacao"] == "iniciado":
        # verificar() devolve o registro se o efeito aconteceu, None se o provedor confirma que não
        # aconteceu, ou levanta EfeitoIncerto se não é possível saber (então NÃO repetimos).
        achado = verificar()
        if achado is not None:
            db.atualizar("efeito_externo", chave, {"situacao": "concluido", "resposta": achado,
                                                   "atualizado_em": agora()}, chave="chave")
            return {**achado, "_recuperado_por_verificacao": True}
    if not ex:
        db.inserir("efeito_externo", {"chave": chave, "tarefa_id": tarefa_id, "tipo": tipo, "situacao": "iniciado",
                                      "criado_em": agora(), "atualizado_em": agora()})
    resp = executar()
    db.atualizar("efeito_externo", chave, {"situacao": "concluido", "resposta": resp, "atualizado_em": agora()},
                 chave="chave")
    return resp


# ---------------------------------------------------------------- worker contínuo
class Worker(threading.Thread):
    def __init__(self, db: Banco, intervalo: float = 1.0) -> None:
        super().__init__(daemon=True, name="escritorio-worker")
        self.db = db
        self.intervalo = intervalo
        self.parar = threading.Event()
        self.id = f"{socket.gethostname()}:{os.getpid()}"

    def run(self) -> None:
        recuperar_orfas(self.db)
        ultimo_hb = 0.0
        while not self.parar.is_set():
            try:
                if time.time() - ultimo_hb > 30:
                    self.db.atualizar("integracao", "worker", {"situacao": "ativo", "verificado_em": agora(),
                                                               "detalhe": self.id}, chave="nome")
                    ultimo_hb = time.time()
                    recuperar_orfas(self.db)
                if executar_uma(self.db, self.id) is None:
                    self.parar.wait(self.intervalo)
            except Exception:
                traceback.print_exc()
                self.parar.wait(5)
