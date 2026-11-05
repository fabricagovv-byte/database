"""Adaptadores de cotações. Cada um devolve dicionários no formato que a página usa:

{id, simbolo, nome, classe, moeda, preco, variacao_pct, horario (ISO), fonte, tipo, historico: [{t, c}]}

`tipo` distingue o dado: tempo_real (Binance), atrasada (bolsas ~15 min), indicativa (câmbio comercial).
Falhas de uma fonte não derrubam as outras; nada é inventado quando a fonte não responde.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx

from ..config import cfg

log = logging.getLogger(__name__)
UA = {"User-Agent": "Mozilla/5.0 (ChinaTrade/1.0)"}

# id interno → (nome, classe, moeda, símbolo na fonte)
B3 = {"PETR4": "Petrobras PN", "VALE3": "Vale ON", "ITUB4": "Itaú Unibanco PN", "BBDC4": "Bradesco PN", "BBAS3": "Banco do Brasil ON",
      "WEGE3": "WEG ON", "ABEV3": "Ambev ON", "MGLU3": "Magazine Luiza ON", "BOVA11": "iShares Ibovespa", "IVVB11": "iShares S&P 500 (BRL)"}
EUA = {"AAPL": "Apple", "NVDA": "NVIDIA", "MSFT": "Microsoft", "TSLA": "Tesla", "AMZN": "Amazon", "GOOGL": "Alphabet", "META": "Meta",
       "SPY": "SPDR S&P 500", "QQQ": "Invesco QQQ"}
INDICES = {"IBOV": ("Ibovespa", "^BVSP"), "SPX": ("S&P 500", "^GSPC"), "IXIC": ("Nasdaq Composite", "^IXIC"), "DJI": ("Dow Jones", "^DJI")}
CRIPTO = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "BNB": "BNB", "XRP": "XRP"}
MOEDAS = {"USD": "Dólar americano", "EUR": "Euro", "CNY": "Yuan chinês", "GBP": "Libra esterlina", "JPY": "Iene japonês",
          "CHF": "Franco suíço", "ARS": "Peso argentino"}


def _iso(ts: float | int) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat()


def _classe_acao(sid: str) -> tuple[str, str, str]:
    if sid in INDICES:
        return INDICES[sid][0], "indice", "pts"
    if sid in B3 or sid[-1:].isdigit():
        return B3.get(sid, sid), ("etf" if sid.endswith("11") else "acao_br"), "BRL"
    return EUA.get(sid, sid), ("etf" if sid in {"SPY", "QQQ"} else "acao_us"), "USD"


def simbolo_yahoo(sid: str) -> str:
    if sid in CRIPTO:
        return sid + "-USD"
    if len(sid) == 6 and sid.endswith("BRL") and sid[:3] in MOEDAS:
        return sid + "=X"
    if sid in INDICES:
        return INDICES[sid][1]
    return sid + ".SA" if (sid in B3 or sid[-1:].isdigit()) else sid


class Yahoo:
    """Yahoo Finance (endpoint público de gráficos, sem chave; uso não oficial, dados ~15 min atrasados)."""
    nome = "Yahoo Finance"

    def __init__(self, cliente: httpx.Client) -> None:
        self.c = cliente

    def cotar(self, sid: str) -> dict | None:
        r = self.c.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{simbolo_yahoo(sid)}",
                       params={"range": "6mo", "interval": "1d"}, headers=UA)
        r.raise_for_status()
        res = r.json()["chart"]["result"][0]
        meta = res["meta"]
        fech = res["indicators"]["quote"][0]["close"]
        hist = [{"t": _iso(t)[:10], "c": round(c, 4)} for t, c in zip(res.get("timestamp", []), fech, strict=False) if c is not None]
        preco = meta.get("regularMarketPrice")
        ant = meta.get("chartPreviousClose") or meta.get("previousClose")
        if len(hist) >= 2:
            ant = hist[-2]["c"] if hist[-1]["t"] == _iso(meta.get("regularMarketTime", 0))[:10] else hist[-1]["c"]
        tipo = "atrasada"
        if sid in CRIPTO:
            nome, classe, moeda, tipo = CRIPTO[sid], "cripto", "USD", "indicativa"
        elif simbolo_yahoo(sid).endswith("=X"):
            nome, classe, moeda, tipo = MOEDAS[sid[:3]], "moeda", "BRL", "indicativa"
        else:
            nome, classe, moeda = _classe_acao(sid)
        return {"id": sid, "simbolo": sid, "nome": nome, "classe": classe, "moeda": moeda, "preco": preco,
                "variacao_pct": (preco / ant - 1) * 100 if preco and ant else None, "horario": _iso(meta.get("regularMarketTime", 0)),
                "fonte": self.nome, "tipo": tipo, "historico": hist[-180:]}


class Brapi:
    """brapi.dev para a B3 (precisa de BRAPI_TOKEN)."""
    nome = "brapi.dev"

    def __init__(self, cliente: httpx.Client, token: str) -> None:
        self.c, self.token = cliente, token

    def cotar(self, sid: str) -> dict | None:
        r = self.c.get(f"https://brapi.dev/api/quote/{sid}", params={"range": "6mo", "interval": "1d", "token": self.token})
        r.raise_for_status()
        q = r.json()["results"][0]
        nome, classe, moeda = _classe_acao(sid)
        hist = [{"t": _iso(h["date"])[:10], "c": h["close"]} for h in q.get("historicalDataPrice", []) if h.get("close") is not None]
        hist.sort(key=lambda h: h["t"])
        return {"id": sid, "simbolo": sid, "nome": q.get("longName") or nome, "classe": classe, "moeda": moeda,
                "preco": q.get("regularMarketPrice"), "variacao_pct": q.get("regularMarketChangePercent"),
                "horario": q.get("regularMarketTime"), "fonte": self.nome, "tipo": "atrasada", "historico": hist}


class AlphaVantage:
    """Alpha Vantage para ações americanas (precisa de ALPHAVANTAGE_KEY; plano gratuito tem limite diário baixo)."""
    nome = "Alpha Vantage"

    def __init__(self, cliente: httpx.Client, chave: str) -> None:
        self.c, self.chave = cliente, chave

    def cotar(self, sid: str) -> dict | None:
        r = self.c.get("https://www.alphavantage.co/query", params={"function": "GLOBAL_QUOTE", "symbol": sid, "apikey": self.chave})
        r.raise_for_status()
        q = r.json().get("Global Quote") or {}
        if not q.get("05. price"):
            return None
        nome, classe, moeda = _classe_acao(sid)
        return {"id": sid, "simbolo": sid, "nome": nome, "classe": classe, "moeda": moeda, "preco": float(q["05. price"]),
                "variacao_pct": float(q["10. change percent"].rstrip("%")), "horario": q.get("07. latest trading day"),
                "fonte": self.nome, "tipo": "atrasada", "historico": []}


class Binance:
    """Binance, API pública: preço do par USDT no momento da consulta (tempo real) e fechamentos diários."""
    nome = "Binance"

    def __init__(self, cliente: httpx.Client) -> None:
        self.c = cliente

    def cotar(self, sid: str) -> dict | None:
        par = sid + "USDT"
        t = self.c.get("https://api.binance.com/api/v3/ticker/24hr", params={"symbol": par})
        t.raise_for_status()
        q = t.json()
        k = self.c.get("https://api.binance.com/api/v3/klines", params={"symbol": par, "interval": "1d", "limit": 180})
        k.raise_for_status()
        hist = [{"t": _iso(v[0] / 1000)[:10], "c": float(v[4])} for v in k.json()]
        return {"id": sid, "simbolo": sid, "nome": CRIPTO.get(sid, sid), "classe": "cripto", "moeda": "USD", "preco": float(q["lastPrice"]),
                "variacao_pct": float(q["priceChangePercent"]), "horario": _iso(q["closeTime"] / 1000), "fonte": "Binance (" + par + ")",
                "tipo": "tempo_real", "historico": hist}


class AwesomeAPI:
    """AwesomeAPI (economia.awesomeapi.com.br): câmbio comercial indicativo e histórico diário, sem chave."""
    nome = "AwesomeAPI"

    def __init__(self, cliente: httpx.Client) -> None:
        self.c = cliente

    def cotar(self, moeda: str) -> dict | None:
        r = self.c.get(f"https://economia.awesomeapi.com.br/json/last/{moeda}-BRL")
        r.raise_for_status()
        q = r.json()[f"{moeda}BRL"]
        h = self.c.get(f"https://economia.awesomeapi.com.br/json/daily/{moeda}-BRL/180")
        h.raise_for_status()
        hist = sorted(({"t": _iso(int(x["timestamp"]))[:10], "c": float(x["bid"])} for x in h.json()), key=lambda x: x["t"])
        dedup = list({x["t"]: x for x in hist}.values())
        return {"id": moeda + "BRL", "simbolo": moeda + "BRL", "nome": MOEDAS.get(moeda, moeda), "classe": "moeda", "moeda": "BRL",
                "preco": float(q["bid"]), "variacao_pct": float(q["pctChange"]), "horario": _iso(int(q["timestamp"])),
                "fonte": "AwesomeAPI (comercial)", "tipo": "indicativa", "historico": dedup}


class PtaxBCB:
    """PTAX do Banco Central (oficial, uma vez por dia). Útil para conferir o câmbio da DI/Duimp."""
    nome = "Banco Central PTAX"

    def __init__(self, cliente: httpx.Client) -> None:
        self.c = cliente

    def cotar(self, moeda: str, data: datetime | None = None) -> dict | None:
        d = (data or datetime.now(UTC)).strftime("%m-%d-%Y")
        r = self.c.get("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)",
                       params={"@moeda": f"'{moeda}'", "@dataCotacao": f"'{d}'", "$format": "json"})
        r.raise_for_status()
        v = r.json().get("value") or []
        if not v:
            return None
        u = v[-1]
        return {"id": moeda + "BRL", "simbolo": moeda + "BRL", "nome": MOEDAS.get(moeda, moeda), "classe": "moeda", "moeda": "BRL",
                "preco": u["cotacaoVenda"], "variacao_pct": None, "horario": u["dataHoraCotacao"], "fonte": "Banco Central PTAX",
                "tipo": "indicativa", "historico": []}


def universo(extras: list[str] | None = None) -> list[tuple[str, str]]:
    """Lista (tipo, id) de tudo que o coletor busca."""
    itens = [("acao", s) for s in [*B3, *EUA, *INDICES]] + [("cripto", s) for s in CRIPTO] + [("moeda", m) for m in MOEDAS]
    for e in extras or []:
        e = e.upper().strip()
        if not e or any(e == i for _, i in itens):
            continue
        if e.endswith("BRL") and len(e) == 6:
            itens.append(("moeda", e[:3]))
        elif e in {"ADA", "DOGE", "DOT", "AVAX", "LINK", "MATIC", "LTC", "TRX", "TON", "USDC"}:
            itens.append(("cripto", e))
        else:
            itens.append(("acao", e))
    return itens


def coletar(extras: list[str] | None = None, cliente: httpx.Client | None = None) -> tuple[list[dict], list[str]]:
    """Busca todas as cotações. Devolve (cotações, erros). Usa brapi/Alpha Vantage quando há chave, senão Yahoo."""
    c = cliente or httpx.Client(timeout=15, follow_redirects=True)
    yahoo, binance, fx = Yahoo(c), Binance(c), AwesomeAPI(c)
    brapi = Brapi(c, cfg.brapi_token) if cfg.brapi_token else None
    av = AlphaVantage(c, cfg.alphavantage_key) if cfg.alphavantage_key else None
    saida, erros = [], []
    for tipo, sid in universo(extras):
        try:
            if tipo in {"cripto", "moeda"}:
                # Binance bloqueia alguns países (451) e a AwesomeAPI limita pedidos (429): o Yahoo Finance é a reserva
                try:
                    q = binance.cotar(sid) if tipo == "cripto" else fx.cotar(sid)
                except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
                    q = None
                if q is None:
                    q = yahoo.cotar(sid if tipo == "cripto" else sid + "BRL")
            elif brapi and _classe_acao(sid)[2] == "BRL" and sid not in INDICES:
                q = brapi.cotar(sid)
            else:
                q = yahoo.cotar(sid)
                if q is None and av:
                    q = av.cotar(sid)
            if q and q.get("preco") is not None:
                saida.append(q)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as e:
            erros.append(f"{sid}: {type(e).__name__}: {e}"[:200])
    if cliente is None:
        c.close()
    if erros:
        log.warning("cotações com erro: %s", "; ".join(erros[:10]))
    return saida, erros
