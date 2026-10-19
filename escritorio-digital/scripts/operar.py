"""Roda a operação ponta a ponta contra um servidor em execução, pela API HTTP.

Uso: python scripts/operar.py --url http://127.0.0.1:8100 --email ... --senha ... --sandbox /caminho

Dados de empresa, certidões e contrato aqui são de DEMONSTRAÇÃO (identificados como tal).
A busca e os editais do PNCP são reais.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.pdf_teste import CONTRATO, edital_teste, gerar_pdf

HOJE = date.today()
LOG: list[dict] = []


def passo(nome: str, dados: object) -> None:
    LOG.append({"passo": nome, "resultado": dados})
    print(f"\n== {nome}\n{json.dumps(dados, ensure_ascii=False, default=str)[:900]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8100")
    ap.add_argument("--email", required=True)
    ap.add_argument("--senha", required=True)
    ap.add_argument("--sandbox", required=True)
    ap.add_argument("--saida", default="evidencias/operacao.json")
    a = ap.parse_args()
    c = httpx.Client(base_url=a.url, timeout=180)
    r = c.post("/api/login", json={"email": a.email, "senha": a.senha})
    r.raise_for_status()

    def post(p: str, **kw: object) -> dict:
        resp = c.post(p, **kw)
        if resp.status_code >= 400:
            return {"_status": resp.status_code, **(resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"texto": resp.text})}
        return resp.json()

    # ---------------- cadastro
    c.put("/api/empresa", json={"nome_fantasia": "Escritório Arthur Miguel (DEMONSTRAÇÃO)", "margem_minima_pct": "12",
                                "capital_giro_disponivel": "150000", "regioes": "Brasil", "hora_relatorio": "18:00"})
    servicos = [
        ("Desenvolvimento e manutenção de software", "software", "UST",
         "software,sistema web,sistemas de informação,desenvolvimento de software,manutenção de sistema,fábrica de software,"
         "aplicativo,tecnologia da informação,ust", "medicamento,hospitalar,veículo,irrigação"),
        ("Digitalização e gestão documental", "digitalizacao", "pagina", "digitalização,gestão documental,ocr,acervo", ""),
        ("Infraestrutura, cloud e suporte", "infraestrutura", "mensalidade", "computação em nuvem,cloud,datacenter,rede lógica,firewall", ""),
        ("Fornecimento de equipamentos de TI", "fornecimento", "unidade", "notebook,microcomputador,licença de software,storage", ""),
    ]
    for nome, cat, un, pal, excl in servicos:
        post("/api/servicos", json={"nome": nome, "categoria": cat, "unidade_cobranca": un, "palavras_chave": pal,
                                    "palavras_excluir": excl,
                                    "origem": "cadastro inicial (demonstração)"})
    devs = []
    for nome, func, custo in (("Pessoa Dev 1 (demo)", "desenvolvedor full stack", "85"),
                              ("Pessoa Dev 2 (demo)", "desenvolvedor backend", "80"),
                              ("Pessoa QA (demo)", "analista de testes", "60"),
                              ("Pessoa GP (demo)", "gerente de projeto", "110")):
        devs.append(post("/api/funcionarios", json={"nome": nome, "funcao": func, "custo_hora": custo, "horas_mes": 160})["id"])
    post("/api/tributo_regras", json={"nome": "ISS (exemplo — confirmar município)", "aliquota_pct": "5",
                                      "aplica_categoria": "servico", "retido": 1, "vigencia_inicio": "2026-01-01",
                                      "fonte": "PREMISSA DE DEMONSTRAÇÃO — validar com contador", "validado_contador": 0})
    post("/api/tributo_regras", json={"nome": "Tributos federais (exemplo)", "aliquota_pct": "6.73",
                                      "vigencia_inicio": "2026-01-01", "fonte": "PREMISSA DE DEMONSTRAÇÃO — validar com contador",
                                      "validado_contador": 0})
    for tipo, dias in (("certidao_federal", 170), ("certidao_fgts", 12), ("certidao_trabalhista", 150),
                       ("contrato_social", None), ("certidao_falencia", 60)):
        pdf = gerar_pdf([f"DOCUMENTO DE DEMONSTRAÇÃO — {tipo}\nSem valor legal. Substitua pelo documento real."])
        d = c.post("/api/documentos", files={"arquivo": (f"{tipo}-DEMO.pdf", pdf)},
                   data={"tipo": tipo, **({"validade": (HOJE + timedelta(days=dias)).isoformat()} if dias else {})}).json()
        c.post(f"/api/documentos/{d['id']}/validar")
    passo("cadastro", {"servicos": len(servicos), "pessoas": len(devs), "documentos": 5})

    # ---------------- busca REAL no PNCP
    busca = post("/api/oportunidades/buscar-pncp", json={"dias": 3, "paginas": 3, "aderencia_minima": 30})
    ops = {o["id"]: o for o in c.get("/api/oportunidades").json()}
    passo("busca_pncp_real", {**busca, "objetos": [(i, ops[i]["aderencia"], ops[i]["objeto"][:100])
                                                   for i in busca.get("compativeis", [])]})
    ordem = sorted(busca.get("compativeis") or [], key=lambda i: -ops[i]["aderencia"])[:3]
    tarefas_dl = {oid: post(f"/api/oportunidades/{oid}/baixar-pncp")["tarefa_id"] for oid in ordem}
    reais = []
    for oid, tid in tarefas_dl.items():
        for _ in range(240):
            t = next(x for x in c.get("/api/tarefas").json() if x["id"] == tid)
            if t["estado"] in ("em_revisao", "bloqueada", "falhou"):
                break
            time.sleep(1)
        reais.append({"oportunidade": oid, "objeto": ops[oid]["objeto"][:120], "link": ops[oid]["link"],
                      "estado": t["estado"], "resultado": json.loads(t["resultado"]) if t["resultado"] else None,
                      "erro": t["erro"]})
    passo("editais_reais_pncp_lidos", reais)

    # ---------------- fluxo completo com edital controlado
    op = post("/api/oportunidades", json={"objeto": "Manutenção evolutiva e corretiva de sistema web de gestão tributária por UST",
                                          "orgao": "Prefeitura Municipal de Exemplo (DEMONSTRAÇÃO)", "valor_estimado": "480000",
                                          "data_abertura": "2026-12-20T09:00:00", "fonte": "manual"})["id"]
    up = c.post("/api/documentos", files={"arquivo": ("edital-45-2026-DEMO.pdf", edital_teste())},
                data={"oportunidade_id": str(op)}).json()
    an = post(f"/api/oportunidades/{op}/analisar")
    passo("analise_edital", {"upload": up, "resumo": an["resumo"],
                             "pendencias": [(x["requisito"], x["situacao"], x["pendencia"]) for x in an["matriz"]
                                            if x["situacao"] != "atende"][:8], "squad": an["squad"]["tipo"]})
    forn = post("/api/fornecedors", json={"nome": "Nuvem Hospedagem (DEMO)", "papel": "fornecimento"})["id"]
    cot = post("/api/cotacoes", json={"oportunidade_id": op, "fornecedor_id": forn, "item": "Hospedagem 12 meses",
                                      "quantidade": "12", "preco_unitario": "1500",
                                      "validade": (HOJE + timedelta(days=60)).isoformat()})["id"]
    post(f"/api/cotacoes/{cot}/marcar", json={"evento": "fornecedor"})
    post(f"/api/cotacoes/{cot}/marcar", json={"evento": "agentes"})
    v = post(f"/api/oportunidades/{op}/viabilidade", json={
        "mao_de_obra": [{"funcionario_id": devs[0], "horas": 1200}, {"funcionario_id": devs[2], "horas": 400}],
        "indiretos_pct": 12, "margem_alvo_pct": 18, "duracao_meses": 12, "prazo_recebimento_dias": 60})
    passo("viabilidade", {k: v[k] for k in ("versao", "custo_total", "preco_sugerido", "margem_pct", "tributos_pct",
                                            "tributos_provisorio", "capital_giro_necessario", "recomendacao", "alertas")})
    apr = post(f"/api/analises/{v['analise_id']}/solicitar-aprovacao")["aprovacao_id"]
    passo("aprovacao_pendente_para_arthur", {"aprovacao_id": apr, "hash": v["hash"]})

    # Para a demonstração seguir até o faturamento, este script registra o restante do ciclo.
    # Numa operação real, cada decisão abaixo é sua, no painel.
    if "--parar-na-aprovacao" in sys.argv:
        Path(a.saida).parent.mkdir(parents=True, exist_ok=True)
        Path(a.saida).write_text(json.dumps(LOG, ensure_ascii=False, indent=2, default=str))
        return 0
    post(f"/api/aprovacoes/{apr}/decidir", json={"decisao": "aprovar", "hash": v["hash"],
                                                 "justificativa": "demonstração automatizada"})
    post(f"/api/oportunidades/{op}/proposta-enviada", json={"analise_id": v["analise_id"], "aprovacao_id": apr})
    res = post(f"/api/oportunidades/{op}/resultado", json={"resultado": "vencedora"})
    passo("resultado", res)

    repo = Path(a.sandbox) / "repo-cliente-sigtrib"
    if not repo.exists():
        repo.mkdir(parents=True)
        (repo / "app.py").write_text("USUARIOS = {'ana@cliente.gov.br': 'x'}\n\ndef autenticar(email, senha):\n"
                                     "    return USUARIOS.get(email) == senha\n")
        (repo / "test_app.py").write_text("from app import autenticar\n\ndef test_email_maiusculo():\n"
                                          "    assert autenticar('Ana@Cliente.gov.br', 'x')\n")
        for cmd in (["git", "init", "-q"], ["git", "add", "."],
                    ["git", "-c", "user.email=demo@local", "-c", "user.name=demo", "commit", "-qm", "inicial"]):
            subprocess.run(cmd, cwd=repo, check=True)
    regras = {"sistemas": ["SIGTRIB"], "repositorio": str(repo),
              "comando_testes": f"{sys.executable} -m pytest -q -p no:cacheprovider",
              "severidade_por_palavra": {"critica": ["não consegue fazer login", "fora do ar"], "alta": ["lento", "erro"]},
              "fora_escopo_palavras": ["novo módulo"], "prazo_pagamento_dias": 30,
              "criterios_aceite": "testes automatizados verdes + aceite do fiscal do contrato",
              "regra_medicao": "UST por ordem de serviço aprovada"}
    dados = {"oportunidade_id": op, "numero": "101/2026-DEMO", "orgao": "Prefeitura Municipal de Exemplo (DEMONSTRAÇÃO)",
             "objeto": "Manutenção de sistema web de gestão tributária", "valor_total": v["preco_considerado"],
             "modelo_cobranca": "UST", "valor_unidade": "80.00", "vigencia_inicio": HOJE.isoformat(),
             "vigencia_fim": (HOJE + timedelta(days=365)).isoformat(), "ordem_servico": "OS 001/2026-DEMO", "regras": regras}
    ct = post("/api/contratos", data={"dados": json.dumps(dados)}, files={"arquivo": ("contrato-101-DEMO.pdf", gerar_pdf([CONTRATO]))})
    cid = ct["contrato_id"]
    ini_ap = post(f"/api/contratos/{cid}/solicitar-inicio")["aprovacao_id"]
    h = next(x for x in c.get("/api/aprovacoes").json() if x["id"] == ini_ap)["hash"]
    post(f"/api/aprovacoes/{ini_ap}/decidir", json={"decisao": "aprovar", "hash": h, "justificativa": "demonstração"})
    ini = post(f"/api/contratos/{cid}/iniciar", json={"aprovacao_id": ini_ap})
    passo("contrato_e_squad", {"contrato": ct, "projeto": ini.get("projeto_id"), "squad": ini.get("squad_id"),
                               "equipe": [m["agente"] for m in ini["plano"]["equipe"]]})

    ch = post("/api/chamados", json={"texto": "O cliente não consegue fazer login no SIGTRIB desde 8h, usuários do setor fiscal"})
    passo("chamado", ch)

    def esperar(tid: int, estados: tuple[str, ...], limite: int = 90) -> dict:
        for _ in range(limite):
            t = next(x for x in c.get("/api/tarefas").json() if x["id"] == tid)
            if t["estado"] in estados:
                return t
            time.sleep(1)
        return t

    t1 = esperar(ch["tarefas"][0], ("em_revisao", "bloqueada", "falhou"))
    passo("reproducao_pelo_worker", {"estado": t1["estado"], "resultado": t1["resultado"], "erro": t1["erro"]})
    post(f"/api/tarefas/{ch['tarefas'][0]}/revisar", json={"aprovado": True, "nota": "falha reproduzida"})
    subprocess.run(["git", "checkout", "-qB", f"chamado-{ch['chamado_id']}"], cwd=repo, check=True)
    (repo / "app.py").write_text("USUARIOS = {'ana@cliente.gov.br': 'x'}\n\ndef autenticar(email, senha):\n"
                                 "    return USUARIOS.get(email.strip().lower()) == senha\n")
    alt = post(f"/api/tarefas/{ch['tarefas'][1]}/alteracao-codigo", json={"repositorio": str(repo),
                                                                          "autor": "agente:desenvolvedor-full-stack"})
    passo("correcao_registrada", alt)
    post(f"/api/tarefas/{ch['tarefas'][1]}/revisar", json={"aprovado": True, "nota": "diff revisado"})
    t3 = esperar(ch["tarefas"][2], ("em_revisao", "falhou", "bloqueada"))
    passo("validacao_pelo_worker", {"estado": t3["estado"], "resultado": t3["resultado"]})
    post(f"/api/tarefas/{ch['tarefas'][2]}/revisar", json={"aprovado": True})
    ex_id = json.loads(t3["resultado"])["execucao_id"]

    en = post("/api/entregas", json={"contrato_id": cid, "descricao": f"Correção do chamado #{ch['chamado_id']}",
                                     "quantidade": "40", "unidade": "UST", "tarefa_id": ch["tarefas"][2],
                                     "evidencias": [f"execucao_ferramenta:{ex_id}"]})["id"]
    post(f"/api/entregas/{en}/decidir", json={"aceita": True, "quem": "fiscal do contrato (demonstração)"})
    med = post("/api/medicoes", json={"contrato_id": cid, "periodo": HOJE.strftime("%Y-%m")})
    dm = post(f"/api/medicoes/{med['medicao_id']}/decidir", json={"aceita": True, "glosa": "0", "quem": "fiscal (demo)"})
    nf = post(f"/api/medicoes/{med['medicao_id']}/nota")
    post(f"/api/aprovacoes/{nf['aprovacao_id']}/decidir", json={"decisao": "aprovar", "hash": nf["hash"]})
    em = post(f"/api/notas/{nf['nota_id']}/emitir", json={"aprovacao_id": nf["aprovacao_id"]})
    passo("medicao_e_nota", {"medicao": med, "aceite": dm, "previa": nf.get("previa"), "emissao": em})
    passo("financeiro", c.get("/api/financeiro").json()["totais"])
    for perg in ("O que vence esta semana?", "Quanto tenho para receber?", "O que preciso fazer para faturar?"):
        passo(f"pergunta: {perg}", post("/api/financeiro/perguntar", json={"pergunta": perg}))
    passo("chat_auditor", post("/api/mensagens", json={"canal": "agente", "ref": "auditor-de-execucao",
                                                       "texto": f"Auditor, prove a tarefa #{ch['tarefas'][2]}"})["respostas"])
    passo("relatorio_diario", post("/api/relatorios/diario"))
    lk = post("/api/links", json={"tipo": "escritorio", "horas": 24})
    passo("link_ao_vivo", {"expira_em": lk.get("expira_em"), "url_local": lk.get("url")})
    passo("auditoria", c.get("/api/auditoria/verificar").json())
    Path(a.saida).parent.mkdir(parents=True, exist_ok=True)
    Path(a.saida).write_text(json.dumps(LOG, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
