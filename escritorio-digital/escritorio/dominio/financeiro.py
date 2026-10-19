"""Cálculos financeiros determinísticos. Nunca delegados à IA.

Dinheiro em Decimal, arredondado a centavos (HALF_UP) somente no resultado apresentado.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

CENTAVO = Decimal("0.01")
CEM = Decimal(100)


def D(v: Any) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if v is None or v == "":
        return Decimal(0)
    return Decimal(str(v).replace(",", "."))


def reais(v: Decimal) -> Decimal:
    return v.quantize(CENTAVO, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class RegraTributo:
    nome: str
    aliquota_pct: Decimal
    vigencia_inicio: date
    vigencia_fim: date | None
    fonte: str
    validado_contador: bool
    retido: bool = False
    aplica_categoria: str | None = None

    def vigente(self, em: date) -> bool:
        return self.vigencia_inicio <= em and (self.vigencia_fim is None or em <= self.vigencia_fim)


@dataclass
class ResultadoTributos:
    aliquota_total_pct: Decimal
    itens: list[dict[str, Any]]
    provisorio: bool
    alertas: list[str] = field(default_factory=list)


def tributos_aplicaveis(regras: list[RegraTributo], categoria: str, em: date) -> ResultadoTributos:
    """Seleciona regras vigentes da categoria. Sem regra ou sem validação contábil = cálculo provisório."""
    sel = [r for r in regras if r.vigente(em) and (r.aplica_categoria in (None, "", categoria))]
    alertas: list[str] = []
    if not sel:
        alertas.append(
            f"Nenhuma regra tributária vigente para '{categoria}' em {em.isoformat()}. "
            "Cadastre os tributos do seu regime e peça validação do contador."
        )
    nao_validadas = [r.nome for r in sel if not r.validado_contador]
    if nao_validadas:
        alertas.append("Regras sem validação contábil: " + ", ".join(nao_validadas))
    total = sum((r.aliquota_pct for r in sel), Decimal(0))
    itens = [
        {"nome": r.nome, "aliquota_pct": str(r.aliquota_pct), "retido": r.retido, "fonte": r.fonte,
         "validado_contador": r.validado_contador}
        for r in sel
    ]
    return ResultadoTributos(total, itens, provisorio=bool(alertas), alertas=alertas)


@dataclass
class EntradaViabilidade:
    custos_diretos: list[dict[str, Any]]  # {descricao, valor, origem, mes_inicio?, recorrente_mensal?}
    indiretos_pct: Decimal
    margem_alvo_pct: Decimal
    margem_minima_pct: Decimal
    tributos: ResultadoTributos
    duracao_meses: int
    prazo_recebimento_dias: int
    prazo_pagamento_fornecedor_dias: int
    capital_giro_disponivel: Decimal
    valor_estimado_edital: Decimal | None = None
    preco_proposto: Decimal | None = None


def formar_preco(custo_total: Decimal, tributos_pct: Decimal, margem_pct: Decimal) -> Decimal:
    """Preço por divisor: preço = custo / (1 − tributos − margem), percentuais sobre a receita bruta."""
    divisor = 1 - (tributos_pct + margem_pct) / CEM
    if divisor <= 0:
        raise ValueError("Tributos + margem ≥ 100% da receita: preço impossível")
    return custo_total / divisor


def fluxo_caixa(
    receita_mensal: Decimal, custo_mensal: Decimal, tributo_mensal: Decimal, meses: int,
    prazo_receb_dias: int, prazo_pag_dias: int,
) -> list[dict[str, str]]:
    """Fluxo mensal simplificado: custos do mês m são pagos em m + prazo_pag; a receita do
    mês m entra em m + prazo_receb (medição + aceite + pagamento). Tributo sai com a receita."""
    lag_r = -(-prazo_receb_dias // 30)  # teto
    lag_p = prazo_pag_dias // 30
    horizonte = meses + max(lag_r, lag_p) + 1
    saldo = Decimal(0)
    linhas = []
    for m in range(1, horizonte + 1):
        entra = receita_mensal if 1 <= m - lag_r <= meses else Decimal(0)
        sai = (custo_mensal if 1 <= m - lag_p <= meses else Decimal(0)) + (
            tributo_mensal if 1 <= m - lag_r <= meses else Decimal(0))
        saldo += entra - sai
        linhas.append({"mes": str(m), "entradas": str(reais(entra)), "saidas": str(reais(sai)),
                       "saldo_acumulado": str(reais(saldo))})
    return linhas


def analisar_viabilidade(e: EntradaViabilidade) -> dict[str, Any]:
    direto = sum((D(c["valor"]) for c in e.custos_diretos), Decimal(0))
    indireto = direto * e.indiretos_pct / CEM
    custo_total = direto + indireto
    preco_sugerido = formar_preco(custo_total, e.tributos.aliquota_total_pct, e.margem_alvo_pct)
    preco = e.preco_proposto if e.preco_proposto is not None else preco_sugerido
    tributos_valor = preco * e.tributos.aliquota_total_pct / CEM
    lucro = preco - tributos_valor - custo_total
    margem_pct = (lucro / preco * CEM) if preco else Decimal(0)
    meses = max(e.duracao_meses, 1)
    fluxo = fluxo_caixa(preco / meses, custo_total / meses, tributos_valor / meses, meses,
                        e.prazo_recebimento_dias, e.prazo_pagamento_fornecedor_dias)
    pior = min(Decimal(x["saldo_acumulado"]) for x in fluxo)
    capital_necessario = -pior if pior < 0 else Decimal(0)

    motivos: list[str] = []
    if margem_pct < e.margem_minima_pct:
        motivos.append(f"Margem {reais(margem_pct)}% abaixo da mínima {e.margem_minima_pct}%")
    if capital_necessario > e.capital_giro_disponivel:
        motivos.append(
            f"Capital de giro necessário R$ {reais(capital_necessario)} acima do disponível "
            f"R$ {reais(e.capital_giro_disponivel)}"
        )
    if e.valor_estimado_edital and preco > e.valor_estimado_edital:
        motivos.append(f"Preço R$ {reais(preco)} acima do valor estimado do edital R$ {reais(e.valor_estimado_edital)}")
    sem_origem = [c["descricao"] for c in e.custos_diretos if not c.get("origem")]
    if sem_origem:
        motivos.append("Custos sem origem comprovada: " + ", ".join(sem_origem))

    if any("abaixo da mínima" in m or "acima do valor estimado" in m for m in motivos):
        recomendacao = "nao_recomendado"
    elif motivos or e.tributos.provisorio:
        recomendacao = "recomendado_com_condicoes"
    else:
        recomendacao = "recomendado"

    return {
        "custo_direto": str(reais(direto)),
        "custo_indireto": str(reais(indireto)),
        "custo_total": str(reais(custo_total)),
        "tributos_pct": str(e.tributos.aliquota_total_pct),
        "tributos_valor": str(reais(tributos_valor)),
        "tributos_itens": e.tributos.itens,
        "tributos_provisorio": e.tributos.provisorio,
        "preco_sugerido": str(reais(preco_sugerido)),
        "preco_considerado": str(reais(preco)),
        "lucro": str(reais(lucro)),
        "margem_pct": str(reais(margem_pct)),
        "margem_minima_pct": str(e.margem_minima_pct),
        "capital_giro_necessario": str(reais(capital_necessario)),
        "capital_giro_disponivel": str(reais(e.capital_giro_disponivel)),
        "fluxo_caixa": fluxo,
        "alertas": e.tributos.alertas + motivos,
        "recomendacao": recomendacao,
        "metodo": "determinístico (divisor sobre receita bruta; fluxo mensal com defasagens)",
    }
