"""Custo nacionalizado de um lote importado. Mesmas fórmulas de web/app.js (custoImportacao).

Estimativa: II e IPI variam por NCM, e o ICMS é calculado "por dentro". Não substitui o despachante.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PADRAO: dict[str, float] = {
    "ii_pct": 16, "ipi_pct": 10, "pis_pct": 2.1, "cofins_pct": 9.65, "icms_pct": 18, "siscomex_brl": 154.23,
    "afrmm_pct": 8, "despesas_pct": 3, "remessa_icms_pct": 17, "remessa_ii_ate50_pct": 20,
    "remessa_ii_acima50_pct": 60, "remessa_deducao_usd": 20, "spread_pct": 1, "taxa_canal_pct": 16,
}


@dataclass
class Custo:
    qtd: float
    total: float
    unit: float
    linhas: list[tuple[str, float]] = field(default_factory=list)
    margem_pct: float | None = None
    liquido_unit: float | None = None


class FaltamDados(ValueError):
    pass


def _num(v: object) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def custo_importacao(produto: dict, cambio: dict[str, float], cfg: dict | None = None) -> Custo:
    """`cambio` traz quantos reais vale 1 unidade de cada moeda, ex.: {"CNY": 0.75, "USD": 5.4}."""
    c = {**PADRAO, **(cfg or {})}
    cambio = {"BRL": 1.0, **cambio}
    qtd = _num(produto.get("qtd_lote")) or _num(produto.get("moq")) or 1.0
    moeda, moeda_frete = produto.get("moeda") or "CNY", produto.get("frete_moeda") or "USD"
    preco = _num(produto.get("preco_origem"))
    faltam = [n for n, ok in [("preço observado", preco is not None), (f"câmbio {moeda}", moeda in cambio),
                              ("câmbio USD", "USD" in cambio),
                              (f"câmbio {moeda_frete}", not _num(produto.get("frete_total")) or moeda_frete in cambio)] if not ok]
    if faltam:
        raise FaltamDados("Faltam: " + ", ".join(faltam))
    assert preco is not None
    sp = 1 + c["spread_pct"] / 100
    fob = preco * qtd * cambio[moeda] * sp
    frete = (_num(produto.get("frete_total")) or 0) * cambio.get(moeda_frete, 0) * sp
    linhas: list[tuple[str, float]] = [("Mercadoria (FOB)", fob), ("Frete internacional", frete)]
    va = fob + frete
    if (produto.get("regime") or "formal") == "remessa":
        va_usd = va / cambio["USD"]
        if va_usd <= 50:
            ii = va * c["remessa_ii_ate50_pct"] / 100
        else:
            ii = max(0.0, va * c["remessa_ii_acima50_pct"] / 100 - c["remessa_deducao_usd"] * cambio["USD"])
        aliq = c["remessa_icms_pct"] / 100
        icms = (va + ii) / (1 - aliq) * aliq
        linhas += [("Imposto de Importação", ii), ("ICMS", icms)]
        total = va + ii + icms
    else:
        ii_pct = _num(produto.get("ii_pct"))
        ii_pct = c["ii_pct"] if ii_pct is None else ii_pct
        ii = va * ii_pct / 100
        ipi = (va + ii) * c["ipi_pct"] / 100
        pis = va * c["pis_pct"] / 100
        cof = va * c["cofins_pct"] / 100
        sis = c["siscomex_brl"]
        afrmm = frete * c["afrmm_pct"] / 100 if produto.get("modal") == "maritimo" else 0.0
        desp = va * c["despesas_pct"] / 100
        aliq = c["icms_pct"] / 100
        icms = (va + ii + ipi + pis + cof + sis + afrmm) / (1 - aliq) * aliq
        linhas += [("II", ii), ("IPI", ipi), ("PIS-Importação", pis), ("COFINS-Importação", cof), ("Siscomex", sis),
                   ("AFRMM", afrmm), ("ICMS", icms), ("Despesas aduaneiras", desp)]
        total = va + ii + ipi + pis + cof + sis + afrmm + icms + desp
    unit = total / qtd
    pv = _num(produto.get("preco_venda_br"))
    liquido = pv * (1 - c["taxa_canal_pct"] / 100) if pv is not None else None
    margem = (liquido - unit) / pv * 100 if pv and liquido is not None else None
    return Custo(qtd=qtd, total=total, unit=unit, linhas=linhas, margem_pct=margem, liquido_unit=liquido)
