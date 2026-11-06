import math

import pytest

from chinatrade.dominio import indicadores as ind
from chinatrade.dominio.importacao import FaltamDados, custo_importacao
from chinatrade.seguranca import codigo_totp, conferir_senha, conferir_totp, hash_senha, senha_forte

PRODUTO = {"preco_origem": 18, "moeda": "CNY", "moq": 100, "qtd_lote": 500, "frete_total": 300, "frete_moeda": "USD",
           "modal": "maritimo", "regime": "formal", "preco_venda_br": 59.9}
CAMBIO = {"CNY": 0.75, "USD": 5.4}


def test_custo_formal_bate_com_a_pagina():
    # mesmos números exibidos pela página (web/app.js) com CNY 0,75 e USD 5,40, spread 1%
    c = custo_importacao(PRODUTO, CAMBIO)
    assert round(c.total, 2) == 14967.46
    assert round(c.unit, 2) == 29.93
    assert round(c.margem_pct, 1) == 34.0
    assert dict(c.linhas)["II"] == pytest.approx(1352.59, abs=0.01)
    assert dict(c.linhas)["ICMS"] == pytest.approx(2648.49, abs=0.01)


def test_remessa_ate_e_acima_de_50_dolares():
    pequeno = {"preco_origem": 9, "moeda": "USD", "qtd_lote": 3, "regime": "remessa"}  # US$ 27,27 com spread
    c = custo_importacao(pequeno, CAMBIO, {"spread_pct": 0})
    va = 27 * 5.4
    ii = va * 0.20
    assert dict(c.linhas)["Imposto de Importação"] == pytest.approx(ii)
    assert c.total == pytest.approx((va + ii) / 0.83)
    grande = {**pequeno, "qtd_lote": 20}  # US$ 180
    c2 = custo_importacao(grande, CAMBIO, {"spread_pct": 0})
    va2 = 180 * 5.4
    assert dict(c2.linhas)["Imposto de Importação"] == pytest.approx(va2 * 0.6 - 20 * 5.4)


def test_ii_especifico_do_ncm_e_falta_de_cambio():
    c = custo_importacao({**PRODUTO, "ii_pct": 0}, CAMBIO)
    assert dict(c.linhas)["II"] == 0
    with pytest.raises(FaltamDados, match="câmbio CNY"):
        custo_importacao(PRODUTO, {"USD": 5.4})


def test_indicadores_basicos():
    a = [float(x) for x in range(1, 41)]
    assert ind.sma(a, 5)[-1] == 38
    assert ind.rsi(a) == 100.0  # só altas
    queda = list(reversed(a))
    assert ind.rsi(queda) == pytest.approx(0.0)
    m = ind.macd(a)
    assert m and m["macd"] > 0
    ondas = [100 + 10 * math.sin(i / 4) for i in range(120)]
    v = ind.volatilidade(ondas)
    assert v and v > 0
    n = ind.niveis(ondas)
    assert n["suporte"] < ondas[-1] < n["resistencia"] or n["suporte"] <= ondas[-1]
    bt = ind.backtest(ondas, 5, 15, 0)
    assert bt and bt["operacoes"] >= 2 and 0 <= bt["drawdown"] < 100


def test_senha_e_totp():
    h = hash_senha("Senha-Forte-123")
    assert conferir_senha("Senha-Forte-123", h) and not conferir_senha("outra", h)
    assert senha_forte("curta") and senha_forte("semnumeroslongos") and senha_forte("Valida12345") is None
    # vetor do RFC 6238 (SHA1, T=59s): 94287082 → 6 dígitos 287082
    segredo = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert codigo_totp(segredo, 59) == "287082"
    assert conferir_totp(segredo, codigo_totp(segredo))


def test_feed_junta_historico_e_mantem_ativos_antigos():
    from chinatrade.feed import mesclar
    ant = [{"id": "BTC", "preco": 100.0, "horario": "2026-11-01T00:00:00Z", "historico": []},
           {"id": "PETR4", "preco": 52.2, "horario": "2026-10-29T20:00:00Z", "historico": []}]
    novos = [{"id": "BTC", "preco": 101.0, "horario": "2026-11-01T02:00:00Z", "fonte": "x"}]
    d = mesclar(ant, novos, "teste")
    btc = next(q for q in d["itens"] if q["id"] == "BTC")
    assert [p["c"] for p in btc["historico"]] == [100.0, 101.0] and btc["preco"] == 101.0
    assert any(q["id"] == "PETR4" for q in d["itens"])  # continua com o último valor
    d2 = mesclar(d["itens"], novos, "teste")  # repetir o mesmo horário não duplica
    assert len(next(q for q in d2["itens"] if q["id"] == "BTC")["historico"]) == 2
    longo = [{"id": "ETH", "preco": 5.0, "horario": "2026-11-01", "historico": [{"t": f"2026-10-{i:02d}", "c": i} for i in range(1, 31)]}]
    assert len(next(q for q in mesclar([], longo, "t")["itens"] if q["id"] == "ETH")["historico"]) == 31


def test_velas_compactas_e_feed_mantem_velas():
    from chinatrade.feed import mesclar
    from chinatrade.integracoes.mercado import _velas
    v = _velas([1793300000, 1793400000], {"open": [10.0, None], "high": [11.0, 12.0], "low": [9.5, 10.0], "close": [10.5, 11.5], "volume": [100, 200]})
    assert v == [["2026-10-29", 10.0, 11.0, 9.5, 10.5, 100]]  # vela incompleta é descartada
    ant = [{"id": "PETR4", "preco": 46.0, "horario": "2026-11-05T20:00:00Z", "velas": v, "historico": [{"t": f"2026-09-{i:02d}", "c": i} for i in range(1, 30)]}]
    d = mesclar(ant, [{"id": "PETR4", "preco": 47.0, "horario": "2026-11-06T15:00:00Z"}], "t")
    q = d["itens"][0]
    assert q["velas"] == v and q["preco"] == 47.0 and len(q["historico"]) <= 40
