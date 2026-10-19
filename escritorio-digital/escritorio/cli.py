"""Linha de comando: inicializar, servir, worker, relatorio, verificar-auditoria."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from pathlib import Path

from . import auditoria, motor
from . import servicos as sv
from .db import Banco


def _db() -> Banco:
    caminho = os.getenv("ESCRITORIO_DB", "dados/escritorio.db")
    Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    db = Banco(caminho)
    sv.inicializar(db)
    return db


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="escritorio")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("inicializar", help="cria empresa e administrador")
    i.add_argument("--razao-social", required=True)
    i.add_argument("--cnpj", required=True)
    i.add_argument("--admin-nome", default="Arthur Miguel")
    i.add_argument("--admin-email", required=True)
    i.add_argument("--whatsapp", help="número do administrador no formato internacional, só dígitos")
    s = sub.add_parser("servir")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--porta", type=int, default=8100)
    s.add_argument("--sem-worker", action="store_true")
    sub.add_parser("worker", help="worker de tarefas separado do servidor web")
    r = sub.add_parser("relatorio")
    r.add_argument("--empresa", type=int, default=1)
    sub.add_parser("verificar-auditoria")
    a = p.parse_args(argv)

    db = _db()
    if a.cmd == "inicializar":
        if db.um("SELECT id FROM empresa WHERE cnpj=?", a.cnpj):
            print("Empresa já existe.")
            return 1
        eid = sv.criar_empresa(db, {"razao_social": a.razao_social, "cnpj": a.cnpj}, "cli")
        senha = secrets.token_urlsafe(12)
        sv.criar_usuario(db, eid, a.admin_nome, a.admin_email, senha, "admin", a.whatsapp)
        print(json.dumps({"empresa_id": eid, "login": a.admin_email, "senha_inicial": senha,
                          "aviso": "Guarde a senha agora; ela não é exibida novamente."}, ensure_ascii=False, indent=2))
    elif a.cmd == "servir":
        import uvicorn

        from .api import criar_app

        if not os.getenv("ESCRITORIO_SEGREDO_LINKS"):
            print("Defina ESCRITORIO_SEGREDO_LINKS (32+ caracteres aleatórios) antes de servir.", file=sys.stderr)
            return 2
        uvicorn.run(criar_app(db, iniciar_worker=not a.sem_worker), host=a.host, port=a.porta, proxy_headers=True)
    elif a.cmd == "worker":
        w = motor.Worker(db)
        w.start()
        try:
            while w.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            w.parar.set()
    elif a.cmd == "relatorio":
        print(json.dumps(sv.relatorio_diario(db, a.empresa), ensure_ascii=False, indent=2, default=str))
    elif a.cmd == "verificar-auditoria":
        r = auditoria.verificar_cadeia(db)
        print(json.dumps(r, ensure_ascii=False))
        return 0 if r["integra"] else 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
