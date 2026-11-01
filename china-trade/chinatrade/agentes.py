"""Os 7 agentes no servidor. Cada um devolve resultado, fontes e limitações; a API grava o histórico em agentes_log.

Não há previsão de preço como certeza nem envio de ordens: os agentes só leem dados e calculam.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .dominio import indicadores as ind
from .dominio.importacao import FaltamDados, custo_importacao
from .integracoes import china

AGENTES = {
    "market_watch": "MARKET WATCH", "crypto_radar": "CRYPTO RADAR", "forex_monitor": "FOREX MONITOR", "china_scanner": "CHINA SCANNER",
    "trend_hunter": "TREND HUNTER", "import_analyst": "IMPORT ANALYST", "crm_assistant": "CRM ASSISTANT",
}


def cambio_de(cots: dict[str, dict], cfg_usuario: dict | None = None) -> dict[str, float]:
    c = {k[:3]: float(v["preco"]) for k, v in cots.items() if v.get("classe") == "moeda" and v.get("preco")}
    for m, v in ((cfg_usuario or {}).get("cambio_manual") or {}).items():
        c.setdefault(m, float(v))
    return c


def _fmt(v: float | None, d: int = 2) -> str:
    return "—" if v is None else f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _linha_ativo(q: dict, anual: int = 252) -> str:
    a = [float(p["c"]) for p in q.get("historico") or []]
    vol, rsi = ind.volatilidade(a, anual), ind.rsi(a)
    var = q.get("variacao_pct")
    forte = vol and var is not None and abs(var) > vol / (252 ** 0.5) * 2
    return (f"{q['id']}: {_fmt(q.get('preco'))} ({_fmt(var)}%) RSI {_fmt(rsi, 0)} vol. {_fmt(vol, 0)}%"
            f"{' — movimento acima de 2 desvios' if forte else ''} [{q.get('tipo')}, {q.get('fonte')}]")


def executar(agente: str, meus: dict[str, list[dict]], cots: dict[str, dict]) -> dict:
    cfg_u = next(iter(meus.get("config", [])), {})
    cambio = cambio_de(cots, cfg_u)
    nome = AGENTES[agente]
    if agente == "market_watch":
        alvos = {w["simbolo"].upper() for w in meus.get("watchlist", [])} | {"IBOV", "SPX", "PETR4", "VALE3", "AAPL", "NVDA"}
        linhas = [_linha_ativo(cots[s]) for s in sorted(alvos) if s in cots]
        return {"agente": nome, "resultado": "\n".join(linhas) or "Sem cotações coletadas.", "fontes": "Yahoo Finance / brapi (atrasadas)",
                "limitacoes": "Indicadores sobre fechamentos diários; não considera notícias nem volume."}
    if agente == "crypto_radar":
        cs = sorted((q for q in cots.values() if q.get("classe") == "cripto"), key=lambda q: -abs(q.get("variacao_pct") or 0))
        return {"agente": nome, "resultado": "\n".join(_linha_ativo(q, 365) for q in cs) or "Sem cotações de cripto.", "fontes": "Binance",
                "limitacoes": "Variação das últimas 24 h; mercado aberto 24/7."}
    if agente == "forex_monitor":
        fx = [q for q in cots.values() if q.get("classe") == "moeda"]
        total = 0.0
        for p in meus.get("produtos", []):
            try:
                total += custo_importacao(p, cambio, cfg_u).total
            except FaltamDados:
                pass
        txt = "\n".join(_linha_ativo(q) for q in fx)
        if total:
            txt += f"\nCusto total do catálogo: R$ {_fmt(total)}; cada 1% de alta do câmbio ≈ R$ {_fmt(total * 0.01)}."
        return {"agente": nome, "resultado": txt or "Sem câmbio coletado.", "fontes": "AwesomeAPI (comercial)",
                "limitacoes": "Estimativa linear; parcelas fixas não variam com o câmbio."}
    if agente == "china_scanner":
        termos = [p.get("categoria") or p.get("nome") for p in meus.get("produtos", []) if p.get("status") != "descartado"][:5]
        linhas = []
        for t in filter(None, termos):
            tr = china.traduzir(t)
            linhas.append(f"{t} → zh: {tr['zh'] or '—'} / en: {tr['en'] or '—'} ({tr['fonte']})")
            linhas += [f"  {x['plataforma']}: {x['url']}" for x in china.links_busca(t, tr["zh"], tr["en"])]
        return {"agente": nome, "resultado": "\n".join(linhas) or "Cadastre produtos para gerar buscas.", "fontes": "links oficiais de busca; Aliyun MT",
                "limitacoes": "Sem credencial da Open Platform o agente gera links; não lê preços dos anúncios."}
    if agente in {"trend_hunter", "import_analyst"}:
        linhas, faltam = [], []
        for p in meus.get("produtos", []):
            try:
                c = custo_importacao(p, cambio, cfg_u)
                linhas.append((c.margem_pct if c.margem_pct is not None else -999,
                               f"{p.get('nome')}: custo R$ {_fmt(c.unit)}/un. (lote {c.qtd:.0f}); câmbio +5% ≈ R$ {_fmt(c.unit * 1.05)}; margem {_fmt(c.margem_pct, 1)}%"))
            except FaltamDados as e:
                faltam.append(f"{p.get('nome')}: {e}")
        linhas.sort(key=lambda x: -x[0])
        txt = "\n".join(t for _, t in linhas) + ("\nSem cálculo:\n" + "\n".join(faltam) if faltam else "")
        tend = [f"{t['termo']}: interesse {t['serie'][-1]['valor'] if t.get('serie') else '?'}" for t in meus.get("tendencias", [])]
        if agente == "trend_hunter" and tend:
            txt += "\nGoogle Trends:\n" + "\n".join(tend)
        return {"agente": nome, "resultado": txt or "Nenhum produto.", "fontes": "seu catálogo, câmbio coletado, tributos de Configurações",
                "limitacoes": "Tributos estimados; confirme NCM e regime com despachante."}
    # crm_assistant
    hoje = datetime.now(UTC).date().isoformat()
    sete = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    linhas = [f"Tarefa vencida: {t.get('titulo')} ({t.get('prazo')})" for t in meus.get("tarefas", []) if not t.get("feita") and (t.get("prazo") or "9") <= hoje]
    linhas += [f"Negociação parada há 7+ dias: {p.get('nome')}" for p in meus.get("produtos", [])
               if p.get("status") in {"negociando", "cotado"} and (p.get("atualizado_em") or "") < sete]
    vistos: set[str] = set()
    for lk in meus.get("links", []):
        u = (lk.get("url") or "").rstrip("/")
        if u in vistos:
            linhas.append(f"Link duplicado: {lk.get('titulo') or u}")
        vistos.add(u)
    com_contato = {c.get("fornecedor_id") for c in meus.get("contatos", [])}
    linhas += [f"Fornecedor sem contato: {f.get('nome')}" for f in meus.get("fornecedores", []) if f.get("id") not in com_contato]
    return {"agente": nome, "resultado": "\n".join(linhas) or "Tudo em dia.", "fontes": "seus cadastros",
            "limitacoes": "Só vê o que está cadastrado no sistema."}
