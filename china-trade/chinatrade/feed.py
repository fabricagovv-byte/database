"""Monta o documento de cotações (coleção `cotacoes_feed`) da página no claude.ai, juntando o histórico.

Só biblioteca padrão: roda com `python3 -m chinatrade.feed` mesmo sem instalar o projeto.

Cada atualização vira um ponto novo no gráfico de cada ativo. Quando a fonte já traz histórico longo
(coletor com Yahoo/Binance/AwesomeAPI), ele é usado; senão, o histórico anterior recebe o ponto novo.
Ativos que não vieram nesta atualização continuam com o último valor (marcados pelo horário antigo).

Uso:
  python3 -m chinatrade.feed --anterior ultimo.json --novos novos.json --saida feed.json [--origem "texto"]

`novos.json` pode ser uma lista de cotações, {"cotacoes": [...]} (saída do coletor) ou {"itens": [...]}.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

MAX_PONTOS = 300


def _itens(dados: object) -> list[dict]:
    if isinstance(dados, list):
        return dados
    if isinstance(dados, dict):
        for k in ("itens", "cotacoes"):
            if isinstance(dados.get(k), list):
                return dados[k]
        if isinstance(dados.get("data"), dict):
            return _itens(dados["data"])
    return []


def _pontos(q: dict) -> list[dict]:
    pts = [p for p in q.get("historico") or [] if p.get("c") is not None and p.get("t")]
    if q.get("preco") is not None and q.get("horario"):
        pts.append({"t": q["horario"], "c": q["preco"]})
    return pts


def mesclar(anterior: list[dict], novos: list[dict], origem: str, agora: datetime | None = None) -> dict:
    agora = agora or datetime.now(UTC)
    saida = {q["id"]: dict(q) for q in anterior if q.get("id")}
    for n in novos:
        if not n.get("id") or n.get("preco") is None:
            continue
        velho = saida.get(n["id"], {})
        if len(n.get("historico") or []) >= 20:  # fonte com histórico próprio (diário)
            hist = list(n["historico"])
            if n.get("horario"):
                hist.append({"t": n["horario"], "c": n["preco"]})
        else:
            hist = _pontos(velho) + _pontos({**n, "historico": n.get("historico") or []})
        # um ponto por horário; ordem cronológica
        por_t = {p["t"]: p for p in hist}
        n = {**velho, **n, "historico": sorted(por_t.values(), key=lambda p: p["t"])[-MAX_PONTOS:]}
        saida[n["id"]] = n
    for q in saida.values():
        q["historico"] = sorted({p["t"]: p for p in q.get("historico") or []}.values(), key=lambda p: p["t"])[-MAX_PONTOS:]
    return {"gerado_em": agora.isoformat().replace("+00:00", "Z"), "origem": origem, "itens": list(saida.values())}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="chinatrade.feed")
    p.add_argument("--anterior", help="JSON do último documento de cotacoes_feed (pode faltar)")
    p.add_argument("--novos", required=True)
    p.add_argument("--saida", required=True)
    p.add_argument("--origem", default="atualização agendada")
    a = p.parse_args(argv)
    anterior = _itens(json.loads(Path(a.anterior).read_text(encoding="utf-8"))) if a.anterior and Path(a.anterior).exists() else []
    novos = _itens(json.loads(Path(a.novos).read_text(encoding="utf-8")))
    doc = mesclar(anterior, novos, a.origem)
    texto = json.dumps(doc, ensure_ascii=False)
    while len(texto.encode()) > 240_000:  # limite de 256 KB por documento
        for q in doc["itens"]:
            q["historico"] = q["historico"][len(q["historico"]) // 4:]
        texto = json.dumps(doc, ensure_ascii=False)
    Path(a.saida).write_text(texto, encoding="utf-8")
    com_hist = sum(len(q["historico"]) >= 2 for q in doc["itens"])
    print(f"{len(doc['itens'])} ativos ({len(novos)} novos), {com_hist} com gráfico, {len(texto)} bytes → {a.saida}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
