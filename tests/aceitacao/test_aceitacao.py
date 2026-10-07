"""
Teste de aceitação do sistema Cloud Broker — Pregão CVM 90016/2026.

Fecha a competência 2026-11 com dados fictícios e compara com o resultado
calculado de forma independente em esperado/fatura_2026-11.json.

Contrato de interface exigido do sistema (CLI):
  <BROKER_CMD> fechar-mes --competencia 2026-11 --dados <pasta> --saida <arquivo.json>
  <BROKER_CMD> validar-catalogo --arquivo <catalogo.csv>

BROKER_CMD padrão: "python -m broker.cli" (sobrescreva com a variável de ambiente BROKER_CMD).
Execução: pytest -v test_aceitacao.py
"""
import json
import os
import shlex
import subprocess
from pathlib import Path

import pytest

KIT = Path(__file__).resolve().parent
DADOS = KIT / "dados" / "2026-11"
ESPERADO = json.loads((KIT / "esperado" / "fatura_2026-11.json").read_text(encoding="utf-8"))
CMD = shlex.split(os.environ.get("BROKER_CMD", "python -m broker.cli"))
TOL = 0.01


def rodar(*args):
    return subprocess.run(CMD + list(args), capture_output=True, text=True, timeout=120)


def fechar_mes(destino: Path) -> dict:
    r = rodar("fechar-mes", "--competencia", "2026-11", "--dados", str(DADOS), "--saida", str(destino))
    assert r.returncode == 0, f"fechar-mes falhou (código {r.returncode}):\n{r.stdout}\n{r.stderr}"
    return json.loads(destino.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def fatura(tmp_path_factory):
    return fechar_mes(tmp_path_factory.mktemp("saida") / "fatura.json")


def test_competencia(fatura):
    assert fatura["competencia"] == "2026-11"


@pytest.mark.parametrize("item", ["1", "2", "3", "4", "5", "6"])
def test_quantidade_e_valor_por_item(fatura, item):
    esp, obt = ESPERADO["itens"][item], fatura["itens"][item]
    assert obt["quantidade"] == pytest.approx(esp["quantidade"], abs=TOL), f"quantidade do item {item}"
    assert obt["valor_unitario"] == pytest.approx(esp["valor_unitario"], abs=TOL), f"valor unitário do item {item}"
    assert obt["valor"] == pytest.approx(esp["valor"], abs=TOL), f"valor do item {item}"


def test_subtotal(fatura):
    assert fatura["subtotal"] == pytest.approx(ESPERADO["subtotal"], abs=TOL)


@pytest.mark.parametrize("campo", ["suporte_percentual", "suporte_valor", "pontos_nms",
                                   "glosa_pontos_percentual", "glosa_pontos_valor"])
def test_descontos(fatura, campo):
    assert fatura["descontos"][campo] == pytest.approx(ESPERADO["descontos"][campo], abs=TOL), campo


def test_total(fatura):
    assert fatura["total"] == pytest.approx(ESPERADO["total"], abs=TOL)


@pytest.mark.parametrize("chamado", sorted(ESPERADO["chamados"]))
def test_sla_por_chamado(fatura, chamado):
    esp, obt = ESPERADO["chamados"][chamado], fatura["chamados"][chamado]
    assert obt["atraso_inicio_h"] == esp["atraso_inicio_h"], f"{chamado}: atraso no início"
    assert obt["atraso_solucao_h"] == esp["atraso_solucao_h"], f"{chamado}: atraso na solução"
    assert obt["desconto_percentual"] == pytest.approx(esp["desconto_percentual"], abs=TOL), f"{chamado}: desconto"


def test_usn_por_projeto(fatura):
    assert set(fatura["usn_por_projeto"]) == set(ESPERADO["usn_por_projeto"])
    for proj, v in ESPERADO["usn_por_projeto"].items():
        assert fatura["usn_por_projeto"][proj] == pytest.approx(v, abs=TOL), proj


def test_recursos_sem_tag(fatura):
    assert sorted(fatura["recursos_sem_tag"]) == ESPERADO["recursos_sem_tag"]


def test_pendencias_nao_faturadas(fatura):
    chave = lambda p: (p["tipo"], p["resource_id"])
    assert sorted(map(chave, fatura["pendencias"])) == sorted(map(chave, ESPERADO["pendencias"]))


@pytest.mark.parametrize("item", ["1", "2", "3", "4", "5", "6"])
def test_saldo_contratual(fatura, item):
    esp, obt = ESPERADO["saldo"][item], fatura["saldo"][item]
    assert obt["contratado"] == pytest.approx(esp["contratado"], abs=TOL)
    assert obt["percentual_mes"] == pytest.approx(esp["percentual_mes"], abs=TOL)


def test_fechamento_idempotente(tmp_path, fatura):
    segunda = fechar_mes(tmp_path / "fatura2.json")
    assert segunda["total"] == pytest.approx(fatura["total"], abs=TOL)


def test_catalogo_valido_aceito():
    r = rodar("validar-catalogo", "--arquivo", str(DADOS / "catalogo.csv"))
    assert r.returncode == 0, r.stdout + r.stderr


def test_catalogo_com_fator_acima_da_calculadora_rejeitado():
    r = rodar("validar-catalogo", "--arquivo", str(KIT / "dados" / "catalogo_invalido.csv"))
    assert r.returncode != 0, "Fator USN acima do preço da calculadora deveria ser rejeitado (TR 10.43.4)"
    assert "AZ-099" in r.stdout + r.stderr, "a mensagem deve identificar o SKU inválido"
