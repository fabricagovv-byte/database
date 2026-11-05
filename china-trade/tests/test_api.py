import json
import logging
import re

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from chinatrade import db, seguranca
from chinatrade.config import cfg
from chinatrade.db import Cotacao, Documento, sessao

H = {"X-CT": "1"}
SENHA = "Senha-Forte-123"


@pytest.fixture
def cli(tmp_path):
    cfg.pasta_anexos = tmp_path / "anexos"
    cfg.cadastro_aberto = True
    db.reiniciar(f"sqlite:///{tmp_path}/t.db")
    db.criar_tabelas()
    from chinatrade.api import app
    return TestClient(app)


def conta(cli, email, nome="Teste"):
    r = cli.post("/api/auth/cadastrar", json={"nome": nome, "email": email, "senha": SENHA}, headers=H)
    assert r.status_code == 201, r.text
    c = TestClient(cli.app)
    assert c.post("/api/auth/entrar", json={"email": email, "senha": SENHA}, headers=H).status_code == 200
    return c, r.json()


def test_pagina_e_saude(cli):
    assert cli.get("/api/saude").json()["app"] == "china-trade"
    r = cli.get("/")
    assert "<title>China Trade Intelligence</title>" in r.text and r.text.startswith("<!doctype html>")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert cli.get("/app.js").status_code == 200


def test_cadastro_login_papeis_e_csrf(cli):
    assert cli.post("/api/auth/cadastrar", json={"nome": "x", "email": "a@x.com", "senha": "fraca"}, headers=H).status_code == 422
    a, ua = conta(cli, "a@x.com")
    _b, ub = conta(cli, "b@x.com")
    assert ua["papel"] == "admin" and ub["papel"] == "analista"
    assert cli.post("/api/auth/cadastrar", json={"nome": "x", "email": "a@x.com", "senha": SENHA}, headers=H).status_code == 409
    # sem o cabeçalho X-CT o servidor recusa (proteção CSRF)
    assert a.put("/api/colecoes/produtos/p1", json={"nome": "x"}).status_code == 403
    assert cli.get("/api/colecoes").status_code == 401
    assert a.get("/api/auth/eu").json()["email"] == "a@x.com"


def test_bloqueio_apos_cinco_erros(cli):
    conta(cli, "a@x.com")
    c = TestClient(cli.app)
    for _ in range(5):
        assert c.post("/api/auth/entrar", json={"email": "a@x.com", "senha": "errada"}, headers=H).status_code == 401
    assert c.post("/api/auth/entrar", json={"email": "a@x.com", "senha": SENHA}, headers=H).status_code == 429


def test_dados_isolados_cifrados_e_exportados(cli):
    a, _ = conta(cli, "a@x.com")
    b, ub = conta(cli, "b@x.com")
    doc = {"nome": "Garrafa térmica", "notas": "fornecedor topa 5% de desconto", "preco_origem": 18}
    assert a.put("/api/colecoes/produtos/p1", json=doc, headers=H).status_code == 200
    assert a.get("/api/colecoes").json()["produtos"][0]["notas"] == doc["notas"]
    assert b.get("/api/colecoes").json()["produtos"] == []  # outro usuário não vê
    assert b.delete("/api/colecoes/produtos/p1", headers=H).status_code == 200  # só apaga o que é dele
    assert len(a.get("/api/colecoes").json()["produtos"]) == 1
    with sessao() as s:
        bruto = s.scalar(select(Documento.conteudo))
    assert "desconto" not in bruto and "Garrafa" not in bruto  # cifrado no banco
    exp = a.get("/api/exportar")
    assert exp.json()["dados"]["produtos"][0]["nome"] == "Garrafa térmica"
    assert a.put("/api/colecoes/inexistente/x", json={}, headers=H).status_code == 404
    # leitor não grava
    a.patch(f"/api/admin/usuarios/{ub['id']}", json={"papel": "leitor"}, headers=H)
    assert b.put("/api/colecoes/links/l1", json={"url": "https://x.com"}, headers=H).status_code == 403
    assert b.get("/api/admin/usuarios").status_code == 403
    assert len(a.get("/api/admin/usuarios").json()) == 2
    acoes = [x["acao"] for x in a.get("/api/admin/auditoria").json()]
    assert "criou" in acoes and "login" in acoes and "usuario_alterado" in acoes


def test_mfa_e_troca_de_senha(cli, caplog):
    a, _ = conta(cli, "a@x.com")
    seg = a.post("/api/auth/mfa/iniciar", headers=H).json()
    assert a.post("/api/auth/mfa/confirmar", json={"codigo": "000000"}, headers=H).status_code == 400
    assert a.post("/api/auth/mfa/confirmar", json={"codigo": seguranca.codigo_totp(seg["segredo"])}, headers=H).status_code == 200
    c = TestClient(cli.app)
    r = c.post("/api/auth/entrar", json={"email": "a@x.com", "senha": SENHA}, headers=H)
    assert r.status_code == 401 and "MFA" in r.json()["detail"]
    assert c.post("/api/auth/entrar", json={"email": "a@x.com", "senha": SENHA, "codigo_mfa": seguranca.codigo_totp(seg["segredo"])}, headers=H).status_code == 200
    # recuperação: sem SMTP o código vai para o log do servidor
    with caplog.at_level(logging.WARNING):
        assert c.post("/api/auth/recuperar", json={"email": "a@x.com"}, headers=H).status_code == 200
    codigo = re.search(r"\): (\S+)$", caplog.records[-1].getMessage()).group(1)
    assert c.post("/api/auth/redefinir", json={"email": "a@x.com", "token": "errado", "nova_senha": "Nova-Senha-456"}, headers=H).status_code == 400
    assert c.post("/api/auth/redefinir", json={"email": "a@x.com", "token": codigo, "nova_senha": "Nova-Senha-456"}, headers=H).status_code == 200
    assert c.get("/api/auth/eu").status_code == 401  # sessões antigas encerradas
    assert c.post("/api/auth/redefinir", json={"email": "a@x.com", "token": codigo, "nova_senha": "Outra-Senha-789"}, headers=H).status_code == 400


def test_anexos_so_do_dono(cli):
    a, _ = conta(cli, "a@x.com")
    b, _ = conta(cli, "b@x.com")
    r = a.post("/api/anexos", files={"arquivo": ("proforma.pdf", b"%PDF-1.4 teste", "application/pdf")}, headers=H)
    assert r.status_code == 201
    aid = r.json()["id"]
    assert a.get(f"/api/anexos/{aid}").content == b"%PDF-1.4 teste"
    assert b.get(f"/api/anexos/{aid}").status_code == 404
    arq = next((cfg.pasta_anexos).rglob(aid))
    assert b"teste" not in arq.read_bytes()  # cifrado em disco


def test_cotacoes_agentes_e_alertas(cli):
    a, _ = conta(cli, "a@x.com")
    q = {"id": "USDBRL", "simbolo": "USDBRL", "classe": "moeda", "preco": 5.4, "variacao_pct": 1.2, "fonte": "teste", "tipo": "indicativa",
         "historico": [{"t": f"2026-10-{i:02d}", "c": 5 + i / 100} for i in range(1, 31)]}
    cny = {**q, "id": "CNYBRL", "simbolo": "CNYBRL", "preco": 0.75}
    with sessao() as s:
        s.add_all([Cotacao(id="USDBRL", dados=q), Cotacao(id="CNYBRL", dados=cny)])
    assert {c["id"] for c in a.get("/api/cotacoes").json()} == {"USDBRL", "CNYBRL"}
    a.put("/api/colecoes/produtos/p1", json={"nome": "Garrafa", "preco_origem": 18, "moeda": "CNY", "qtd_lote": 500, "frete_total": 300,
                                             "frete_moeda": "USD", "modal": "maritimo", "preco_venda_br": 59.9}, headers=H)
    r = a.post("/api/agentes/import_analyst", headers=H).json()
    assert "R$ 29,93/un." in r["resultado"] and r["limitacoes"]
    assert a.post("/api/agentes/forex_monitor", headers=H).json()["agente"] == "FOREX MONITOR"
    assert a.post("/api/agentes/nao_existe", headers=H).status_code == 404
    a.put("/api/colecoes/alertas/a1", json={"tipo": "preco_acima", "simbolo": "USDBRL", "valor": 5.0, "canal": "painel", "ativo": True}, headers=H)
    a.put("/api/colecoes/alertas/a2", json={"tipo": "preco_abaixo", "simbolo": "USDBRL", "valor": 5.0, "canal": "painel", "ativo": True}, headers=H)
    from chinatrade.worker import avaliar_alertas
    assert avaliar_alertas({"USDBRL": q}) == 1
    assert avaliar_alertas({"USDBRL": q}) == 0  # espera 6 h antes de repetir
    log = a.get("/api/colecoes").json()["alertas_log"]
    assert len(log) == 1 and "acima de 5.0" in log[0]["mensagem"]


def test_adaptadores_de_mercado_com_respostas_simuladas():
    from chinatrade.integracoes import mercado

    def rota(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "ticker/24hr" in u:
            return httpx.Response(200, json={"lastPrice": "65000.5", "priceChangePercent": "-1.25", "closeTime": 1793500000000})
        if "klines" in u:
            return httpx.Response(200, json=[[1793400000000 + i * 864e5, "0", "0", "0", str(60000 + i)] for i in range(5)])
        if "json/last" in u:
            return httpx.Response(200, json={"CNYBRL": {"bid": "0.7512", "pctChange": "0.3", "timestamp": "1793500000"}})
        if "json/daily" in u:
            return httpx.Response(200, json=[{"bid": "0.75", "timestamp": str(1793500000 - i * 86400)} for i in range(3)])
        if "finance.yahoo" in u and "PETR4.SA" in u:
            return httpx.Response(200, json={"chart": {"result": [{"meta": {"regularMarketPrice": 37.5, "regularMarketTime": 1793500000},
                                                                   "timestamp": [1793300000, 1793400000], "indicators": {"quote": [{"close": [36.0, 37.0]}]}}]}})
        return httpx.Response(404)

    c = httpx.Client(transport=httpx.MockTransport(rota))
    btc = mercado.Binance(c).cotar("BTC")
    assert btc["preco"] == 65000.5 and btc["tipo"] == "tempo_real" and len(btc["historico"]) == 5
    cny = mercado.AwesomeAPI(c).cotar("CNY")
    assert cny["id"] == "CNYBRL" and cny["tipo"] == "indicativa"
    pet = mercado.Yahoo(c).cotar("PETR4")
    assert pet["classe"] == "acao_br" and pet["tipo"] == "atrasada" and round(pet["variacao_pct"], 2) == round((37.5 / 37 - 1) * 100, 2)
    assert mercado.simbolo_yahoo("IBOV") == "^BVSP"
    assert mercado.simbolo_yahoo("BTC") == "BTC-USD" and mercado.simbolo_yahoo("CNYBRL") == "CNYBRL=X"
    # Binance bloqueada (451): cripto cai para o Yahoo Finance
    def rota2(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "binance" in u:
            return httpx.Response(451)
        if "BTC-USD" in u:
            return httpx.Response(200, json={"chart": {"result": [{"meta": {"regularMarketPrice": 80000.0, "regularMarketTime": 1793500000},
                                                                   "timestamp": [1793400000], "indicators": {"quote": [{"close": [79000.0]}]}}]}})
        return httpx.Response(404)
    cots2, _ = mercado.coletar([], cliente=httpx.Client(transport=httpx.MockTransport(rota2)))
    btc2 = next(q for q in cots2 if q["id"] == "BTC")
    assert btc2["fonte"] == "Yahoo Finance" and btc2["classe"] == "cripto" and btc2["moeda"] == "USD"
    # uma fonte fora do ar não derruba as outras e nada é inventado
    cots, erros = mercado.coletar(["XYZ1"], cliente=c)
    ids = {q["id"] for q in cots}
    assert "PETR4" in ids and "BTC" in ids and "AAPL" not in ids and erros


def test_china_e_links():
    from chinatrade.integracoes import china, outras
    cfg.aliyun_key_id = ""
    t = china.traduzir("Garrafa térmica")
    assert t["zh"] == "保温杯" and "glossário" in t["fonte"]
    links = china.links_busca("garrafa térmica", "保温杯", "thermos bottle")
    assert {x["plataforma"] for x in links} == {"1688", "Alibaba", "AliExpress", "Made-in-China", "Global Sources", "DHgate", "Taobao"}
    assert "%E4%BF%9D" in links[0]["url"]
    with pytest.raises(RuntimeError, match="credenciais"):
        china.Alibaba1688().chamar("com.alibaba.product", "alibaba.product.get", {})
    assert len(china.Alibaba1688("k", "s", "t").assinar("param2/1/x/y/k", {"b": "2", "a": "1"})) == 40
    with pytest.raises(ValueError):
        outras.capturar_titulo("http://127.0.0.1/admin")
    with pytest.raises(ValueError):
        outras.capturar_titulo("file:///etc/passwd")
    pag = '<html><head><meta property="og:title" content="Garrafa &amp; Copo"><meta property="og:image" content="/img.jpg"></head></html>'
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=pag)))
    r = outras.capturar_titulo("https://loja.exemplo.com/p", cliente=c, checar_ip=False)
    assert r == {"titulo": "Garrafa & Copo", "imagem": "https://loja.exemplo.com/img.jpg"}


def test_cli_formato_artifact(tmp_path, monkeypatch):
    from chinatrade import cli
    from chinatrade.integracoes import mercado
    monkeypatch.setattr(mercado, "coletar", lambda extras: ([{"id": "BTC", "preco": 1.0, "historico": [{"t": str(i), "c": i} for i in range(300)]}], []))
    saida = tmp_path / "feed.json"
    assert cli.main(["coletar-cotacoes", "--saida", str(saida), "--formato", "artifact"]) == 0
    d = json.loads(saida.read_text())
    assert d["collection"] == "cotacoes_feed" and len(d["data"]["itens"][0]["historico"]) == 120 and d["data"]["gerado_em"]
