"""Os 18 fluxos de aceite da plataforma, ponta a ponta, pela API."""

import hashlib
import hmac
import json
import subprocess
import sys
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from escritorio import auditoria, integracoes, motor
from escritorio import servicos as sv
from escritorio.api import criar_app
from escritorio.db import Banco
from tests.pdf_teste import CONTRATO, edital_teste, gerar_pdf

SENHA = "senha-forte-123"
HOJE = date.today()


@pytest.fixture
def amb(tmp_path, monkeypatch):
    monkeypatch.setenv("ESCRITORIO_SEGREDO_LINKS", "x" * 40)
    monkeypatch.setenv("ESCRITORIO_ARQUIVOS", str(tmp_path / "arq"))
    monkeypatch.setenv("ESCRITORIO_SANDBOX_RAIZ", str(tmp_path))
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "segredo-app")
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", "verif")
    db = Banco(str(tmp_path / "t.db"))
    app = criar_app(db, iniciar_worker=False)
    app.state.emissor = integracoes.EmissorSimulado()
    sv.inicializar(db)
    eid = sv.criar_empresa(db, {"razao_social": "Empresa Demonstração LTDA", "cnpj": "00.000.000/0001-00",
                                "margem_minima_pct": "10", "capital_giro_disponivel": "200000"}, "teste")
    sv.criar_usuario(db, eid, "Arthur Miguel", "arthur@exemplo.com", SENHA, "admin", "5511999990000")
    c = TestClient(app)
    assert c.post("/api/login", json={"email": "arthur@exemplo.com", "senha": SENHA}).status_code == 200
    return {"db": db, "c": c, "eid": eid, "tmp": tmp_path, "app": app}


def rodar_fila(db, n=20):
    res = []
    for _ in range(n):
        r = motor.executar_uma(db, "teste")
        if r is None:
            break
        res.append(r)
    return res


def repo_teste(raiz):
    """Repositório autorizado com um bug real: login sensível a maiúsculas."""
    r = raiz / "repo-cliente"
    r.mkdir()
    (r / "app.py").write_text("USUARIOS = {'ana@cliente.gov.br': 'x'}\n\n"
                              "def autenticar(email, senha):\n    return USUARIOS.get(email) == senha\n")
    (r / "test_app.py").write_text("from app import autenticar\n\n"
                                   "def test_email_maiusculo():\n    assert autenticar('Ana@Cliente.gov.br', 'x')\n")
    for cmd in (["git", "init", "-q"], ["git", "add", "."],
                ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "inicial"]):
        subprocess.run(cmd, cwd=r, check=True)
    return r


def test_fluxo_completo(amb):
    db, c, eid, tmp = amb["db"], amb["c"], amb["eid"], amb["tmp"]

    # --- cadastro: serviço, pessoas, tributos, documentos da empresa
    c.post("/api/servicos", json={"nome": "Manutenção de software", "categoria": "software", "unidade_cobranca": "UST",
                                  "palavras_chave": "manutenção,sistema web,ust"})
    f1 = c.post("/api/funcionarios", json={"nome": "Dev Pleno", "funcao": "desenvolvedor", "custo_hora": "90",
                                           "horas_mes": 160}).json()["id"]
    c.post("/api/tributo_regras", json={"nome": "ISS", "aliquota_pct": "5", "vigencia_inicio": "2026-01-01",
                                        "fonte": "lei municipal (exemplo)", "validado_contador": 0, "retido": 1})
    for tipo, val in (("certidao_federal", (HOJE + timedelta(days=200)).isoformat()),
                      ("certidao_fgts", (HOJE + timedelta(days=10)).isoformat()),  # vence antes da sessão
                      ("certidao_trabalhista", (HOJE + timedelta(days=150)).isoformat())):
        d = c.post("/api/documentos", files={"arquivo": (f"{tipo}.pdf", gerar_pdf([f"CERTIDÃO {tipo} regularidade"]))},
                   data={"tipo": tipo, "validade": val}).json()
        c.post(f"/api/documentos/{d['id']}/validar")

    # 1. importar edital e gerar análise com referências
    op = c.post("/api/oportunidades", json={"objeto": "Manutenção de sistema web de gestão tributária por UST",
                                            "orgao": "Prefeitura de Exemplo", "valor_estimado": "480000",
                                            "data_abertura": "2026-12-20T09:00:00"}).json()["id"]
    up = c.post("/api/documentos", files={"arquivo": ("edital.pdf", edital_teste())},
                data={"oportunidade_id": str(op)}).json()
    assert up["tipo"] == "edital" and up["leitura"] == "incompleta" and up["paginas"] == 4
    an = c.post(f"/api/oportunidades/{op}/analisar").json()
    assert "INCOMPLETA" in an["resumo"]["leitura"]  # não declara leitura completa com página ilegível
    ref = {x["requisito"]: x for x in an["matriz"]}
    assert ref["Certificado de regularidade do FGTS"]["origem"].endswith("p.2")

    # 2/3. comparar com documentos e identificar pendência real (FGTS vence antes da sessão)
    fgts = ref["Certificado de regularidade do FGTS"]
    assert fgts["situacao"] == "nao_atende" and "Vencido" in fgts["pendencia"]
    assert ref["Prova de regularidade" if False else "Certidão de regularidade fiscal federal"]["situacao"] == "atende"
    assert ref["Atestado(s) de capacidade técnica"]["situacao"] == "nao_atende"
    # instrução maliciosa no edital não gerou nenhuma aprovação/pagamento
    assert db.um("SELECT COUNT(*) n FROM aprovacao")["n"] == 0
    assert db.um("SELECT COUNT(*) n FROM lancamento")["n"] == 0

    # 4. cotação + viabilidade (três eventos separados na cotação)
    forn = c.post("/api/fornecedors", json={"nome": "Hospedagem Cloud SA"}).json()["id"]
    cot = c.post("/api/cotacoes", json={"oportunidade_id": op, "fornecedor_id": forn, "item": "Hospedagem 12 meses",
                                        "quantidade": "12", "preco_unitario": "1500",
                                        "validade": (HOJE + timedelta(days=60)).isoformat()}).json()["id"]
    assert c.post(f"/api/cotacoes/{cot}/marcar", json={"evento": "administrador"}).status_code == 422
    c.post(f"/api/cotacoes/{cot}/marcar", json={"evento": "fornecedor"})
    c.post(f"/api/cotacoes/{cot}/marcar", json={"evento": "agentes"})
    v = c.post(f"/api/oportunidades/{op}/viabilidade",
               json={"mao_de_obra": [{"funcionario_id": f1, "horas": 1920}], "indiretos_pct": 10,
                     "margem_alvo_pct": 15, "duracao_meses": 12}).json()
    assert v["tributos_provisorio"] is True  # ISS sem validação contábil
    assert v["recomendacao"] == "nao_recomendado_ate_sanar_habilitacao"
    assert v["custo_total"] == "209880.00"  # (1920×90 + 12×1500) × 1,10

    # 5. aprovar versão da proposta — e provar que aprovação de versão antiga não serve
    ap = c.post(f"/api/analises/{v['analise_id']}/solicitar-aprovacao").json()["aprovacao_id"]
    r = c.post(f"/api/aprovacoes/{ap}/decidir", json={"decisao": "aprovar", "hash": "errado"})
    assert r.status_code == 422
    assert c.post(f"/api/aprovacoes/{ap}/decidir", json={"decisao": "aprovar", "hash": v["hash"]}).json()["situacao"] == "aprovada"
    v2 = c.post(f"/api/oportunidades/{op}/viabilidade", json={"preco_proposto": "300000",
                                                              "mao_de_obra": [{"funcionario_id": f1, "horas": 1920}]}).json()
    r = c.post(f"/api/oportunidades/{op}/proposta-enviada", json={"analise_id": v2["analise_id"], "aprovacao_id": ap})
    assert r.status_code == 409  # aprovação é da v1, não da v2
    assert c.post(f"/api/oportunidades/{op}/proposta-enviada",
                  json={"analise_id": v["analise_id"], "aprovacao_id": ap}).json()["ok"]
    r = c.post(f"/api/oportunidades/{op}/proposta-enviada", json={"analise_id": v["analise_id"], "aprovacao_id": ap})
    assert r.status_code == 409  # uso único

    # 6. ganhou ≠ executar; contrato formal + plano
    res = c.post(f"/api/oportunidades/{op}/resultado", json={"resultado": "vencedora"}).json()
    assert res["situacao"] == "vencida_aguardando_contrato" and "ordem de serviço / autorização de início" in res["solicitar"]
    repo = repo_teste(tmp)
    regras = {"sistemas": ["SIGTRIB"], "repositorio": str(repo), "comando_testes": f"{sys.executable} -m pytest -q -p no:cacheprovider",
              "severidade_por_palavra": {"critica": ["não consegue fazer login", "fora do ar"]},
              "fora_escopo_palavras": ["novo módulo"], "prazo_pagamento_dias": 30,
              "criterios_aceite": "testes automatizados verdes + aceite do fiscal", "regra_medicao": "UST por OS"}
    dados = {"oportunidade_id": op, "numero": "101/2026", "orgao": "Prefeitura de Exemplo",
             "objeto": "Manutenção de sistema web de gestão tributária", "valor_total": "240000.00",
             "modelo_cobranca": "UST", "valor_unidade": "80.00", "vigencia_inicio": HOJE.isoformat(),
             "vigencia_fim": (HOJE + timedelta(days=365)).isoformat(), "regras": regras}
    sem_os = c.post("/api/contratos", data={"dados": json.dumps(dados)},
                    files={"arquivo": ("contrato.pdf", gerar_pdf([CONTRATO]))}).json()
    assert sem_os["divergencias"]  # contrato diverge da proposta aprovada
    cid = sem_os["contrato_id"]
    assert c.post(f"/api/contratos/{cid}/solicitar-inicio").status_code == 422  # falta ordem de serviço
    db.atualizar("contrato", cid, {"ordem_servico": "OS 001/2026"})
    plano = c.get(f"/api/contratos/{cid}").json()
    assert len(plano["obrigacoes"]) >= 4 and plano["plano"]["rastreabilidade"].startswith("cláusula")
    ap_ini = c.post(f"/api/contratos/{cid}/solicitar-inicio").json()["aprovacao_id"]
    h = db.um("SELECT hash FROM aprovacao WHERE id=?", ap_ini)["hash"]
    c.post(f"/api/aprovacoes/{ap_ini}/decidir", json={"decisao": "aprovar", "hash": h})
    ini = c.post(f"/api/contratos/{cid}/iniciar", json={"aprovacao_id": ap_ini}).json()

    # 7. squad adaptado
    sq = [s for s in c.get("/api/squads").json() if s["contrato_id"] == cid][0]
    membros = {m["membro_id"] for m in sq["membros"]}
    assert {"desenvolvedor-full-stack", "engenheiro-de-testes", "analista-de-medicao"} <= membros
    assert ini["squad_id"] == sq["id"]

    # 8. chamado via chat (e via WhatsApp mais abaixo)
    ch = c.post("/api/chamados", json={"texto": "O cliente não consegue fazer login no SIGTRIB desde 8h, usuários do "
                                                 "setor fiscal"}).json()
    assert ch["severidade"] == "critica" and ch["no_escopo"] and ch["contrato_id"] == cid
    fora = c.post("/api/chamados", json={"texto": "Queremos um novo módulo de IPTU no SIGTRIB, usuários todos"}).json()
    assert not fora["no_escopo"]

    # 9. investigar: reproduz a falha com ferramenta real
    r1 = rodar_fila(db)
    repro = [x for x in r1 if x["tarefa"] == ch["tarefas"][0]][0]
    assert repro["resultado"]["codigo_saida"] != 0 and repro["resultado"]["confirmou_expectativa"]
    c.post(f"/api/tarefas/{ch['tarefas'][0]}/revisar", json={"aprovado": True})
    # correção aplicada no repositório autorizado (branch de trabalho)
    subprocess.run(["git", "checkout", "-qb", f"chamado-{ch['chamado_id']}"], cwd=repo, check=True)
    (repo / "app.py").write_text("USUARIOS = {'ana@cliente.gov.br': 'x'}\n\n"
                                 "def autenticar(email, senha):\n    return USUARIOS.get(email.strip().lower()) == senha\n")
    alt = c.post(f"/api/tarefas/{ch['tarefas'][1]}/alteracao-codigo",
                 json={"repositorio": str(repo), "autor": "agente:desenvolvedor-full-stack"}).json()
    assert "app.py" in alt["diff_stat"]
    # executor não revisa a si mesmo
    with pytest.raises(PermissionError):
        sv.revisar_tarefa(db, ch["tarefas"][1], "agente:desenvolvedor-full-stack", True)
    c.post(f"/api/tarefas/{ch['tarefas'][1]}/revisar", json={"aprovado": True, "nota": "diff revisado"})

    # 10. verificação: testes passam após a correção
    r2 = rodar_fila(db)
    val = [x for x in r2 if x["tarefa"] == ch["tarefas"][2]][0]
    assert val["resultado"]["codigo_saida"] == 0
    exec_id = val["resultado"]["execucao_id"]
    assert "1 passed" in c.get(f"/api/execucoes/{exec_id}").json()["saida"]
    c.post(f"/api/tarefas/{ch['tarefas'][2]}/revisar", json={"aprovado": True})

    # 11. escritório ao vivo baseado em eventos reais
    esc = c.get("/api/escritorio").json()
    inv = [a for a in esc["agentes"] if a["id"] == "investigador-de-incidentes"][0]
    assert inv["ultimo_evento"] and f"#{ch['tarefas'][0]}" in inv["ultimo_evento"]
    assert db.um("SELECT COUNT(*) n FROM evento WHERE tipo='ferramenta.executada' AND ator_id='investigador-de-incidentes' "
                 "AND resumo LIKE '%pytest%'")["n"] == 1
    assert all(a["estado"] in ("disponivel", "trabalhando", "aguardando", "bloqueado", "pausado", "offline")
               for a in esc["agentes"])
    evs = c.get("/api/eventos?limite=500").json()
    assert any(e["tipo"] == "ferramenta.executada" for e in evs)

    # 12. evidências por link seguro (assinado, com validade, somente leitura)
    lk = c.post("/api/links", json={"tipo": "evidencias_contrato", "ref": cid, "horas": 2}).json()
    pagina = TestClient(amb["app"]).get(lk["url"].replace("http://testserver", ""))
    assert pagina.status_code == 200 and "sha256" in pagina.text
    adulterado = lk["token"][:-2] + ("aa" if not lk["token"].endswith("aa") else "bb")
    assert TestClient(amb["app"]).get(f"/l/{adulterado}").status_code == 403
    assert c.post("/api/links", json={"tipo": "escritorio", "horas": 500}).status_code == 422

    # 13. medição e aceite (entrega com evidência; realizada ≠ aceita)
    assert c.post("/api/entregas", json={"contrato_id": cid, "descricao": "x", "quantidade": 1, "unidade": "UST",
                                         "evidencias": []}).status_code == 422
    en = c.post("/api/entregas", json={"contrato_id": cid, "descricao": f"Correção chamado #{ch['chamado_id']}",
                                       "quantidade": "40", "unidade": "UST", "tarefa_id": ch["tarefas"][2],
                                       "evidencias": [f"execucao_ferramenta:{exec_id}"]}).json()["id"]
    en_h = c.post("/api/entregas", json={"contrato_id": cid, "descricao": "Suporte", "quantidade": "10",
                                         "unidade": "hora", "evidencias": ["relatorio:x"]}).json()["id"]
    m0 = c.post("/api/medicoes", json={"contrato_id": cid, "periodo": "2026-10"}).json()
    assert m0["quantidade"] == "0"  # nada aceito ainda
    c.post(f"/api/entregas/{en}/decidir", json={"aceita": True})
    c.post(f"/api/entregas/{en_h}/decidir", json={"aceita": True})
    m = c.post("/api/medicoes", json={"contrato_id": cid, "periodo": "2026-10b"}).json()
    assert m["quantidade"] == "40" and m["valor"] == "3200.00"
    assert "sem conversão automática" in m["alertas"][0]  # horas não viram UST
    assert c.post(f"/api/medicoes/{m['medicao_id']}/nota").status_code == 422  # sem aceite, sem nota
    dm = c.post(f"/api/medicoes/{m['medicao_id']}/decidir", json={"aceita": True, "glosa": "200",
                                                                 "motivo": "atraso de 1 dia"}).json()
    assert dm == {"situacao": "glosada_parcial", "valor_faturavel": "3000.00"}

    # 14. faturamento: prévia → aprovação → emissor (simulador) → retorno; sem duplicidade
    nf = c.post(f"/api/medicoes/{m['medicao_id']}/nota").json()
    assert nf["previa"]["retencoes_valor"] == "150.00" and nf["previa"]["provisorio"]
    assert c.post(f"/api/notas/{nf['nota_id']}/emitir", json={"aprovacao_id": nf["aprovacao_id"]}).status_code == 409
    c.post(f"/api/aprovacoes/{nf['aprovacao_id']}/decidir", json={"decisao": "aprovar", "hash": nf["hash"]})
    e1 = c.post(f"/api/notas/{nf['nota_id']}/emitir", json={"aprovacao_id": nf["aprovacao_id"]}).json()
    e2 = c.post(f"/api/notas/{nf['nota_id']}/emitir", json={"aprovacao_id": nf["aprovacao_id"]}).json()
    assert e1["situacao"] == "emitida_simulacao" and e2.get("duplicidade_evitada")
    assert amb["app"].state.emissor.chamadas == 1
    assert c.post(f"/api/medicoes/{m['medicao_id']}/nota").json()["ja_existia"]

    # 15. contas a receber atualizadas (contratada ≠ faturada ≠ recebida)
    fin = c.get("/api/financeiro").json()
    assert fin["totais"]["receita_contratada"] == "240000.00"
    assert fin["totais"]["a_receber"] == "3000.00" and fin["totais"]["receita_recebida"] == "0.00"
    assert fin["totais"]["receita_faturada"] == "0.00"  # nota do simulador não é faturamento real
    assert fin["totais"]["faturado_apenas_em_simulacao"] == "3000.00"
    assert "SIMULADOR" in c.post("/api/financeiro/perguntar", json={"pergunta": "O que preciso fazer para faturar?"}).json()["resposta"]
    lid = fin["a_receber"][0]["id"]
    c.post(f"/api/lancamentos/{lid}/liquidar")
    assert c.get("/api/financeiro").json()["totais"]["receita_recebida"] == "3000.00"
    assert "A receber" in c.post("/api/financeiro/perguntar", json={"pergunta": "Quanto tenho para receber?"}).json()["resposta"]

    # 16. relatório diário
    rel = c.post("/api/relatorios/diario").json()
    assert rel["execucoes_de_teste_24h"]["total"] >= 2 and rel["integridade_auditoria"]["integra"]
    assert any("WhatsApp" in x for x in rel["limitacoes"])

    # 17. acesso indevido entre contratos é impedido
    sv.criar_usuario(db, eid, "Operador B", "op@exemplo.com", SENHA, "operador")
    outro = db.inserir("contrato", {"empresa_id": eid, "numero": "202/2026", "objeto": "Digitalização de acervo",
                                    "tipo_objeto": "digitalizacao", "valor_total": "1", "modelo_cobranca": "pagina",
                                    "situacao": "assinado", "criado_em": "x"})
    c.post(f"/api/contratos/{outro}/acesso", json={"usuario_id": 2})
    c2 = TestClient(amb["app"])
    c2.post("/api/login", json={"email": "op@exemplo.com", "senha": SENHA})
    assert c2.get(f"/api/contratos/{cid}").status_code == 403
    assert c2.get(f"/api/contratos/{outro}").status_code == 200
    assert [x["id"] for x in c2.get("/api/contratos").json()] == [outro]
    assert c2.get("/api/financeiro").status_code == 403
    assert c2.get("/api/oportunidades").status_code == 403
    assert all(e["contrato_id"] == outro for e in c2.get("/api/eventos").json())
    assert c2.post("/api/aprovacoes/1/decidir", json={"decisao": "aprovar"}).status_code == 403

    # chat individual + privado (jurídico) + prova do auditor
    rj = c.post("/api/mensagens", json={"canal": "agente", "ref": "assistente-juridico-contratual",
                                        "texto": "Jurídico, explique a cláusula de subcontratação"}).json()
    assert rj["privado"] and "não advogado" in rj["respostas"][0]["texto"]
    ra = c.post("/api/mensagens", json={"canal": "agente", "ref": "auditor-de-execucao",
                                        "texto": f"Auditor, prove a tarefa #{ch['tarefas'][2]}"}).json()
    assert "sha256" in ra["respostas"][0]["texto"]
    assert "privado" not in [e["resumo"] for e in evs]  # conteúdo privado não vai para eventos

    # integridade da auditoria e imutabilidade
    assert auditoria.verificar_cadeia(db)["integra"]
    with pytest.raises(Exception, match="imutáveis"), db.tx() as cx:
        cx.execute("UPDATE evento SET resumo='x' WHERE id=1")


def test_recuperacao_sem_duplicar_efeito(amb):
    """18. tarefa recuperada após queda do worker não repete efeito externo."""
    db, eid = amb["db"], amb["eid"]
    chamadas = []

    @motor.handler("efeito_teste")
    def _h(db_, t):
        r = motor.efeito_unico(db_, "efeito:1", "teste", lambda: chamadas.append(1) or {"ok": 1},
                               lambda: {"ok": 1} if chamadas else None, t["id"])
        return {"resumo": "ok", "evidencias": [json.dumps(r)]}

    tid = motor.criar_tarefa(db, eid, "efeito externo", "efeito_teste")
    # worker pega a tarefa, executa o efeito e "morre" antes de registrar conclusão
    t = motor.reivindicar(db, "w1")
    motor.efeito_unico(db, "efeito:1", "teste", lambda: chamadas.append(1) or {"ok": 1}, lambda: None, tid)
    db.atualizar("efeito_externo", "efeito:1", {"situacao": "iniciado"}, chave="chave")  # queda antes de confirmar
    db.atualizar("tarefa", t["id"], {"lease_ate": "2000-01-01T00:00:00+00:00"})
    assert motor.recuperar_orfas(db) == 1
    r = motor.executar_uma(db, "w2")
    assert r["ok"] and len(chamadas) == 1  # verificação encontrou o efeito; não repetiu
    ev = db.todos("SELECT resumo FROM evento WHERE tipo='tarefa.estado' AND objeto_id=?", str(tid))
    assert any("recuperada" in e["resumo"] for e in ev)


def test_falha_com_backoff_e_escalonamento(amb):
    db, eid = amb["db"], amb["eid"]

    @motor.handler("sempre_falha")
    def _h(db_, t):
        raise RuntimeError("serviço externo instável token=abc123")

    tid = motor.criar_tarefa(db, eid, "instável", "sempre_falha")
    db.atualizar("tarefa", tid, {"max_tentativas": 2})
    r = motor.executar_uma(db)
    assert not r["ok"] and "***" in r["erro"] and "abc123" not in r["erro"]  # segredo sanitizado
    assert db.um("SELECT estado, proxima_execucao FROM tarefa WHERE id=?", tid)["proxima_execucao"]
    db.atualizar("tarefa", tid, {"proxima_execucao": None})
    motor.executar_uma(db)
    assert db.um("SELECT estado FROM tarefa WHERE id=?", tid)["estado"] == "falhou"
    assert db.um("SELECT COUNT(*) n FROM evento WHERE tipo='incidente.agente'")["n"] == 1


def test_whatsapp_webhook(amb):
    c, db = amb["c"], amb["db"]
    assert c.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=42").text == "42"
    assert c.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42").status_code == 403

    def env(msg_id, texto, de="5511999990000"):
        corpo = json.dumps({"entry": [{"changes": [{"value": {"messages": [
            {"id": msg_id, "from": de, "type": "text", "text": {"body": texto}}]}}]}]}).encode()
        sig = "sha256=" + hmac.new(b"segredo-app", corpo, hashlib.sha256).hexdigest()
        return c.post("/webhooks/whatsapp", content=corpo, headers={"x-hub-signature-256": sig,
                                                                    "content-type": "application/json"})

    assert c.post("/webhooks/whatsapp", content=b"{}", headers={"x-hub-signature-256": "sha256=00"}).status_code == 401
    r = env("wamid.1", "O sistema está com erro no login desde 9h, usuários do RH").json()
    assert "Chamado #" in r["processadas"][0]["resposta"]
    assert env("wamid.1", "O sistema está com erro no login").json()["processadas"][0]["duplicada"]
    assert "Não aprovo" in env("wamid.2", "sim").json()["processadas"][0]["resposta"]
    assert env("wamid.3", "oi", de="5500000000000").json()["processadas"][0]["ignorada"]
    # sem credenciais de envio: tarefa de resposta fica bloqueada e a resposta permanece no painel
    rodar_fila(db)
    t = db.um("SELECT estado, erro FROM tarefa WHERE tipo='enviar_whatsapp' ORDER BY id LIMIT 1")
    assert t["estado"] == "bloqueada" and "WHATSAPP_TOKEN" in t["erro"]


def test_retificacao_expira_aprovacao(amb):
    c, db = amb["c"], amb["db"]
    op = c.post("/api/oportunidades", json={"objeto": "Manutenção de sistema web"}).json()["id"]
    c.post("/api/documentos", files={"arquivo": ("edital.pdf", edital_teste(False))}, data={"oportunidade_id": str(op)})
    c.post(f"/api/oportunidades/{op}/analisar")
    v = c.post(f"/api/oportunidades/{op}/viabilidade", json={"outros_custos": [{"descricao": "x", "valor": "1000",
                                                                                 "origem": "estimativa"}]}).json()
    ap = c.post(f"/api/analises/{v['analise_id']}/solicitar-aprovacao").json()["aprovacao_id"]
    c.post(f"/api/aprovacoes/{ap}/decidir", json={"decisao": "aprovar", "hash": v["hash"]})
    from tests.pdf_teste import EDITAL_P1, EDITAL_P2, EDITAL_P3
    ret = gerar_pdf([EDITAL_P1.replace("20/12/2026", "15/01/2027"), EDITAL_P2, EDITAL_P3])
    r = c.post("/api/documentos", files={"arquivo": ("retificacao.pdf", ret)},
               data={"oportunidade_id": str(op), "tipo": "retificacao"}).json()
    assert r["diff"][0]["pagina"] == 1 and any("15/01/2027" in x for x in r["diff"][0]["alteracoes"])
    assert db.um("SELECT situacao FROM aprovacao WHERE id=?", ap)["situacao"] == "expirada"
    an = c.post(f"/api/oportunidades/{op}/analisar").json()
    assert an["data_sessao"] == "2027-01-15"


def test_ferramenta_ausente_nao_e_evidencia(amb):
    db, eid, tmp = amb["db"], amb["eid"], amb["tmp"]
    repo = repo_teste(tmp)
    tid = motor.criar_tarefa(db, eid, "reproduzir", "executar_testes", executor_id="investigador-de-incidentes",
                             parametros={"repositorio": str(repo), "comando": "python -c 'import modulo_inexistente'",
                                         "esperado": "falha"})
    r = motor.executar_uma(db)
    assert not r["ok"] and "não executou" in r["bloqueio"]
    assert db.um("SELECT estado FROM tarefa WHERE id=?", tid)["estado"] == "bloqueada"


def test_reuniao_nao_autoriza(amb):
    c, db = amb["c"], amb["db"]
    r = c.post("/api/reunioes", json={"texto": "- Proposta: incluir novo módulo de relatórios\n- Decidido: reunião "
                                               "semanal às segundas\n- Pendente: definir responsável"}).json()
    assert r["mudancas_escopo"] and r["tarefas_de_avaliacao"]
    estados = {t["estado"] for t in db.todos("SELECT estado FROM tarefa WHERE tipo='avaliacao_reuniao'")}
    assert estados == {"planejada"}


def test_emissor_nao_configurado_nao_transmite():
    with pytest.raises(RuntimeError, match="nenhuma nota foi transmitida"):
        integracoes.EmissorFiscal().transmitir({})


def test_aderencia_sem_falso_positivo(amb):
    """Objetos reais do PNCP (19/10/2026) que antes casavam indevidamente."""
    db, eid = amb["db"], amb["eid"]
    sv.cadastrar(db, "servico", eid, {"nome": "Software", "categoria": "software", "unidade_cobranca": "UST",
                                      "palavras_chave": "software,sistema,desenvolvimento de software,manutenção de sistema",
                                      "palavras_excluir": "medicamento,hospitalar"}, "t")
    ruins = ["Aquisição de motocicleta, através do Sistema de Registro de Preços",
             "Instalação de Sistema de Irrigação da área de instrução equestre",
             "Aquisição de Produtos para Saúde (Material hospitalar) por Sistema de Registro de Preços",
             "Aquisição de onze subsistemas de armazenamento"]
    for o in ruins:
        assert sv.aderencia(db, eid, o)[0] < 30, o
    assert sv.aderencia(db, eid, "Serviços técnicos continuados de desenvolvimento de software")[0] >= 30
    assert sv.aderencia(db, eid, "Contratação de empresa para manutenção de sistema de gestão")[0] >= 30
