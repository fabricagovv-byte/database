"""Trabalhador agendado: coleta cotações, guarda o histórico, avalia alertas de todos os usuários e envia avisos.

Roda sozinho (`chinatrade worker`) ou dentro da API (CT_WORKER_EMBUTIDO=1). Funciona com o painel fechado.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from . import seguranca as seg
from .config import cfg
from .db import Cotacao, Documento, Usuario, sessao
from .integracoes import mercado, outras

log = logging.getLogger(__name__)
ESPERA_ALERTA = timedelta(hours=6)


def _docs(s, uid: int, col: str) -> list[Documento]:
    return list(s.scalars(select(Documento).where(Documento.usuario_id == uid, Documento.colecao == col)))


def gravar_cotacoes(cots: list[dict]) -> None:
    with sessao() as s:
        for q in cots:
            c = s.get(Cotacao, q["id"])
            if c:
                c.dados, c.atualizado_em = q, datetime.now(UTC)
            else:
                s.add(Cotacao(id=q["id"], dados=q))
    if cfg.redis_url:
        try:
            import redis
            r = redis.from_url(cfg.redis_url)
            for q in cots:
                r.publish("ct:cotacoes", json.dumps(q, ensure_ascii=False))
                r.set("ct:cot:" + q["id"], json.dumps(q, ensure_ascii=False), ex=3600)
        except Exception as e:
            log.warning("Redis indisponível: %s", e)


def condicao(alerta: dict, cots: dict[str, dict], produtos: dict[str, dict], tarefas: list[dict], hoje: str) -> str | None:
    """Mesmas regras de web/app.js (verificarAlertas). Devolve a mensagem quando a condição foi atingida."""
    tipo, valor = alerta.get("tipo"), alerta.get("valor")
    q = cots.get((alerta.get("simbolo") or "").upper())
    if valor is None:
        return None
    if tipo == "preco_acima" and q and q["preco"] > valor:
        return f"{q['id']} acima de {valor}: {q['preco']} ({q['fonte']})"
    if tipo == "preco_abaixo" and q and q["preco"] < valor:
        return f"{q['id']} abaixo de {valor}: {q['preco']} ({q['fonte']})"
    if tipo == "variacao" and q and abs(q.get("variacao_pct") or 0) >= valor:
        return f"{q['id']} variou {q.get('variacao_pct'):.2f}% (limite ±{valor}%)"
    if tipo == "produto_preco":
        p = produtos.get(alerta.get("produto_id") or "")
        if p and p.get("preco_origem") is not None and float(p["preco_origem"]) <= valor:
            return f"{p.get('nome')} está a {p['preco_origem']} {p.get('moeda', 'CNY')} (alvo {valor})"
    if tipo == "tarefa_prazo":
        lim = (datetime.fromisoformat(hoje) + timedelta(days=float(valor))).date().isoformat()
        ts = [t for t in tarefas if not t.get("feita") and t.get("prazo") and t["prazo"] <= lim]
        if ts:
            return f"{len(ts)} tarefa(s) do CRM vencendo até {lim}: " + "; ".join(t.get("titulo", "") for t in ts)
    return None


def avaliar_alertas(cots: dict[str, dict]) -> int:
    disparos = 0
    hoje = datetime.now(UTC).date().isoformat()
    with sessao() as s:
        for u in s.scalars(select(Usuario).where(Usuario.ativo.is_(True))):
            alertas = _docs(s, u.id, "alertas")
            if not alertas:
                continue
            produtos = {d.doc_id: seg.decifrar_json(d.conteudo) for d in _docs(s, u.id, "produtos")}
            tarefas = [seg.decifrar_json(d.conteudo) for d in _docs(s, u.id, "tarefas")]
            conf = next((seg.decifrar_json(d.conteudo) for d in _docs(s, u.id, "config")), {})
            for d in alertas:
                a = seg.decifrar_json(d.conteudo)
                if not a.get("ativo"):
                    continue
                ult = a.get("ultimo_disparo")
                if ult and datetime.now(UTC) - datetime.fromisoformat(ult.replace("Z", "+00:00")) < ESPERA_ALERTA:
                    continue
                msg = condicao(a, cots, produtos, tarefas, hoje)
                if not msg:
                    continue
                canal = a.get("canal") or "painel"
                try:
                    entrega = ("painel" if canal == "painel" else outras.enviar_email(u.email, "Alerta China Trade", msg) if canal == "email"
                               else outras.enviar_whatsapp(conf.get("whatsapp_numero", ""), msg))
                except OSError as e:
                    entrega = f"falha: {e}"
                agora = datetime.now(UTC).isoformat()
                a["ultimo_disparo"] = agora
                d.conteudo = seg.cifrar(a)
                lid = secrets.token_hex(8)
                s.add(Documento(usuario_id=u.id, colecao="alertas_log", doc_id=lid, conteudo=seg.cifrar(
                    {"id": lid, "alerta_id": a.get("id"), "mensagem": msg, "canal": canal, "entrega": entrega, "criado_em": agora})))
                disparos += 1
    return disparos


def simbolos_extras() -> list[str]:
    extras: set[str] = set()
    with sessao() as s:
        for d in s.scalars(select(Documento).where(Documento.colecao.in_(["watchlist", "carteira"]))):
            extras.add(str(seg.decifrar_json(d.conteudo).get("simbolo", "")).upper())
    return sorted(e for e in extras if e)


def ciclo() -> dict:
    cots, erros = mercado.coletar(simbolos_extras())
    gravar_cotacoes(cots)
    with sessao() as s:
        todas = {c.id: c.dados for c in s.scalars(select(Cotacao))}
    disparos = avaliar_alertas(todas)
    log.info("ciclo: %d cotações, %d erros, %d alertas", len(cots), len(erros), disparos)
    return {"cotacoes": len(cots), "erros": erros, "alertas": disparos}


def laco() -> None:
    while True:
        try:
            ciclo()
        except Exception:
            log.exception("falha no ciclo do coletor")
        time.sleep(max(15, cfg.intervalo_cotacoes))
