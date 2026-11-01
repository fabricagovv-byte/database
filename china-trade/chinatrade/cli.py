"""Linha de comando: servir, worker, criar-admin, coletar-cotacoes (inclusive no formato do banco do claude.ai)."""

from __future__ import annotations

import argparse
import json
import logging
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="chinatrade")
    sub = p.add_subparsers(dest="cmd", required=True)
    sv = sub.add_parser("servir", help="sobe a API e a página")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--porta", type=int, default=8000)
    sub.add_parser("worker", help="coleta cotações e avalia alertas em laço")
    sub.add_parser("ciclo", help="roda um ciclo do worker e sai")
    ca = sub.add_parser("criar-admin", help="cria (ou promove) um administrador")
    ca.add_argument("--email", required=True)
    ca.add_argument("--nome", default="Administrador")
    cc = sub.add_parser("coletar-cotacoes", help="coleta cotações e grava um arquivo JSON")
    cc.add_argument("--saida", required=True)
    cc.add_argument("--formato", choices=["lista", "artifact"], default="lista",
                    help="artifact = documento único para a coleção cotacoes_feed do claude.ai")
    cc.add_argument("--extras", nargs="*", default=[])
    tr = sub.add_parser("tendencias", help="Google Trends (pytrends) para até 5 termos")
    tr.add_argument("termos", nargs="+")
    a = p.parse_args(argv)

    if a.cmd == "servir":
        import uvicorn
        uvicorn.run("chinatrade.api:app", host=a.host, port=a.porta, proxy_headers=True)
    elif a.cmd == "worker":
        from .worker import laco
        laco()
    elif a.cmd == "ciclo":
        from .worker import ciclo
        print(json.dumps(ciclo(), ensure_ascii=False, indent=2))
    elif a.cmd == "criar-admin":
        from sqlalchemy import select

        from .db import Usuario, sessao
        from .seguranca import hash_senha
        senha = secrets.token_urlsafe(12) + "A1"
        with sessao() as s:
            u = s.scalar(select(Usuario).where(Usuario.email == a.email.lower()))
            if u:
                u.papel = "admin"
                print(f"{a.email} agora é administrador (senha mantida).")
            else:
                s.add(Usuario(nome=a.nome, email=a.email.lower(), senha_hash=hash_senha(senha), papel="admin"))
                print(f"Administrador criado: {a.email}\nSenha inicial: {senha}\nTroque a senha e ative o MFA no primeiro acesso.")
    elif a.cmd == "coletar-cotacoes":
        from .integracoes.mercado import coletar
        cots, erros = coletar(a.extras)
        if a.formato == "artifact":
            for q in cots:  # cabe em um documento de 256 KB
                q["historico"] = q.get("historico", [])[-120:]
            agora = datetime.now(UTC)
            doc = {"gerado_em": agora.isoformat(), "origem": "coletor China Trade", "itens": cots, "erros": erros[:20]}
            saida = {"collection": "cotacoes_feed", "doc_id": agora.strftime("%Y%m%dT%H%M%SZ"), "data": doc}
        else:
            saida = {"cotacoes": cots, "erros": erros}
        Path(a.saida).write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")
        print(f"{len(cots)} cotações, {len(erros)} erros → {a.saida}")
        return 0 if cots else 2
    elif a.cmd == "tendencias":
        from .integracoes.outras import tendencias
        print(json.dumps(tendencias(a.termos), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
