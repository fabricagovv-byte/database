"""Indicadores técnicos. Mesmas fórmulas de web/app.js (objeto Ind)."""

from __future__ import annotations

import math


def sma(a: list[float], p: int) -> list[float | None]:
    return [None if i < p - 1 else sum(a[i - p + 1:i + 1]) / p for i in range(len(a))]


def ema(a: list[float], p: int) -> list[float | None]:
    k, out, e = 2 / (p + 1), [], 0.0
    for i, x in enumerate(a):
        if i < p - 1:
            out.append(None)
            continue
        e = sum(a[:p]) / p if i == p - 1 else x * k + e * (1 - k)
        out.append(e)
    return out


def rsi(a: list[float], p: int = 14) -> float | None:
    """RSI de Wilder."""
    if len(a) <= p:
        return None
    g = sum(max(a[i] - a[i - 1], 0) for i in range(1, p + 1)) / p
    perda = sum(max(a[i - 1] - a[i], 0) for i in range(1, p + 1)) / p
    for i in range(p + 1, len(a)):
        d = a[i] - a[i - 1]
        g = (g * (p - 1) + max(d, 0)) / p
        perda = (perda * (p - 1) + max(-d, 0)) / p
    return 100.0 if perda == 0 else 100 - 100 / (1 + g / perda)


def macd(a: list[float]) -> dict[str, float] | None:
    e12, e26 = ema(a, 12), ema(a, 26)
    linha = [x - y for x, y in zip(e12, e26, strict=True) if x is not None and y is not None]
    if len(linha) < 9:
        return None
    sinal = ema(linha, 9)[-1]
    assert sinal is not None
    return {"macd": linha[-1], "sinal": sinal, "hist": linha[-1] - sinal}


def volatilidade(a: list[float], anual: int = 252) -> float | None:
    """Desvio padrão dos últimos 30 retornos logarítmicos, anualizado, em %."""
    r = [math.log(a[i] / a[i - 1]) for i in range(1, len(a)) if a[i - 1] > 0 and a[i] > 0][-30:]
    if len(r) < 5:
        return None
    m = sum(r) / len(r)
    v = sum((x - m) ** 2 for x in r) / (len(r) - 1)
    return math.sqrt(v) * math.sqrt(anual) * 100


def niveis(a: list[float], janela: int = 60) -> dict[str, float]:
    u = a[-janela:]
    sup, res = [], []
    for i in range(2, len(u) - 2):
        viz = [u[i - 2], u[i - 1], u[i + 1], u[i + 2]]
        if u[i] <= min(viz):
            sup.append(u[i])
        if u[i] >= max(viz):
            res.append(u[i])
    p = a[-1]
    abaixo = sorted((x for x in sup if x < p), reverse=True)
    acima = sorted(x for x in res if x > p)
    return {"suporte": abaixo[0] if abaixo else min(u), "resistencia": acima[0] if acima else max(u)}


def backtest(a: list[float], rapida: int = 9, lenta: int = 21, custo_pct: float = 0.1) -> dict | None:
    """Cruzamento de médias, só comprado, capital inicial 10.000. Simulação histórica."""
    if len(a) < lenta + 2:
        return None
    fa, sl = sma(a, rapida), sma(a, lenta)
    caixa, qtd, entrada, pico, dd = 10000.0, 0.0, 0.0, 10000.0, 0.0
    ops: list[dict] = []
    for i in range(lenta, len(a)):
        f0, f1, s0, s1 = fa[i - 1], fa[i], sl[i - 1], sl[i]
        assert f0 is not None and f1 is not None and s0 is not None and s1 is not None
        if qtd == 0 and f0 <= s0 and f1 > s1:
            qtd, entrada, caixa = caixa * (1 - custo_pct / 100) / a[i], a[i], 0.0
            ops.append({"i": i, "lado": "compra", "preco": a[i]})
        elif qtd > 0 and f0 >= s0 and f1 < s1:
            caixa = qtd * a[i] * (1 - custo_pct / 100)
            ops.append({"i": i, "lado": "venda", "preco": a[i], "ganho": a[i] / entrada - 1})
            qtd = 0.0
        pat = caixa + qtd * a[i]
        pico = max(pico, pat)
        dd = max(dd, 1 - pat / pico)
    final = caixa + qtd * a[-1]
    vendas = [o for o in ops if o["lado"] == "venda"]
    return {"retorno": (final / 10000 - 1) * 100, "compra_e_mantem": (a[-1] / a[lenta] - 1) * 100,
            "operacoes": len(ops), "acerto": (sum(o["ganho"] > 0 for o in vendas) / len(vendas) * 100) if vendas else None,
            "drawdown": dd * 100}
