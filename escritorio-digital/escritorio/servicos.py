"""Serviços de aplicação: orquestram domínio, banco, auditoria, motor e integrações."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from . import auditoria, integracoes, motor
from .agentes import formar_squad, montar_catalogo, tipo_objeto
from .db import Banco, agora
from .dominio import conformidade, documentos
from .dominio.financeiro import (
    D,
    EntradaViabilidade,
    RegraTributo,
    analisar_viabilidade,
    reais,
    tributos_aplicaveis,
)
from .dominio.regras import checar_aprovacao, classificar_severidade, hash_versao


class ErroNegocio(ValueError):
    pass


def hoje() -> date:
    return datetime.now(UTC).date()


def _j(v: str | None, padrao: Any = None) -> Any:
    return json.loads(v) if v else padrao


# ======================================================================= inicialização
def inicializar(db: Banco) -> None:
    for a in montar_catalogo():
        if not db.um("SELECT id FROM agente WHERE id=?", a["id"]):
            db.inserir("agente", a)
    for nome in ("pncp", "worker"):
        if not db.um("SELECT nome FROM integracao WHERE nome=?", nome):
            db.inserir("integracao", {"nome": nome, "situacao": "nao_verificado"})


def _hash_senha(senha: str, sal: bytes | None = None) -> str:
    sal = sal or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, 310_000)
    return f"pbkdf2${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def _confere_senha(senha: str, armazenado: str) -> bool:
    _, sal, h = armazenado.split("$")
    return hmac.compare_digest(_hash_senha(senha, base64.b64decode(sal)).split("$")[2], h)


def criar_empresa(db: Banco, dados: dict[str, Any], responsavel: str) -> int:
    eid = db.inserir("empresa", {**dados, "origem": dados.get("origem", "cadastro manual"),
                                 "responsavel": responsavel, "atualizado_em": agora()})
    auditoria.registrar(db, "empresa.criada", f"Empresa {dados['razao_social']} cadastrada", empresa_id=eid,
                        ator_tipo="usuario", ator_id=responsavel, objeto_tipo="empresa", objeto_id=eid)
    return eid


def criar_usuario(db: Banco, empresa_id: int, nome: str, email: str, senha: str, papel: str,
                  telefone: str | None = None) -> int:
    if len(senha) < 10:
        raise ErroNegocio("Senha deve ter ao menos 10 caracteres")
    uid = db.inserir("usuario", {"empresa_id": empresa_id, "nome": nome, "email": email.lower(),
                                 "senha_hash": _hash_senha(senha), "papel": papel, "telefone_whatsapp": telefone})
    auditoria.registrar(db, "usuario.criado", f"Usuário {nome} ({papel}) criado", empresa_id=empresa_id,
                        objeto_tipo="usuario", objeto_id=uid)
    return uid


def login(db: Banco, email: str, senha: str) -> str:
    u = db.um("SELECT * FROM usuario WHERE email=? AND ativo=1", email.lower())
    if not u or not _confere_senha(senha, u["senha_hash"]):
        auditoria.registrar(db, "seguranca.login_falhou", f"Tentativa de login falhou para {email}")
        raise PermissionError("Credenciais inválidas")
    token = secrets.token_urlsafe(32)
    db.inserir("sessao", {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "usuario_id": u["id"],
                          "expira_em": (datetime.now(UTC) + timedelta(hours=12)).isoformat()})
    auditoria.registrar(db, "seguranca.login", f"{u['nome']} entrou", empresa_id=u["empresa_id"],
                        ator_tipo="usuario", ator_id=str(u["id"]))
    return token


def usuario_por_token(db: Banco, token: str) -> dict[str, Any] | None:
    s = db.um("SELECT u.* , s.expira_em FROM sessao s JOIN usuario u ON u.id=s.usuario_id WHERE s.token_hash=?",
              hashlib.sha256(token.encode()).hexdigest())
    if not s or s["expira_em"] < datetime.now(UTC).isoformat() or not s["ativo"]:
        return None
    s.pop("senha_hash", None)
    return s


def pode_ver(db: Banco, usuario: dict[str, Any], objeto_tipo: str, objeto_id: int | None) -> bool:
    """Isolamento por contrato/oportunidade: admin vê tudo da empresa; demais, só o liberado."""
    if objeto_id is None:
        return usuario["papel"] == "admin"
    tabela = {"contrato": "contrato", "oportunidade": "oportunidade"}[objeto_tipo]
    obj = db.um(f"SELECT empresa_id FROM {tabela} WHERE id=?", objeto_id)  # noqa: S608
    if not obj or obj["empresa_id"] != usuario["empresa_id"]:
        return False
    if usuario["papel"] == "admin":
        return True
    return db.um("SELECT 1 FROM acesso WHERE usuario_id=? AND objeto_tipo=? AND objeto_id=?",
                 usuario["id"], objeto_tipo, objeto_id) is not None


# ======================================================================= links seguros
def _segredo() -> bytes:
    s = os.getenv("ESCRITORIO_SEGREDO_LINKS")
    if not s:
        raise RuntimeError("ESCRITORIO_SEGREDO_LINKS não definido")
    return s.encode()


def criar_link(db: Banco, escopo: str, horas: int, criado_por: int) -> dict[str, str]:
    """Link assinado (HMAC), com validade e escopo restrito, revogável."""
    if horas > 72:
        raise ErroNegocio("Validade máxima de link: 72h")
    jti = secrets.token_urlsafe(12)
    exp = (datetime.now(UTC) + timedelta(hours=horas)).isoformat(timespec="seconds")
    corpo = base64.urlsafe_b64encode(json.dumps({"j": jti, "e": escopo, "x": exp}).encode()).decode().rstrip("=")
    sig = hmac.new(_segredo(), corpo.encode(), hashlib.sha256).hexdigest()[:32]
    db.inserir("link_seguro", {"jti": jti, "escopo": escopo, "criado_por": criado_por, "expira_em": exp,
                               "criado_em": agora()})
    auditoria.registrar(db, "link.criado", f"Link seguro '{escopo}' válido até {exp}", ator_tipo="usuario",
                        ator_id=str(criado_por), objeto_tipo="link", objeto_id=jti)
    return {"token": f"{corpo}.{sig}", "escopo": escopo, "expira_em": exp}


def validar_link(db: Banco, token: str) -> dict[str, Any]:
    try:
        corpo, sig = token.rsplit(".", 1)
    except ValueError as ex:
        raise PermissionError("Link inválido") from ex
    if not hmac.compare_digest(hmac.new(_segredo(), corpo.encode(), hashlib.sha256).hexdigest()[:32], sig):
        raise PermissionError("Assinatura inválida")
    d = json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4)))
    reg = db.um("SELECT * FROM link_seguro WHERE jti=?", d["j"])
    if not reg or reg["revogado"] or d["x"] < agora():
        raise PermissionError("Link expirado ou revogado")
    return {"escopo": d["e"], "expira_em": d["x"]}


# ======================================================================= cadastro
def cadastrar(db: Banco, tabela: str, empresa_id: int, dados: dict[str, Any], responsavel: str) -> int:
    if tabela not in ("servico", "funcionario", "fornecedor", "tributo_regra"):
        raise ErroNegocio("Cadastro não suportado")
    extra: dict[str, Any] = {"atualizado_em": agora()} if tabela != "tributo_regra" else {}
    if tabela == "servico":
        extra.update({"origem": dados.pop("origem", "cadastro manual"), "responsavel": responsavel})
    rid = db.inserir(tabela, {"empresa_id": empresa_id, **dados, **extra})
    auditoria.registrar(db, f"{tabela}.cadastrado", f"{tabela} #{rid} cadastrado: {dados.get('nome', '')}",
                        empresa_id=empresa_id, ator_tipo="usuario", ator_id=responsavel, objeto_tipo=tabela,
                        objeto_id=rid)
    return rid


def _dir_arquivos() -> Path:
    p = Path(os.getenv("ESCRITORIO_ARQUIVOS", "dados/arquivos"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def importar_documento(db: Banco, empresa_id: int, conteudo: bytes, nome: str, responsavel: str, *,
                       oportunidade_id: int | None = None, contrato_id: int | None = None,
                       tipo: str | None = None, validade: str | None = None, origem: str = "upload",
                       validacao: str = "nao_validado") -> dict[str, Any]:
    lt = documentos.ler(conteudo, nome)
    caminho = _dir_arquivos() / lt.sha256
    caminho.write_bytes(conteudo)
    texto = "\n".join(lt.paginas)
    tipo_auto, conf = documentos.classificar(texto) if texto.strip() else ("desconhecido", "baixa")
    tipo_final = tipo or tipo_auto
    anterior = None
    if oportunidade_id and tipo_final in ("edital", "retificacao"):
        anterior = db.um("SELECT * FROM documento WHERE oportunidade_id=? AND tipo IN ('edital','retificacao') "
                         "ORDER BY versao DESC LIMIT 1", oportunidade_id)
    leitura = "completa" if lt.completa else "incompleta"
    did = db.inserir("documento", {
        "empresa_id": empresa_id, "oportunidade_id": oportunidade_id, "contrato_id": contrato_id, "titulo": nome,
        "tipo": tipo_final, "tipo_confianca": "informado" if tipo else conf, "arquivo": str(caminho),
        "sha256": lt.sha256, "mime": lt.mime, "paginas": len(lt.paginas), "paginas_sem_texto": lt.paginas_sem_texto,
        "leitura": leitura, "validade": validade, "versao": (anterior["versao"] + 1) if anterior else 1,
        "substitui_id": anterior["id"] if anterior else None, "origem": origem, "responsavel": responsavel,
        "validacao": validacao, "criado_em": agora()})
    for i, t in enumerate(lt.paginas, start=1):
        db.inserir("documento_pagina", {"documento_id": did, "pagina": i, "texto": t})
    auditoria.registrar(
        db, "documento.lido", f"Documento #{did} '{nome}' classificado como {tipo_final} ({conf}); "
        f"{len(lt.paginas)} pág.; leitura {leitura}", ator_tipo="agente", ator_id="leitor-de-edital-e-anexos",
        empresa_id=empresa_id, oportunidade_id=oportunidade_id, contrato_id=contrato_id, objeto_tipo="documento",
        objeto_id=did, dados={"alertas": lt.alertas, "sha256": lt.sha256})
    res: dict[str, Any] = {"id": did, "tipo": tipo_final, "confianca": conf if not tipo else "informado",
                           "paginas": len(lt.paginas), "leitura": leitura, "alertas": lt.alertas, "mime": lt.mime}
    if conf == "baixa" and not tipo:
        res["pergunta"] = "Classificação incerta: confirme o tipo deste documento."
    if anterior and oportunidade_id:
        antigas = [p["texto"] for p in db.todos(
            "SELECT texto FROM documento_pagina WHERE documento_id=? ORDER BY pagina", anterior["id"])]
        res["diff"] = documentos.diff_versoes(antigas, lt.paginas)
        reabrir_por_retificacao(db, empresa_id, oportunidade_id, did, res["diff"])
    return res


def reabrir_por_retificacao(db: Banco, empresa_id: int, op_id: int, doc_id: int, diff: list[Any]) -> None:
    """Retificação: invalida aprovações da oportunidade e reabre a análise."""
    with db.tx() as c:
        n = c.execute("UPDATE aprovacao SET situacao='expirada', justificativa='retificação do edital' "
                      "WHERE objeto_tipo='analise' AND situacao IN ('pendente','aprovada') AND objeto_id IN "
                      "(SELECT id FROM analise WHERE oportunidade_id=?)", (op_id,)).rowcount
        c.execute("UPDATE oportunidade SET situacao='reanalise_por_retificacao' WHERE id=?", (op_id,))
    auditoria.registrar(db, "edital.retificado", f"Retificação (doc #{doc_id}) com {len(diff)} página(s) alteradas; "
                        f"{n} aprovação(ões) expiradas; análise reaberta", ator_tipo="agente",
                        ator_id="monitor-de-retificacoes", empresa_id=empresa_id, oportunidade_id=op_id,
                        objeto_tipo="oportunidade", objeto_id=op_id, dados={"paginas": [d["pagina"] for d in diff]})


# ======================================================================= oportunidades
# Expressões comuns em editais que não indicam o objeto (geravam falso positivo).
RUIDO_LICITACAO = ["sistema de registro de preços", "sistema de registro de preço", "registro de preços",
                   "sistema único de saúde", "sistema único", "sistema de compras", "sistema eletrônico"]


def _normalizar(t: str) -> str:
    t = t.lower()
    for r in RUIDO_LICITACAO:
        t = t.replace(r, " ")
    return t


def aderencia(db: Banco, empresa_id: int, objeto: str) -> tuple[int, list[str]]:
    """Pontuação determinística: frase-chave = 40, palavra isolada = 15, por palavra inteira.
    Palavras de exclusão do serviço zeram a contribuição daquele serviço."""
    t = _normalizar(objeto)
    casou: list[str] = []
    total = 0
    for s in db.todos("SELECT nome, palavras_chave, palavras_excluir FROM servico WHERE empresa_id=?", empresa_id):
        exclui = [x.strip().lower() for x in (s["palavras_excluir"] or "").split(",") if x.strip()]
        if any(re.search(rf"\b{re.escape(x)}\b", t) for x in exclui):
            continue
        for p in (s["palavras_chave"] or "").split(","):
            p = p.strip().lower()
            if p and re.search(rf"\b{re.escape(p)}\b", t):
                total += 40 if " " in p else 15
                casou.append(f"{s['nome']}: '{p}'")
    return min(100, total), casou


def criar_oportunidade(db: Banco, empresa_id: int, dados: dict[str, Any], ator: str = "usuario:1") -> int:
    ad, _ = aderencia(db, empresa_id, dados["objeto"])
    ex = db.um("SELECT id FROM oportunidade WHERE empresa_id=? AND fonte=? AND id_externo=?",
               empresa_id, dados.get("fonte", "manual"), dados.get("id_externo"))
    if ex and dados.get("id_externo"):
        return int(ex["id"])
    oid = db.inserir("oportunidade", {"empresa_id": empresa_id, "fonte": "manual", **dados, "aderencia": ad,
                                      "consultado_em": dados.get("consultado_em", agora())})
    tp, _, ai = ator.partition(":")
    auditoria.registrar(db, "oportunidade.registrada", f"Oportunidade #{oid}: {dados['objeto'][:90]} (aderência {ad}%)",
                        ator_tipo=tp, ator_id=ai, empresa_id=empresa_id, oportunidade_id=oid,
                        objeto_tipo="oportunidade", objeto_id=oid, dados={"link": dados.get("link")})
    return oid


def buscar_pncp(db: Banco, empresa_id: int, dias: int = 3, uf: str | None = None, paginas: int = 2,
                aderencia_minima: int = 30) -> dict[str, Any]:
    fim = hoje()
    ini = fim - timedelta(days=dias)
    encontrados, registrados = 0, []
    for pg in range(1, paginas + 1):
        r = integracoes.pncp_buscar(db, ini.strftime("%Y%m%d"), fim.strftime("%Y%m%d"), uf=uf, pagina=pg)
        itens = r.get("data", [])
        encontrados += len(itens)
        for it in itens:
            ad, casou = aderencia(db, empresa_id, it.get("objetoCompra") or "")
            if ad < aderencia_minima:
                continue
            org = it.get("orgaoEntidade", {})
            un = it.get("unidadeOrgao", {})
            idx = it.get("numeroControlePNCP")
            oid = criar_oportunidade(db, empresa_id, {
                "fonte": "pncp", "id_externo": idx,
                "link": f"https://pncp.gov.br/app/editais/{org.get('cnpj')}/{it.get('anoCompra')}/{it.get('sequencialCompra')}",
                "orgao": org.get("razaoSocial"), "orgao_cnpj": org.get("cnpj"), "uf": un.get("ufSigla"),
                "municipio": un.get("municipioNome"), "objeto": it.get("objetoCompra") or "",
                "modalidade": it.get("modalidadeNome"), "valor_estimado": str(it.get("valorTotalEstimado") or ""),
                "data_abertura": it.get("dataAberturaProposta"), "data_encerramento": it.get("dataEncerramentoProposta"),
                "consultado_em": r["consultado_em"],
                "dados": {"anoCompra": it.get("anoCompra"), "sequencialCompra": it.get("sequencialCompra"),
                          "casou": casou, "url_consulta": r["url"]}}, ator="agente:buscador-de-editais")
            registrados.append(oid)
        if pg >= int(r.get("totalPaginas") or 1):
            break
    auditoria.registrar(db, "pncp.busca", f"Busca PNCP {ini}→{fim}: {encontrados} publicações lidas, "
                        f"{len(registrados)} compatíveis", ator_tipo="agente", ator_id="buscador-de-editais",
                        empresa_id=empresa_id)
    return {"periodo": [ini.isoformat(), fim.isoformat()], "lidos": encontrados, "compativeis": registrados}


def agendar_download_pncp(db: Banco, op_id: int, responsavel: str) -> int:
    op = db.um("SELECT * FROM oportunidade WHERE id=?", op_id)
    return motor.criar_tarefa(db, op["empresa_id"], f"Baixar e ler arquivos do PNCP da oportunidade #{op_id}",
                              "baixar_pncp", executor_id="leitor-de-edital-e-anexos", oportunidade_id=op_id,
                              idempotency_key=f"pncp-download:{op_id}", parametros={"responsavel": responsavel})


@motor.handler("baixar_pncp")
def _h_baixar(db: Banco, t: dict[str, Any]) -> dict[str, Any]:
    docs = baixar_documentos_pncp(db, t["oportunidade_id"], _j(t["parametros"], {}).get("responsavel", "sistema"))
    if not docs:
        raise motor.Bloqueio("PNCP não retornou arquivos para esta contratação (edital sem anexos)")
    analise = analisar_oportunidade(db, t["oportunidade_id"])
    return {"resumo": f"{len(docs)} arquivo(s) lidos; parecer {analise['resumo']['parecer_habilitacao']}",
            "documentos": [{k: d.get(k) for k in ("id", "tipo", "paginas", "leitura")} for d in docs],
            "parecer": analise["resumo"], "evidencias": [f"documento:{d['id']}" for d in docs]}


def baixar_documentos_pncp(db: Banco, op_id: int, responsavel: str) -> list[dict[str, Any]]:
    op = db.um("SELECT * FROM oportunidade WHERE id=?", op_id)
    if not op or op["fonte"] != "pncp":
        raise ErroNegocio("Oportunidade não é do PNCP")
    d = _j(op["dados"], {})
    arqs = integracoes.pncp_arquivos(db, op["orgao_cnpj"], d["anoCompra"], d["sequencialCompra"])
    saida = []
    if not arqs:
        auditoria.registrar(db, "edital.sem_anexos", f"Oportunidade #{op_id}: PNCP não retornou arquivos",
                            ator_tipo="agente", ator_id="leitor-de-edital-e-anexos", empresa_id=op["empresa_id"],
                            oportunidade_id=op_id)
    for a in arqs:
        if not a.get("statusAtivo", True):
            continue
        conteudo = integracoes.baixar(a["url"])
        tipo = "edital" if (a.get("tipoDocumentoNome") or "").lower().startswith("edital") else None
        r = importar_documento(db, op["empresa_id"], conteudo, a.get("titulo") or "arquivo", responsavel,
                               oportunidade_id=op_id, tipo=tipo, origem=a["url"])
        saida.append(r)
    return saida


def analisar_oportunidade(db: Banco, op_id: int) -> dict[str, Any]:
    op = db.um("SELECT * FROM oportunidade WHERE id=?", op_id)
    if not op:
        raise ErroNegocio("Oportunidade inexistente")
    eid = op["empresa_id"]
    docs = db.todos("SELECT * FROM documento WHERE oportunidade_id=? ORDER BY id", op_id)
    if not docs:
        raise ErroNegocio("Nenhum documento do edital importado: leitura impossível")
    # usa apenas a última versão de cada documento
    substituidos = {d["substitui_id"] for d in docs if d["substitui_id"]}
    vigentes = [d for d in docs if d["id"] not in substituidos]
    with db.tx() as c:
        c.execute("DELETE FROM conformidade WHERE oportunidade_id=?", (op_id,))
        c.execute("DELETE FROM requisito WHERE oportunidade_id=?", (op_id,))
    reqs: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}
    incompletos = []
    for d in vigentes:
        pags = [p["texto"] for p in db.todos("SELECT texto FROM documento_pagina WHERE documento_id=? ORDER BY pagina",
                                             d["id"])]
        if d["leitura"] != "completa":
            incompletos.append({"documento": d["id"], "titulo": d["titulo"], "paginas_sem_texto": _j(d["paginas_sem_texto"], [])})
        meta = {**documentos.extrair_metadados(pags), **meta}
        for r in documentos.extrair_requisitos(pags):
            if any(x["chave"] == r.chave for x in reqs):
                continue
            rid = db.inserir("requisito", {"oportunidade_id": op_id, "documento_id": d["id"], "categoria": r.categoria,
                                           "chave": r.chave, "descricao": r.descricao, "pagina": r.pagina,
                                           "trecho": r.trecho, "valor_exigido": r.valor_exigido})
            reqs.append({"id": rid, "documento_id": d["id"], **r.__dict__})
    data_sessao = None
    if meta.get("sessao"):
        dd, mm, aa = meta["sessao"]["data"].split("/")
        data_sessao = date(int(aa), int(mm), int(dd))
    elif op["data_abertura"]:
        data_sessao = date.fromisoformat(op["data_abertura"][:10])
    docs_emp = db.todos("SELECT * FROM documento WHERE empresa_id=? AND oportunidade_id IS NULL AND contrato_id IS NULL",
                        eid)
    funcs = db.todos("SELECT * FROM funcionario WHERE empresa_id=?", eid)
    linhas = conformidade.avaliar(reqs, docs_emp, funcs, data_sessao, hoje())
    for ln in linhas:
        db.inserir("conformidade", {"oportunidade_id": op_id, "requisito_id": ln["requisito_id"],
                                    "situacao": ln["situacao"], "evidencia": ln["evidencia"],
                                    "pendencia": ln["pendencia"], "responsavel": ln["responsavel"],
                                    "prazo": ln["prazo"], "gerado_em": agora()})
    res = conformidade.resumo(linhas)
    if incompletos:
        res["leitura"] = "INCOMPLETA — há páginas/arquivos não lidos; análise não cobre todo o edital"
    else:
        res["leitura"] = "completa (texto extraído de todas as páginas)"
    squad = formar_squad(op["objeto"], "licitacao", " ".join(r["trecho"] for r in reqs))
    sid = _registrar_squad(db, eid, f"Licitação #{op_id}", squad, oportunidade_id=op_id)
    db.atualizar("oportunidade", op_id, {"situacao": "analisada", "fuso_sessao": op["fuso_sessao"]})
    for agente_id, cat in (("analista-de-habilitacao", "habilitacao_documental"),
                           ("analista-de-qualificacao-tecnica", "capacidade_tecnica"),
                           ("analista-economico-financeiro", "financeiro"),
                           ("assistente-juridico-de-licitacoes", "contratual")):
        sub = [x for x in linhas if x["categoria"] == cat]
        auditoria.registrar(db, "analise.parcial", f"{len(sub)} requisito(s) de {cat} avaliados: "
                            + ", ".join(f"{x['requisito']}={x['situacao']}" for x in sub)[:400],
                            ator_tipo="agente", ator_id=agente_id, empresa_id=eid, oportunidade_id=op_id)
    pend = [x for x in linhas if x["situacao"] in (conformidade.NAO, conformidade.INSUF)]
    for x in pend:
        motor.criar_tarefa(db, eid, f"[Licitação #{op_id}] Sanar: {x['requisito']} — {x['pendencia']}", "pendencia_documental",
                           executor_tipo="humano", executor_id="arthur", estado="planejada",
                           idempotency_key=f"pend:{op_id}:{x['requisito_id']}", oportunidade_id=op_id)
    auditoria.registrar(db, "analise.concluida", f"Oportunidade #{op_id}: {len(reqs)} requisitos, parecer "
                        f"{res['parecer_habilitacao']}; {len(pend)} pendência(s)", ator_tipo="agente",
                        ator_id="leitor-de-edital-e-anexos", empresa_id=eid, oportunidade_id=op_id,
                        dados={**res, "squad_id": sid})
    return {"oportunidade": op_id, "metadados": meta, "data_sessao": data_sessao.isoformat() if data_sessao else None,
            "requisitos": len(reqs), "matriz": linhas, "resumo": res, "documentos_incompletos": incompletos,
            "squad_id": sid, "squad": squad}


def _registrar_squad(db: Banco, empresa_id: int, nome: str, squad: dict[str, Any], **ref: Any) -> int:
    chave = "oportunidade_id" if "oportunidade_id" in ref else "contrato_id"
    ex = db.um(f"SELECT id FROM squad WHERE {chave}=? AND nome=?", ref[chave], nome)  # noqa: S608
    if ex:
        return int(ex["id"])
    sid = db.inserir("squad", {"empresa_id": empresa_id, "nome": nome, "tipo": squad["tipo"], "lider": squad["lider"],
                               "orcamento_ia": "50.00", "criterios_aceite": squad.get("humanos_obrigatorios", []),
                               "criado_em": agora(), **ref})
    for m in squad["membros"]:
        db.inserir("squad_membro", {"squad_id": sid, "membro_tipo": "agente", "membro_id": m["agente"],
                                    "papel": "líder" if m["agente"] == squad["lider"] else "membro",
                                    "motivo": m["motivo"]})
    auditoria.registrar(db, "squad.formado", f"Squad '{nome}' ({squad['tipo']}) com {len(squad['membros'])} agentes",
                        ator_tipo="agente", ator_id="orquestrador-geral", empresa_id=empresa_id,
                        objeto_tipo="squad", objeto_id=sid, **ref)
    return sid


# ======================================================================= cotações e viabilidade
def registrar_cotacao(db: Banco, empresa_id: int, dados: dict[str, Any]) -> int:
    cid = db.inserir("cotacao", {"empresa_id": empresa_id, **dados, "situacao": "recebida", "criado_em": agora()})
    auditoria.registrar(db, "cotacao.recebida", f"Cotação #{cid} de fornecedor #{dados['fornecedor_id']}: "
                        f"{dados['item']} R$ {dados['preco_unitario']} × {dados['quantidade']}",
                        empresa_id=empresa_id, oportunidade_id=dados.get("oportunidade_id"),
                        objeto_tipo="cotacao", objeto_id=cid)
    return cid


def marcar_cotacao(db: Banco, cid: int, evento: str, ator: str) -> None:
    """Três eventos distintos: confirmada pelo fornecedor, validada pelos agentes, aprovada pelo administrador."""
    campo, sit = {"fornecedor": ("confirmada_fornecedor_em", "confirmada_fornecedor"),
                  "agentes": ("validada_agentes_em", "validada_agentes"),
                  "administrador": ("aprovada_em", "aprovada")}[evento]
    c = db.um("SELECT * FROM cotacao WHERE id=?", cid)
    if evento == "agentes":
        if not c["confirmada_fornecedor_em"]:
            raise ErroNegocio("Fornecedor ainda não confirmou a cotação")
        if c["validade"] < hoje().isoformat():
            raise ErroNegocio(f"Cotação vencida em {c['validade']}: solicitar nova")
    if evento == "administrador" and not c["validada_agentes_em"]:
        raise ErroNegocio("Cotação precisa de validação técnica antes da aprovação comercial")
    db.atualizar("cotacao", cid, {campo: agora(), "situacao": sit})
    tp, _, ai = ator.partition(":")
    auditoria.registrar(db, f"cotacao.{sit}", f"Cotação #{cid}: {sit}", ator_tipo=tp, ator_id=ai,
                        empresa_id=c["empresa_id"], oportunidade_id=c["oportunidade_id"], objeto_tipo="cotacao",
                        objeto_id=cid)


def calcular_viabilidade(db: Banco, op_id: int, p: dict[str, Any]) -> dict[str, Any]:
    op = db.um("SELECT * FROM oportunidade WHERE id=?", op_id)
    emp = db.um("SELECT * FROM empresa WHERE id=?", op["empresa_id"])
    custos: list[dict[str, Any]] = []
    alertas: list[str] = []
    for c in db.todos("SELECT * FROM cotacao WHERE oportunidade_id=?", op_id):
        if c["validade"] < hoje().isoformat():
            alertas.append(f"Cotação #{c['id']} vencida em {c['validade']} — excluída do cálculo")
            continue
        if not c["confirmada_fornecedor_em"]:
            alertas.append(f"Cotação #{c['id']} sem confirmação do fornecedor — considerada, mas não confirmada")
        custos.append({"descricao": f"{c['item']} (cotação #{c['id']})",
                       "valor": D(c["preco_unitario"]) * D(c["quantidade"]) + D(c["frete"]),
                       "origem": f"cotacao:{c['id']}"})
    for m in p.get("mao_de_obra", []):
        f = db.um("SELECT * FROM funcionario WHERE id=?", m["funcionario_id"])
        custos.append({"descricao": f"Mão de obra {f['nome']} {m['horas']}h", "origem": f"funcionario:{f['id']}",
                       "valor": D(f["custo_hora"]) * D(m["horas"])})
    for o in p.get("outros_custos", []):
        custos.append(o)
    regras = [RegraTributo(r["nome"], D(r["aliquota_pct"]), date.fromisoformat(r["vigencia_inicio"]),
                           date.fromisoformat(r["vigencia_fim"]) if r["vigencia_fim"] else None, r["fonte"],
                           bool(r["validado_contador"]), bool(r["retido"]), r["aplica_categoria"])
              for r in db.todos("SELECT * FROM tributo_regra WHERE empresa_id=?", op["empresa_id"])]
    trib = tributos_aplicaveis(regras, p.get("categoria_tributaria", "servico"), hoje())
    entrada = EntradaViabilidade(
        custos_diretos=custos, indiretos_pct=D(p.get("indiretos_pct", 10)), margem_alvo_pct=D(p.get("margem_alvo_pct", 15)),
        margem_minima_pct=D(emp["margem_minima_pct"]), tributos=trib, duracao_meses=int(p.get("duracao_meses", 12)),
        prazo_recebimento_dias=int(p.get("prazo_recebimento_dias", 60)),
        prazo_pagamento_fornecedor_dias=int(p.get("prazo_pagamento_fornecedor_dias", 30)),
        capital_giro_disponivel=D(emp["capital_giro_disponivel"]),
        valor_estimado_edital=D(op["valor_estimado"]) if op["valor_estimado"] else None,
        preco_proposto=D(p["preco_proposto"]) if p.get("preco_proposto") else None)
    res = analisar_viabilidade(entrada)
    res["alertas"] = alertas + res["alertas"]
    conf = db.todos("SELECT situacao, COUNT(*) n FROM conformidade WHERE oportunidade_id=? GROUP BY situacao", op_id)
    res["habilitacao"] = {c["situacao"]: c["n"] for c in conf}
    if res["habilitacao"].get(conformidade.NAO):
        res["recomendacao"] = "nao_recomendado_ate_sanar_habilitacao"
    ultima = db.um("SELECT MAX(versao) v FROM analise WHERE oportunidade_id=?", op_id)
    versao = (ultima["v"] or 0) + 1
    conteudo = {"oportunidade": op_id, "versao": versao, "entrada": p, "resultado": res}
    h = hash_versao(conteudo)
    aid = db.inserir("analise", {"oportunidade_id": op_id, "versao": versao, "entrada": p, "resultado": res, "hash": h,
                                 "criado_em": agora()})
    for ag, txt in (("analista-de-custos", f"custo total R$ {res['custo_total']}"),
                    ("analista-tributario", f"tributos {res['tributos_pct']}% (provisório={res['tributos_provisorio']})"),
                    ("formador-de-precos", f"preço R$ {res['preco_considerado']}, margem {res['margem_pct']}%"),
                    ("analista-de-capital-de-giro", f"capital de giro necessário R$ {res['capital_giro_necessario']}")):
        auditoria.registrar(db, "viabilidade.calculo", f"Análise v{versao} op #{op_id}: {txt}", ator_tipo="agente",
                            ator_id=ag, empresa_id=op["empresa_id"], oportunidade_id=op_id, objeto_tipo="analise",
                            objeto_id=aid)
    return {"analise_id": aid, "versao": versao, "hash": h, **res}


# ======================================================================= aprovações
def solicitar_aprovacao(db: Banco, empresa_id: int, acao: str, objeto_tipo: str, objeto_id: int, versao: int,
                        conteudo_hash: str, solicitante: str, resumo: str, valor: str | None = None,
                        validade_horas: int = 72) -> int:
    aid = db.inserir("aprovacao", {
        "empresa_id": empresa_id, "acao": acao, "objeto_tipo": objeto_tipo, "objeto_id": objeto_id, "versao": versao,
        "hash": conteudo_hash, "valor": valor, "resumo": resumo, "solicitante": solicitante,
        "validade": (datetime.now(UTC) + timedelta(hours=validade_horas)).isoformat(timespec="seconds"),
        "criado_em": agora()})
    tp, _, ai = solicitante.partition(":")
    auditoria.registrar(db, "aprovacao.solicitada", f"Aprovação #{aid} solicitada: {acao} {objeto_tipo} #{objeto_id} "
                        f"v{versao} — {resumo}", ator_tipo=tp, ator_id=ai, empresa_id=empresa_id,
                        objeto_tipo="aprovacao", objeto_id=aid, dados={"hash": conteudo_hash, "valor": valor})
    return aid


CANAIS_ACAO_SENSIVEL = {"painel"}


def decidir_aprovacao(db: Banco, aid: int, usuario: dict[str, Any], decisao: str, canal: str = "painel",
                      justificativa: str = "", hash_confirmado: str | None = None) -> dict[str, Any]:
    a = db.um("SELECT * FROM aprovacao WHERE id=?", aid)
    if not a or a["empresa_id"] != usuario["empresa_id"]:
        raise PermissionError("Aprovação não encontrada")
    if usuario["papel"] != "admin":
        raise PermissionError("Somente o administrador aprova esta ação")
    if a["situacao"] != "pendente":
        raise ErroNegocio(f"Aprovação já está '{a['situacao']}'")
    if canal not in CANAIS_ACAO_SENSIVEL:
        raise PermissionError("Ação sensível: confirme no painel autenticado (um 'sim' em mensagem não aprova)")
    if decisao == "aprovar" and hash_confirmado != a["hash"]:
        raise ErroNegocio("Confirme a versão exata: o código da versão enviado não confere")
    if a["validade"] and a["validade"] < agora():
        db.atualizar("aprovacao", aid, {"situacao": "expirada"})
        raise ErroNegocio("Pedido de aprovação expirado")
    sit = "aprovada" if decisao == "aprovar" else "rejeitada"
    db.atualizar("aprovacao", aid, {"situacao": sit, "aprovador_id": usuario["id"], "decidido_em": agora(),
                                    "canal": canal, "justificativa": justificativa})
    auditoria.registrar(db, f"aprovacao.{sit}", f"Aprovação #{aid} {sit} por {usuario['nome']}: {a['acao']} "
                        f"{a['objeto_tipo']} #{a['objeto_id']} v{a['versao']}", ator_tipo="usuario",
                        ator_id=str(usuario["id"]), empresa_id=a["empresa_id"], objeto_tipo="aprovacao", objeto_id=aid,
                        dados={"hash": a["hash"], "valor": a["valor"], "canal": canal})
    for t in db.todos("SELECT id FROM tarefa WHERE estado='aguardando_aprovacao' AND parametros LIKE ?",
                      f'%"aprovacao_id": {aid}%'):
        motor.mudar_estado(db, t["id"], "pronta" if sit == "aprovada" else "cancelada",
                           motivo=f"aprovação #{aid} {sit}")
    return {"id": aid, "situacao": sit}


def consumir_aprovacao(db: Banco, aid: int, acao: str, objeto_tipo: str, objeto_id: int, hash_atual: str,
                       executor: str) -> None:
    a = db.um("SELECT * FROM aprovacao WHERE id=?", aid)
    checar_aprovacao(a, acao, objeto_tipo, objeto_id, hash_atual, datetime.now(UTC), executor)
    db.atualizar("aprovacao", aid, {"consumido_em": agora()})


def solicitar_participacao(db: Banco, analise_id: int, solicitante: str = "agente:gestor-de-portfolio") -> int:
    an = db.um("SELECT * FROM analise WHERE id=?", analise_id)
    op = db.um("SELECT * FROM oportunidade WHERE id=?", an["oportunidade_id"])
    r = _j(an["resultado"])
    return solicitar_aprovacao(db, op["empresa_id"], "participar_licitacao", "analise", analise_id, an["versao"],
                               an["hash"], solicitante, f"Participar de '{op['objeto'][:60]}' por R$ "
                               f"{r['preco_considerado']} (margem {r['margem_pct']}%, recomendação {r['recomendacao']})",
                               valor=r["preco_considerado"])


def registrar_proposta_enviada(db: Banco, analise_id: int, aprovacao_id: int, usuario: dict[str, Any]) -> None:
    """O envio no portal do órgão é feito pelo administrador; o sistema registra com vínculo à versão aprovada."""
    an = db.um("SELECT * FROM analise WHERE id=?", analise_id)
    consumir_aprovacao(db, aprovacao_id, "participar_licitacao", "analise", analise_id, an["hash"],
                       executor="sistema:registro")
    db.atualizar("oportunidade", an["oportunidade_id"], {"situacao": "proposta_enviada"})
    auditoria.registrar(db, "proposta.registrada", f"Proposta da análise v{an['versao']} registrada como enviada "
                        "(envio no portal feito pelo administrador)", ator_tipo="usuario", ator_id=str(usuario["id"]),
                        empresa_id=usuario["empresa_id"], oportunidade_id=an["oportunidade_id"],
                        dados={"hash": an["hash"]})


def registrar_resultado(db: Banco, op_id: int, resultado: str, usuario: dict[str, Any]) -> dict[str, Any]:
    if resultado not in ("vencedora", "perdida", "fracassada", "revogada"):
        raise ErroNegocio("Resultado inválido")
    sit = "vencida_aguardando_contrato" if resultado == "vencedora" else resultado
    db.atualizar("oportunidade", op_id, {"situacao": sit})
    auditoria.registrar(db, "licitacao.resultado", f"Oportunidade #{op_id}: {resultado}. "
                        + ("Vitória NÃO autoriza execução: aguardando contrato e ordem de início." if resultado ==
                           "vencedora" else ""), ator_tipo="usuario", ator_id=str(usuario["id"]),
                        empresa_id=usuario["empresa_id"], oportunidade_id=op_id)
    faltam = ["contrato assinado (documento)", "número do contrato", "ordem de serviço / autorização de início",
              "escopo final", "valores", "prazos", "regras de medição", "critérios de aceite",
              "condições de faturamento"] if resultado == "vencedora" else []
    return {"situacao": sit, "solicitar": faltam}


# ======================================================================= contratos e execução
def registrar_contrato(db: Banco, empresa_id: int, dados: dict[str, Any], usuario: dict[str, Any],
                       documento: tuple[bytes, str] | None = None) -> dict[str, Any]:
    obrig = ["numero", "objeto", "valor_total", "modelo_cobranca"]
    faltando = [k for k in obrig if not dados.get(k)]
    if faltando:
        raise ErroNegocio("Dados do contrato faltando: " + ", ".join(faltando))
    situacao = "assinado" if documento else "aguardando_documento"
    cid = db.inserir("contrato", {"empresa_id": empresa_id, "tipo_objeto": tipo_objeto(dados["objeto"]),
                                  "situacao": situacao, "criado_em": agora(), **dados})
    auditoria.registrar(db, "contrato.registrado", f"Contrato {dados['numero']} registrado ({situacao})",
                        ator_tipo="usuario", ator_id=str(usuario["id"]), empresa_id=empresa_id, contrato_id=cid,
                        oportunidade_id=dados.get("oportunidade_id"), objeto_tipo="contrato", objeto_id=cid)
    divergencias: list[str] = []
    if documento:
        doc = importar_documento(db, empresa_id, documento[0], documento[1], str(usuario["id"]), contrato_id=cid,
                                 tipo="contrato")
        pags = [p["texto"] for p in db.todos("SELECT texto FROM documento_pagina WHERE documento_id=? ORDER BY pagina",
                                             doc["id"])]
        for i, t in enumerate(pags, start=1):
            for m in re.finditer(r"(?im)^\s*(CL[ÁA]USULA [A-ZÇÃÉÊÍÓÚ ]+|\d+(?:\.\d+)+)\s*[–-]?\s*(.{15,220})$", t):
                db.inserir("obrigacao", {"contrato_id": cid, "clausula": f"{m.group(1).strip()} (p.{i})",
                                         "descricao": m.group(2).strip(), "tipo": "clausula"})
        if dados.get("oportunidade_id"):
            an = db.um("SELECT * FROM analise WHERE oportunidade_id=? ORDER BY versao DESC LIMIT 1",
                       dados["oportunidade_id"])
            if an:
                preco = D(_j(an["resultado"])["preco_considerado"])
                if reais(D(dados["valor_total"])) != reais(preco):
                    divergencias.append(f"Valor do contrato R$ {dados['valor_total']} difere da proposta R$ {preco}")
        n = db.um("SELECT COUNT(*) n FROM obrigacao WHERE contrato_id=?", cid)["n"]
        auditoria.registrar(db, "contrato.obrigacoes", f"{n} cláusula(s)/obrigação(ões) mapeadas do contrato",
                            ator_tipo="agente", ator_id="revisor-de-clausulas-e-obrigacoes", empresa_id=empresa_id,
                            contrato_id=cid, dados={"divergencias": divergencias})
    if dados.get("oportunidade_id"):
        db.atualizar("oportunidade", dados["oportunidade_id"], {"situacao": "contratada"})
    return {"contrato_id": cid, "situacao": situacao, "divergencias": divergencias}


def plano_projeto(db: Banco, contrato_id: int) -> dict[str, Any]:
    c = db.um("SELECT * FROM contrato WHERE id=?", contrato_id)
    obrig = db.todos("SELECT * FROM obrigacao WHERE contrato_id=?", contrato_id)
    regras = _j(c["regras"], {})
    squad = formar_squad(c["objeto"], "execucao")
    entregas = regras.get("entregas") or ["Plano de trabalho", "Ambiente e acessos", "Execução das ordens de serviço",
                                          "Relatórios mensais de medição", "Termo de encerramento"]
    eap = [{"codigo": f"{i}", "entrega": e, "responsavel": squad["lider"]} for i, e in enumerate(entregas, start=1)]
    return {
        "contrato": c["numero"], "objetivos": [c["objeto"]], "entregas": entregas, "eap": eap,
        "equipe": squad["membros"], "humanos_obrigatorios": squad["humanos_obrigatorios"],
        "marcos": [{"marco": "Início autorizado", "data": c["vigencia_inicio"]},
                   {"marco": "Encerramento", "data": c["vigencia_fim"]}],
        "orcamento": {"valor_total": c["valor_total"], "modelo_cobranca": c["modelo_cobranca"],
                      "valor_unidade": c["valor_unidade"]},
        "riscos": [{"risco": "Glosa de medição", "resposta": "evidência por item + revisão do fiscal interno"},
                   {"risco": "Atraso de pagamento", "resposta": "reserva de capital de giro e cobrança formal"}],
        "comunicacao": "chat do contrato + relatório diário + WhatsApp (se configurado)",
        "qualidade": "toda entrega com evidência, revisor e aceite",
        "aceite": regras.get("criterios_aceite", "conforme contrato — PENDENTE de informar"),
        "medicao": regras.get("regra_medicao", "PENDENTE de informar"),
        "rastreabilidade": "cláusula → requisito → tarefa → entrega → evidência → aceite → medição → faturamento → recebimento",
        "obrigacoes_mapeadas": [{"clausula": o["clausula"], "descricao": o["descricao"]} for o in obrig],
        "pendente_preencher": [k for k in ("criterios_aceite", "regra_medicao") if k not in regras],
    }


def solicitar_inicio_execucao(db: Banco, contrato_id: int) -> int:
    c = db.um("SELECT * FROM contrato WHERE id=?", contrato_id)
    if c["situacao"] != "assinado":
        raise ErroNegocio("Execução só pode iniciar com contrato assinado (documento anexado)")
    if not c["ordem_servico"]:
        raise ErroNegocio("Falta ordem de serviço / autorização de início")
    plano = plano_projeto(db, contrato_id)
    h = hash_versao({"contrato": dict(c), "plano": plano})
    return solicitar_aprovacao(db, c["empresa_id"], "iniciar_execucao", "contrato", contrato_id, 1, h,
                               "agente:coordenador-de-execucao-contratual",
                               f"Iniciar execução do contrato {c['numero']} com o plano gerado", valor=c["valor_total"])


def iniciar_execucao(db: Banco, contrato_id: int, aprovacao_id: int) -> dict[str, Any]:
    c = db.um("SELECT * FROM contrato WHERE id=?", contrato_id)
    plano = plano_projeto(db, contrato_id)
    consumir_aprovacao(db, aprovacao_id, "iniciar_execucao", "contrato", contrato_id,
                       hash_versao({"contrato": dict(c), "plano": plano}), "sistema:motor")
    pid = db.inserir("projeto", {"contrato_id": contrato_id, "nome": f"Execução {c['numero']}", "plano": plano,
                                 "criado_em": agora()})
    sid = _registrar_squad(db, c["empresa_id"], f"Contrato {c['numero']}", formar_squad(c["objeto"], "execucao"),
                           contrato_id=contrato_id)
    db.atualizar("contrato", contrato_id, {"situacao": "em_execucao"})
    for e in plano["entregas"]:
        motor.criar_tarefa(db, c["empresa_id"], f"[{c['numero']}] {e}", "entrega_contratual", executor_tipo="agente",
                           executor_id=formar_squad(c["objeto"], "execucao")["lider"], estado="planejada",
                           contrato_id=contrato_id, projeto_id=pid, idempotency_key=f"plano:{contrato_id}:{e}")
    auditoria.registrar(db, "contrato.execucao_iniciada", f"Execução do contrato {c['numero']} iniciada (projeto #{pid})",
                        empresa_id=c["empresa_id"], contrato_id=contrato_id, ator_tipo="agente",
                        ator_id="coordenador-de-execucao-contratual")
    return {"projeto_id": pid, "squad_id": sid, "plano": plano}


# ======================================================================= chamados
def abrir_chamado(db: Banco, empresa_id: int, texto: str, canal: str, solicitante: str,
                  contrato_id: int | None = None, sistema: str | None = None) -> dict[str, Any]:
    contratos = db.todos("SELECT * FROM contrato WHERE empresa_id=? AND situacao='em_execucao'", empresa_id)
    if contrato_id is None and len(contratos) == 1:
        contrato_id = contratos[0]["id"]
    faltando = []
    if contrato_id is None:
        faltando.append("contrato/cliente")
    if not sistema:
        for c in contratos:
            for s in (_j(c["regras"], {}).get("sistemas") or []):
                if s.lower() in texto.lower():
                    sistema, contrato_id = s, c["id"]
        if not sistema:
            faltando.append("sistema afetado")
    regras = _j(db.um("SELECT regras FROM contrato WHERE id=?", contrato_id)["regras"], {}) if contrato_id else {}
    sev, motivo_sev = classificar_severidade(texto, regras)
    escopo_pal = regras.get("fora_escopo_palavras", [])
    no_escopo = 0 if any(p in texto.lower() for p in escopo_pal) else 1
    if re.search(r"(?i)(desde quando|hor[áa]rio|usu[áa]rio)", texto) is None:
        faltando.append("desde quando ocorre e quais usuários são afetados")
    chid = db.inserir("chamado", {"empresa_id": empresa_id, "contrato_id": contrato_id, "sistema": sistema,
                                  "solicitante": solicitante, "canal": canal, "descricao": texto, "severidade": sev,
                                  "no_escopo": no_escopo, "faltando": faltando, "criado_em": agora()})
    auditoria.registrar(db, "chamado.aberto", f"Chamado #{chid} via {canal}: '{texto[:80]}' — severidade {sev} "
                        f"({motivo_sev}); {'no escopo' if no_escopo else 'FORA DO ESCOPO'}", ator_tipo="agente",
                        ator_id="analista-de-suporte-n1", empresa_id=empresa_id, contrato_id=contrato_id,
                        objeto_tipo="chamado", objeto_id=chid, dados={"faltando": faltando})
    tarefas = []
    if not no_escopo:
        tarefas.append(motor.criar_tarefa(
            db, empresa_id, f"Proposta de mudança para chamado #{chid} (fora do escopo)", "proposta_mudanca",
            executor_id="gerente-de-projeto", estado="planejada", contrato_id=contrato_id, chamado_id=chid,
            idempotency_key=f"chamado:{chid}:mudanca"))
    else:
        repo = regras.get("repositorio")
        t1 = motor.criar_tarefa(db, empresa_id, f"Reproduzir falha do chamado #{chid} (executar testes)",
                                "executar_testes", executor_id="investigador-de-incidentes", contrato_id=contrato_id,
                                chamado_id=chid, idempotency_key=f"chamado:{chid}:reproduzir",
                                parametros={"repositorio": repo, "comando": regras.get("comando_testes", "python -m pytest -q"),
                                            "esperado": "falha"},
                                estado="pronta" if repo else "bloqueada")
        if not repo:
            db.atualizar("tarefa", t1, {"erro": "Contrato sem repositório autorizado cadastrado"})
        t2 = motor.criar_tarefa(db, empresa_id, f"Implementar correção do chamado #{chid}", "correcao_codigo",
                                executor_id="desenvolvedor-full-stack", contrato_id=contrato_id, chamado_id=chid,
                                estado="planejada", idempotency_key=f"chamado:{chid}:corrigir",
                                parametros={"repositorio": repo})
        t3 = motor.criar_tarefa(db, empresa_id, f"Validar correção do chamado #{chid} (testes)", "executar_testes",
                                executor_id="engenheiro-de-testes", contrato_id=contrato_id, chamado_id=chid,
                                estado="planejada", idempotency_key=f"chamado:{chid}:validar",
                                parametros={"repositorio": repo, "comando": regras.get("comando_testes", "python -m pytest -q"),
                                            "esperado": "sucesso"})
        db.atualizar("tarefa", t3, {"depende_de": t2})
        tarefas += [t1, t2, t3]
    return {"chamado_id": chid, "contrato_id": contrato_id, "severidade": sev, "no_escopo": bool(no_escopo),
            "faltando": faltando, "tarefas": tarefas}


@motor.handler("executar_testes")
def _h_testes(db: Banco, t: dict[str, Any]) -> dict[str, Any]:
    p = _j(t["parametros"], {})
    if not p.get("repositorio"):
        raise motor.Bloqueio("Sem repositório autorizado")
    motor.heartbeat(db, t["id"])
    r = integracoes.executar_sandbox(p["repositorio"], p["comando"])
    eid = db.inserir("execucao_ferramenta", {"tarefa_id": t["id"], "ferramenta": "sandbox", "comando": r["comando"],
                                             "diretorio": r["diretorio"], "codigo_saida": r["codigo_saida"],
                                             "saida": auditoria.sanitizar(r["saida"]), "sha256_saida": r["sha256_saida"],
                                             "inicio": r["inicio"], "fim": r["fim"]})
    passou = r["codigo_saida"] == 0
    ultima = r["saida"].strip().splitlines()[-1] if r["saida"].strip() else ""
    # Falha da FERRAMENTA (não instalada, erro de uso, timeout) não é falha de TESTE: não vale como evidência.
    erro_ferramenta = (r["codigo_saida"] in (-1, 2, 3, 4, 5, 126, 127) or "No module named" in r["saida"]
                       or ("pytest" in p["comando"] and not passou and " failed" not in r["saida"]))
    if erro_ferramenta:
        auditoria.registrar(db, "ferramenta.erro", f"`{r['comando']}` não executou os testes (código "
                            f"{r['codigo_saida']}): {ultima[:160]}", ator_tipo="agente", ator_id=t["executor_id"],
                            empresa_id=t["empresa_id"], contrato_id=t["contrato_id"], objeto_tipo="execucao_ferramenta",
                            objeto_id=eid)
        raise motor.Bloqueio(f"Ferramenta de teste não executou (código {r['codigo_saida']}): {ultima[:200]} — "
                             f"ver execução #{eid}")
    auditoria.registrar(db, "ferramenta.executada", f"`{r['comando']}` → código {r['codigo_saida']}: {ultima[:160]}",
                        ator_tipo="agente", ator_id=t["executor_id"], empresa_id=t["empresa_id"],
                        contrato_id=t["contrato_id"], objeto_tipo="execucao_ferramenta", objeto_id=eid,
                        dados={"sha256_saida": r["sha256_saida"]})
    esperado = p.get("esperado", "sucesso")
    confirmou = (passou and esperado == "sucesso") or (not passou and esperado == "falha")
    return {"resumo": f"testes {'passaram' if passou else 'falharam'} (esperado: {esperado})",
            "execucao_id": eid, "codigo_saida": r["codigo_saida"], "confirmou_expectativa": confirmou,
            "evidencias": [f"execucao_ferramenta:{eid}"],
            "_proximo_estado": "em_revisao" if confirmou else "falhou" if esperado == "sucesso" else "em_revisao"}


def registrar_alteracao_codigo(db: Banco, tarefa_id: int, repositorio: str, autor: str) -> dict[str, Any]:
    """Registra o diff real do repositório (git) como evidência da tarefa de correção."""
    t = db.um("SELECT * FROM tarefa WHERE id=?", tarefa_id)
    diff = integracoes.executar_sandbox(repositorio, "git diff --stat HEAD")
    patch = integracoes.executar_sandbox(repositorio, "git diff HEAD")
    eid = db.inserir("execucao_ferramenta", {"tarefa_id": tarefa_id, "ferramenta": "git", "comando": "git diff HEAD",
                                             "diretorio": repositorio, "codigo_saida": patch["codigo_saida"],
                                             "saida": patch["saida"], "sha256_saida": patch["sha256_saida"],
                                             "inicio": patch["inicio"], "fim": patch["fim"]})
    if not patch["saida"].strip():
        raise ErroNegocio("Nenhuma alteração encontrada no repositório: nada a registrar")
    # Avança a tarefa até 'em_revisao' respeitando a máquina de estados.
    caminho = {"planejada": "pronta", "pronta": "executando", "executando": "em_revisao"}
    while (atual := db.um("SELECT estado FROM tarefa WHERE id=?", tarefa_id)["estado"]) in caminho:
        motor.mudar_estado(db, tarefa_id, caminho[atual], ator=autor, motivo="alteração de código registrada")
    db.atualizar("tarefa", tarefa_id, {"resultado": {"evidencias": [f"execucao_ferramenta:{eid}"],
                                                     "diff_stat": diff["saida"]}})
    auditoria.registrar(db, "codigo.alterado", f"Tarefa #{tarefa_id}: diff registrado — {diff['saida'].strip()[-120:]}",
                        ator_tipo=autor.partition(":")[0], ator_id=autor.partition(":")[2],
                        empresa_id=t["empresa_id"], contrato_id=t["contrato_id"], objeto_tipo="execucao_ferramenta",
                        objeto_id=eid)
    return {"execucao_id": eid, "diff_stat": diff["saida"]}


def revisar_tarefa(db: Banco, tarefa_id: int, revisor: str, aprovado: bool, nota: str = "") -> None:
    t = db.um("SELECT * FROM tarefa WHERE id=?", tarefa_id)
    if revisor == f"agente:{t['executor_id']}":
        raise PermissionError("Executor não pode revisar a própria tarefa")
    evid = (_j(t["resultado"], {}) or {}).get("evidencias", [])
    if aprovado and not evid:
        raise ErroNegocio("Sem evidência verificável: não pode ser concluída")
    motor.mudar_estado(db, tarefa_id, "concluida" if aprovado else "pronta", ator=revisor,
                       motivo=("revisado e aprovado" if aprovado else "devolvido: ") + nota, revisor=revisor)
    if aprovado:
        dep = db.todos("SELECT id FROM tarefa WHERE depende_de=? AND estado='planejada'", tarefa_id)
        for d in dep:
            motor.mudar_estado(db, d["id"], "pronta", motivo=f"dependência #{tarefa_id} concluída")


# ======================================================================= entregas, medição, nota
def registrar_entrega(db: Banco, contrato_id: int, descricao: str, quantidade: str, unidade: str,
                      evidencias: list[str], executor: str, tarefa_id: int | None = None) -> int:
    if not evidencias:
        raise ErroNegocio("Entrega sem evidência não é registrada")
    eid = db.inserir("entrega", {"contrato_id": contrato_id, "tarefa_id": tarefa_id, "descricao": descricao,
                                 "quantidade": quantidade, "unidade": unidade, "evidencias": evidencias,
                                 "executor": executor, "situacao": "realizada", "criado_em": agora()})
    c = db.um("SELECT empresa_id FROM contrato WHERE id=?", contrato_id)
    auditoria.registrar(db, "entrega.registrada", f"Entrega #{eid}: {descricao} ({quantidade} {unidade}) — realizada, "
                        "ainda NÃO aceita", ator_tipo="agente", ator_id="fiscal-interno-de-entregas",
                        empresa_id=c["empresa_id"], contrato_id=contrato_id, objeto_tipo="entrega", objeto_id=eid,
                        dados={"evidencias": evidencias})
    return eid


def decidir_entrega(db: Banco, entrega_id: int, aceita: bool, quem: str, motivo: str = "") -> None:
    e = db.um("SELECT * FROM entrega WHERE id=?", entrega_id)
    db.atualizar("entrega", entrega_id, {"situacao": "aceita" if aceita else "rejeitada", "revisor": quem,
                                         "aceita_em": agora() if aceita else None,
                                         "motivo_rejeicao": None if aceita else motivo})
    c = db.um("SELECT empresa_id FROM contrato WHERE id=?", e["contrato_id"])
    auditoria.registrar(db, "entrega.aceita" if aceita else "entrega.rejeitada",
                        f"Entrega #{entrega_id} {'aceita' if aceita else 'rejeitada: ' + motivo} por {quem}",
                        empresa_id=c["empresa_id"], contrato_id=e["contrato_id"], objeto_tipo="entrega",
                        objeto_id=entrega_id)
    if not aceita and e["tarefa_id"]:
        motor.criar_tarefa(db, c["empresa_id"], f"Retrabalho da entrega #{entrega_id}: {motivo}", "retrabalho",
                           executor_id="coordenador-de-execucao-contratual", estado="planejada",
                           contrato_id=e["contrato_id"], idempotency_key=f"retrabalho:{entrega_id}")


def gerar_medicao(db: Banco, contrato_id: int, periodo: str) -> dict[str, Any]:
    c = db.um("SELECT * FROM contrato WHERE id=?", contrato_id)
    if not c["valor_unidade"]:
        raise ErroNegocio("Contrato sem valor por unidade: regra de medição pendente")
    entregas = db.todos("SELECT * FROM entrega WHERE contrato_id=? AND situacao='aceita' AND id NOT IN "
                        "(SELECT value FROM medicao, json_each(json_extract(medicao.itens,'$.entregas')) "
                        " WHERE medicao.contrato_id=?)", contrato_id, contrato_id)
    unidade_contrato = c["modelo_cobranca"]
    itens, nao_conv = [], []
    for e in entregas:
        if e["unidade"] != unidade_contrato:
            nao_conv.append(f"Entrega #{e['id']} em '{e['unidade']}' ≠ '{unidade_contrato}' — sem conversão automática")
            continue
        itens.append({"entrega": e["id"], "descricao": e["descricao"], "quantidade": e["quantidade"],
                      "valor": str(reais(D(e["quantidade"]) * D(c["valor_unidade"])))})
    qtd = sum((D(i["quantidade"]) for i in itens), Decimal(0))
    valor = reais(qtd * D(c["valor_unidade"]))
    mid = db.inserir("medicao", {"contrato_id": contrato_id, "periodo": periodo,
                                 "itens": {"entregas": [i["entrega"] for i in itens], "linhas": itens,
                                           "nao_convertidas": nao_conv},
                                 "quantidade_reconhecida": str(qtd), "valor_faturavel": str(valor),
                                 "situacao": "enviada", "criado_em": agora()})
    auditoria.registrar(db, "medicao.gerada", f"Medição #{mid} ({periodo}): {qtd} {unidade_contrato} = R$ {valor} "
                        "— aguardando aceite do cliente", ator_tipo="agente", ator_id="analista-de-medicao",
                        empresa_id=c["empresa_id"], contrato_id=contrato_id, objeto_tipo="medicao", objeto_id=mid)
    return {"medicao_id": mid, "quantidade": str(qtd), "valor": str(valor), "itens": itens, "alertas": nao_conv}


def decidir_medicao(db: Banco, medicao_id: int, aceita: bool, glosa: str = "0", motivo: str = "",
                    quem: str = "cliente") -> dict[str, Any]:
    m = db.um("SELECT * FROM medicao WHERE id=?", medicao_id)
    c = db.um("SELECT * FROM contrato WHERE id=?", m["contrato_id"])
    valor = reais(D(m["valor_faturavel"]) - D(glosa))
    sit = "glosada_parcial" if aceita and D(glosa) > 0 else ("aceita" if aceita else "rejeitada")
    db.atualizar("medicao", medicao_id, {"situacao": sit, "glosa": glosa, "valor_faturavel": str(valor),
                                         "aceita_em": agora() if aceita else None})
    auditoria.registrar(db, f"medicao.{sit}", f"Medição #{medicao_id} {sit} por {quem}; glosa R$ {glosa}; faturável "
                        f"R$ {valor}" + (f" — {motivo}" if motivo else ""), empresa_id=c["empresa_id"],
                        contrato_id=c["id"], objeto_tipo="medicao", objeto_id=medicao_id)
    if aceita:
        venc = (hoje() + timedelta(days=int(_j(c["regras"], {}).get("prazo_pagamento_dias", 30)))).isoformat()
        db.inserir("lancamento", {"empresa_id": c["empresa_id"], "contrato_id": c["id"], "tipo": "receber",
                                  "categoria": "medicao_aceita_a_faturar", "descricao": f"Medição #{medicao_id} {m['periodo']}",
                                  "valor": str(valor), "vencimento": venc, "situacao": "a_faturar",
                                  "origem_tipo": "medicao", "origem_id": medicao_id,
                                  "responsavel": "gestor-de-faturamento", "proxima_acao": "Preparar nota fiscal",
                                  "criado_em": agora()})
    return {"situacao": sit, "valor_faturavel": str(valor)}


def preparar_nota(db: Banco, medicao_id: int) -> dict[str, Any]:
    m = db.um("SELECT * FROM medicao WHERE id=?", medicao_id)
    if m["situacao"] not in ("aceita", "glosada_parcial"):
        raise ErroNegocio("Faturamento bloqueado: medição ainda não aceita")
    c = db.um("SELECT * FROM contrato WHERE id=?", m["contrato_id"])
    chave = f"nf:medicao:{medicao_id}"
    ex = db.um("SELECT * FROM nota_fiscal WHERE idempotency_key=?", chave)
    if ex:
        return {"nota_id": ex["id"], "ja_existia": True, "situacao": ex["situacao"]}
    regras = [RegraTributo(r["nome"], D(r["aliquota_pct"]), date.fromisoformat(r["vigencia_inicio"]),
                           date.fromisoformat(r["vigencia_fim"]) if r["vigencia_fim"] else None, r["fonte"],
                           bool(r["validado_contador"]), bool(r["retido"]), r["aplica_categoria"])
              for r in db.todos("SELECT * FROM tributo_regra WHERE empresa_id=?", c["empresa_id"])]
    trib = tributos_aplicaveis(regras, "servico", hoje())
    retidos = sum((D(i["aliquota_pct"]) for i in trib.itens if i["retido"]), Decimal(0))
    valor = D(m["valor_faturavel"])
    previa = {"tomador": c["orgao"], "contrato": c["numero"], "servico": c["objeto"][:120], "valor": str(valor),
              "tributos": trib.itens, "retencoes_valor": str(reais(valor * retidos / 100)),
              "liquido_esperado": str(reais(valor - valor * retidos / 100)), "provisorio": trib.provisorio,
              "alertas": trib.alertas}
    nid = db.inserir("nota_fiscal", {"contrato_id": c["id"], "medicao_id": medicao_id, "valor": str(valor),
                                     "tributos": previa, "situacao": "previa", "idempotency_key": chave,
                                     "criado_em": agora(), "atualizado_em": agora()})
    aid = solicitar_aprovacao(db, c["empresa_id"], "emitir_nota", "nota_fiscal", nid, 1, hash_versao(previa),
                              "agente:assistente-de-emissao-fiscal", f"Emitir NF de R$ {valor} para {c['orgao']}",
                              valor=str(valor))
    auditoria.registrar(db, "nota.previa", f"Prévia da NF #{nid} R$ {valor} preparada — aguardando aprovação #{aid}",
                        ator_tipo="agente", ator_id="assistente-de-emissao-fiscal", empresa_id=c["empresa_id"],
                        contrato_id=c["id"], objeto_tipo="nota_fiscal", objeto_id=nid)
    return {"nota_id": nid, "aprovacao_id": aid, "previa": previa, "hash": hash_versao(previa)}


def emitir_nota(db: Banco, nota_id: int, aprovacao_id: int, emissor: integracoes.EmissorFiscal) -> dict[str, Any]:
    n = db.um("SELECT * FROM nota_fiscal WHERE id=?", nota_id)
    c = db.um("SELECT * FROM contrato WHERE id=?", n["contrato_id"])
    previa = _j(n["tributos"])
    if n["situacao"] in ("emitida", "emitida_simulacao"):
        return {"situacao": n["situacao"], "numero": n["numero_oficial"], "duplicidade_evitada": True}
    aprov = db.um("SELECT * FROM aprovacao WHERE id=?", aprovacao_id)
    if not aprov or not aprov.get("consumido_em"):
        consumir_aprovacao(db, aprovacao_id, "emitir_nota", "nota_fiscal", nota_id, hash_versao(previa), "sistema:emissor")
    db.atualizar("nota_fiscal", nota_id, {"situacao": "transmitindo", "atualizado_em": agora()})
    try:
        r = motor.efeito_unico(db, n["idempotency_key"], "nota_fiscal",
                               lambda: emissor.transmitir({**previa, "idempotency_key": n["idempotency_key"]}),
                               lambda: emissor.consultar(n["idempotency_key"]))
    except RuntimeError as ex:
        db.atualizar("nota_fiscal", nota_id, {"situacao": "aguardando_integracao", "retorno": {"erro": str(ex)},
                                              "atualizado_em": agora()})
        auditoria.registrar(db, "nota.nao_transmitida", f"NF #{nota_id} NÃO emitida: {ex}", empresa_id=c["empresa_id"],
                            contrato_id=c["id"], objeto_tipo="nota_fiscal", objeto_id=nota_id)
        return {"situacao": "aguardando_integracao", "erro": str(ex)}
    if r.get("status") == "autorizada":
        sit = "emitida_simulacao" if emissor.simulado else "emitida"
        db.atualizar("nota_fiscal", nota_id, {"situacao": sit, "numero_oficial": r["numero"], "retorno": r,
                                              "atualizado_em": agora()})
        with db.tx() as cx:
            cx.execute("UPDATE lancamento SET categoria=?, situacao='aberto', proxima_acao='Acompanhar pagamento' "
                       "WHERE origem_tipo='medicao' AND origem_id=?",
                       ("faturado_simulacao" if emissor.simulado else "faturado", n["medicao_id"]))
    else:
        sit = "rejeitada"
        db.atualizar("nota_fiscal", nota_id, {"situacao": sit, "retorno": r, "atualizado_em": agora()})
        db.atualizar("efeito_externo", n["idempotency_key"], {"situacao": "rejeitado"}, chave="chave")
    auditoria.registrar(db, f"nota.{sit}", f"NF #{nota_id}: {sit} — retorno {json.dumps(r, ensure_ascii=False)[:200]}",
                        ator_tipo="agente", ator_id="assistente-de-emissao-fiscal", empresa_id=c["empresa_id"],
                        contrato_id=c["id"], objeto_tipo="nota_fiscal", objeto_id=nota_id)
    return {"situacao": sit, "retorno": r}


def liquidar(db: Banco, lancamento_id: int, usuario: dict[str, Any], data_liq: str | None = None) -> None:
    lc = db.um("SELECT * FROM lancamento WHERE id=?", lancamento_id)
    novo = "recebido" if lc["tipo"] == "receber" else "pago"
    db.atualizar("lancamento", lancamento_id, {"situacao": novo, "liquidado_em": data_liq or hoje().isoformat()})
    auditoria.registrar(db, f"financeiro.{novo}", f"Lançamento #{lancamento_id} {novo}: R$ {lc['valor']}",
                        ator_tipo="usuario", ator_id=str(usuario["id"]), empresa_id=lc["empresa_id"],
                        contrato_id=lc["contrato_id"])


# ======================================================================= painel financeiro
def painel_financeiro(db: Banco, empresa_id: int, contratos_visiveis: list[int] | None = None) -> dict[str, Any]:
    h = hoje().isoformat()
    semana = (hoje() + timedelta(days=7)).isoformat()
    lc = db.todos("SELECT l.*, c.numero contrato_numero FROM lancamento l LEFT JOIN contrato c ON c.id=l.contrato_id "
                  "WHERE l.empresa_id=? ORDER BY vencimento", empresa_id)
    if contratos_visiveis is not None:
        lc = [x for x in lc if x["contrato_id"] in contratos_visiveis]
    aberto = [x for x in lc if x["situacao"] in ("aberto", "a_faturar")]

    def soma(xs: list[dict[str, Any]]) -> str:
        return str(reais(sum((D(x["valor"]) for x in xs), Decimal(0))))

    pagar = [x for x in aberto if x["tipo"] == "pagar"]
    receber = [x for x in aberto if x["tipo"] == "receber"]
    contratos = db.todos("SELECT * FROM contrato WHERE empresa_id=?", empresa_id)
    contratada = sum((D(c["valor_total"]) for c in contratos if c["situacao"] in ("assinado", "em_execucao")), Decimal(0))
    faturado = [x for x in lc if x["tipo"] == "receber" and x["categoria"] == "faturado"]
    faturado_sim = [x for x in lc if x["tipo"] == "receber" and x["categoria"] == "faturado_simulacao"]
    recebido = [x for x in lc if x["situacao"] == "recebido"]
    medicoes = db.todos("SELECT m.*, c.numero FROM medicao m JOIN contrato c ON c.id=m.contrato_id WHERE c.empresa_id=?",
                        empresa_id)
    notas = db.todos("SELECT n.*, c.numero FROM nota_fiscal n JOIN contrato c ON c.id=n.contrato_id WHERE c.empresa_id=?",
                     empresa_id)
    entregas_nao_medidas = db.todos(
        "SELECT e.* FROM entrega e JOIN contrato c ON c.id=e.contrato_id WHERE c.empresa_id=? AND e.situacao IN "
        "('realizada','aceita') AND e.id NOT IN (SELECT value FROM medicao, json_each(json_extract(medicao.itens,"
        "'$.entregas')))", empresa_id)
    return {
        "a_pagar_hoje": [x for x in pagar if x["vencimento"] == h],
        "a_vencer_7d": [x for x in aberto if h < x["vencimento"] <= semana],
        "vencidos": [x for x in pagar if x["vencimento"] < h],
        "a_receber": receber,
        "recebimentos_atrasados": [x for x in receber if x["vencimento"] < h],
        "executado_nao_medido": entregas_nao_medidas,
        "medicoes_aguardando_aceite": [m for m in medicoes if m["situacao"] == "enviada"],
        "liberado_para_faturar": [x for x in receber if x["categoria"] == "medicao_aceita_a_faturar"],
        "notas": {s: [n for n in notas if n["situacao"] == s] for s in
                  ("previa", "aguardando_integracao", "emitida", "emitida_simulacao", "rejeitada", "cancelada")},
        "totais": {"a_pagar": soma(pagar), "a_receber": soma(receber), "receita_contratada": str(reais(contratada)),
                   "receita_faturada": soma(faturado), "faturado_apenas_em_simulacao": soma(faturado_sim),
                   "receita_recebida": soma(recebido),
                   "reserva_fornecedores": soma([x for x in pagar if x["categoria"] == "fornecedor"]),
                   "reserva_tributos": soma([x for x in pagar if x["categoria"] == "tributo"])},
        "observacao": "faturado_simulacao = nota do simulador local, sem valor fiscal",
    }


def responder_financeiro(db: Banco, empresa_id: int, pergunta: str) -> str:
    p = painel_financeiro(db, empresa_id)
    t = pergunta.lower()
    if "vence" in t:
        xs = p["a_vencer_7d"] + p["a_pagar_hoje"]
        return ("Vencimentos nos próximos 7 dias:\n" + "\n".join(
            f"- {x['vencimento']} {x['tipo']} R$ {x['valor']} — {x['descricao']} (próx.: {x['proxima_acao'] or '-'})"
            for x in xs)) if xs else "Nada vence nos próximos 7 dias nos lançamentos cadastrados."
    if "receber" in t:
        return (f"A receber: R$ {p['totais']['a_receber']} em {len(p['a_receber'])} lançamento(s); "
                f"atrasados: {len(p['recebimentos_atrasados'])}. Contratada R$ {p['totais']['receita_contratada']}, "
                f"faturada R$ {p['totais']['receita_faturada']} (+ R$ {p['totais']['faturado_apenas_em_simulacao']} só "
                f"em simulação), recebida R$ {p['totais']['receita_recebida']}.")
    if "faturar" in t:
        passos = []
        if p["executado_nao_medido"]:
            passos.append(f"{len(p['executado_nao_medido'])} entrega(s) executadas ainda sem medição → gerar medição")
        if p["medicoes_aguardando_aceite"]:
            passos.append(f"{len(p['medicoes_aguardando_aceite'])} medição(ões) aguardando aceite do cliente")
        if p["liberado_para_faturar"]:
            passos.append(f"{len(p['liberado_para_faturar'])} item(ns) liberados → preparar nota e aprovar emissão")
        if p["notas"]["aguardando_integracao"]:
            passos.append("Configurar emissor fiscal autorizado: há notas aguardando integração")
        if p["notas"]["emitida_simulacao"]:
            passos.append(f"{len(p['notas']['emitida_simulacao'])} nota(s) existem só no SIMULADOR (sem valor fiscal): "
                          "configure o emissor autorizado e emita de verdade")
        return "Para faturar:\n- " + "\n- ".join(passos) if passos else "Nada pendente para faturar."
    if "prejuízo" in t or "prejuizo" in t:
        return ("Margem realizada por contrato requer custos lançados por contrato (centro de custo). "
                "Lançamentos de custo atuais: " + str(sum(1 for x in p['a_pagar_hoje'] + p['vencidos'])) + ". "
                "Cadastre custos com contrato_id para o cálculo.")
    if "reservar" in t:
        return (f"Reserva para fornecedores: R$ {p['totais']['reserva_fornecedores']}; tributos: "
                f"R$ {p['totais']['reserva_tributos']} (com base nos lançamentos abertos cadastrados).")
    return "Pergunte: o que vence esta semana, quanto tenho a receber, o que preciso para faturar, quanto reservar."


# ======================================================================= chat
AGENTES_PRIVADOS = {"juridico", "financeiro"}


def enviar_mensagem(db: Banco, empresa_id: int, canal: str, canal_ref: str, autor: str, texto: str,
                    origem: str = "painel", id_externo: str | None = None) -> dict[str, Any]:
    if id_externo and db.um("SELECT id FROM mensagem WHERE id_externo=?", id_externo):
        return {"duplicada": True}
    privado = 0
    if canal == "agente":
        ag = db.um("SELECT departamento FROM agente WHERE id=?", canal_ref)
        if not ag:
            raise ErroNegocio("Agente inexistente")
        privado = 1 if ag["departamento"] in AGENTES_PRIVADOS else 0
    tp, _, ai = autor.partition(":")
    mid = db.inserir("mensagem", {"empresa_id": empresa_id, "canal": canal, "canal_ref": canal_ref, "autor_tipo": tp,
                                  "autor_id": ai, "texto": texto, "privado": privado, "origem": origem,
                                  "id_externo": id_externo, "criado_em": agora()})
    alvos = [canal_ref] if canal == "agente" else re.findall(r"@([a-z0-9-]+)", texto)
    respostas = []
    for alvo in alvos:
        if db.um("SELECT id FROM agente WHERE id=?", alvo):
            resp = responder_agente(db, empresa_id, alvo, texto)
            rid = db.inserir("mensagem", {"empresa_id": empresa_id, "canal": canal, "canal_ref": canal_ref,
                                          "autor_tipo": "agente", "autor_id": alvo, "texto": resp, "privado": privado,
                                          "origem": "sistema", "criado_em": agora()})
            auditoria.registrar(db, "chat.resposta", f"{alvo} respondeu no canal {canal}:{canal_ref}"
                                + (" (conteúdo privado não replicado)" if privado else f": {resp[:120]}"),
                                ator_tipo="agente", ator_id=alvo, empresa_id=empresa_id)
            respostas.append({"id": rid, "agente": alvo, "texto": resp})
    return {"id": mid, "respostas": respostas, "privado": bool(privado)}


def responder_agente(db: Banco, empresa_id: int, agente_id: str, texto: str) -> str:
    """Respostas determinísticas baseadas em dados. Com IA configurada, o texto é enriquecido
    pelo modelo, mas os números continuam vindo daqui."""
    ag = db.um("SELECT * FROM agente WHERE id=?", agente_id)
    dep = ag["departamento"]
    t = texto.lower()
    base: str
    if dep == "financeiro":
        base = responder_financeiro(db, empresa_id, texto)
    elif agente_id == "auditor-de-execucao" or "prove" in t or "evidência" in t:
        m = re.search(r"#(\d+)", texto)
        if not m:
            base = "Informe a tarefa (ex.: 'prove a tarefa #12')."
        else:
            tid = int(m.group(1))
            tf = db.um("SELECT * FROM tarefa WHERE id=? AND empresa_id=?", tid, empresa_id)
            if not tf:
                base = f"Tarefa #{tid} não encontrada."
            else:
                ex = db.todos("SELECT id, comando, codigo_saida, sha256_saida, fim FROM execucao_ferramenta WHERE tarefa_id=?",
                              tid)
                base = (f"Tarefa #{tid} '{tf['titulo']}' está '{tf['estado']}'. Evidências: "
                        + ("; ".join(f"execução #{e['id']} `{e['comando']}` código {e['codigo_saida']} "
                                     f"sha256 {e['sha256_saida'][:12]}… em {e['fim']}" for e in ex)
                           if ex else "NENHUMA evidência de ferramenta registrada.")
                        + (f" Revisor: {tf['revisor']}." if tf["revisor"] else " Sem revisão registrada."))
    elif agente_id == "gerente-de-projeto" or "atrasad" in t:
        xs = db.todos("SELECT id, titulo, estado, prazo FROM tarefa WHERE empresa_id=? AND prazo IS NOT NULL AND "
                      "prazo < ? AND estado NOT IN ('concluida','cancelada')", empresa_id, agora())
        bloq = db.todos("SELECT id, titulo, erro FROM tarefa WHERE empresa_id=? AND estado='bloqueada'", empresa_id)
        base = (f"Atrasadas: {len(xs)}" + "".join(f"\n- #{x['id']} {x['titulo']} ({x['estado']})" for x in xs)
                + f"\nBloqueadas: {len(bloq)}" + "".join(f"\n- #{b['id']} {b['titulo']}: {b['erro']}" for b in bloq))
    elif dep in ("engenharia", "infra"):
        ex = db.todos("SELECT e.id, e.comando, e.codigo_saida, e.fim, t.titulo FROM execucao_ferramenta e JOIN tarefa t "
                      "ON t.id=e.tarefa_id WHERE t.empresa_id=? ORDER BY e.id DESC LIMIT 5", empresa_id)
        base = "Últimas execuções reais:\n" + ("\n".join(
            f"- #{e['id']} {e['titulo']}: `{e['comando']}` → {e['codigo_saida']} ({e['fim']})" for e in ex)
            if ex else "nenhuma execução registrada ainda.")
    elif dep == "juridico":
        termo = re.sub(r"(?i)(jur[íi]dico|explique|esta|a cl[áa]usula|cl[áa]usula|[,.?:!])", " ", texto).split()
        termo = max(termo, key=len) if termo else ""
        achados = db.todos("SELECT d.titulo, p.pagina, p.texto FROM documento_pagina p JOIN documento d ON "
                           "d.id=p.documento_id WHERE d.empresa_id=? AND p.texto LIKE ? LIMIT 3", empresa_id, f"%{termo}%")
        base = ("Trechos localizados (para revisão do advogado responsável):\n" + "\n".join(
            f"- {a['titulo']} p.{a['pagina']}: …{_janela(a['texto'], termo)}…" for a in achados)
            if achados and termo else "Não localizei a cláusula nos documentos importados.")
        base += "\nObservação: sou assistente, não advogado; não há sigilo profissional nesta conversa."
    else:
        tarefas = db.todos("SELECT id, titulo, estado FROM tarefa WHERE executor_id=? ORDER BY id DESC LIMIT 5", agente_id)
        base = (f"{ag['nome']} — {ag['missao']}. Implementação: {ag['implementacao']}. Minhas tarefas: "
                + (", ".join(f"#{x['id']} {x['estado']}" for x in tarefas) or "nenhuma"))
    ia = integracoes.IA()
    if ia.disponivel and ag["implementacao"] != "deterministico":
        try:
            r = ia.responder(f"Você é o agente '{ag['nome']}' ({ag['missao']}). Limites: {ag['limites']}. "
                             "Use apenas os dados fornecidos; números vêm do sistema.", texto, base)
            return r["texto"] + f"\n\n[dados do sistema]\n{base}"
        except Exception as ex:
            return base + f"\n[IA indisponível: {type(ex).__name__}]"
    return base + ("" if ag["implementacao"] == "deterministico" else
                   "\n[IA não conectada: resposta apenas com dados do sistema]")


def _janela(texto: str, termo: str) -> str:
    i = texto.lower().find(termo.lower())
    return re.sub(r"\s+", " ", texto[max(0, i - 120): i + 280])


def mensagem_para_tarefa(db: Banco, mensagem_id: int, executor: str, usuario: dict[str, Any]) -> dict[str, Any]:
    m = db.um("SELECT * FROM mensagem WHERE id=?", mensagem_id)
    transferido = {"texto": m["texto"], "canal": f"{m['canal']}:{m['canal_ref']}"}
    if m["privado"]:
        transferido = {"texto": m["texto"][:200], "aviso": "conteúdo de conversa privada transferido por decisão do usuário"}
    tid = motor.criar_tarefa(db, usuario["empresa_id"], m["texto"][:120], "solicitacao_chat", executor_id=executor,
                             estado="planejada", parametros={"origem_mensagem": mensagem_id, **transferido})
    return {"tarefa_id": tid, "informacao_transferida": transferido}


# ======================================================================= WhatsApp
def processar_whatsapp(db: Banco, payload: dict[str, Any]) -> list[dict[str, Any]]:
    saida = []
    for m in integracoes.extrair_mensagens_whatsapp(payload):
        u = db.um("SELECT * FROM usuario WHERE telefone_whatsapp=? AND ativo=1", m["de"])
        if not u:
            auditoria.registrar(db, "seguranca.whatsapp_desconhecido", f"Mensagem de número não cadastrado ignorada "
                                f"(final {m['de'][-4:]})")
            saida.append({"id": m["id"], "ignorada": "remetente não autorizado"})
            continue
        if db.um("SELECT id FROM mensagem WHERE id_externo=?", m["id"]):
            saida.append({"id": m["id"], "duplicada": True})
            continue
        texto = m["texto"].strip()
        resp: str
        if re.fullmatch(r"(?i)(sim|ok|aprovo|aprovado|pode)\.?", texto):
            resp = ("Não aprovo ações por mensagem curta. Abra o painel autenticado em Aprovações e confirme a versão.")
        elif re.search(r"(?i)(não consegue|erro|falha|fora do ar|parou|bug)", texto):
            r = abrir_chamado(db, u["empresa_id"], texto, "whatsapp", f"usuario:{u['id']}")
            resp = f"Chamado #{r['chamado_id']} aberto (severidade {r['severidade']})." + (
                " Preciso de: " + ", ".join(r["faltando"]) if r["faltando"] else "")
        elif re.search(r"(?i)(vence|receber|faturar|reservar)", texto):
            resp = responder_financeiro(db, u["empresa_id"], texto)
        else:
            resp = "Recebido. Comandos: descreva um problema para abrir chamado; pergunte 'o que vence esta semana'."
        enviar_mensagem(db, u["empresa_id"], "executivo", "whatsapp", f"usuario:{u['id']}", texto, origem="whatsapp",
                        id_externo=m["id"])
        db.inserir("mensagem", {"empresa_id": u["empresa_id"], "canal": "executivo", "canal_ref": "whatsapp",
                                "autor_tipo": "agente", "autor_id": "atendente-via-whatsapp", "texto": resp,
                                "origem": "sistema", "criado_em": agora()})
        motor.criar_tarefa(db, u["empresa_id"], f"Responder WhatsApp {m['id'][-8:]}", "enviar_whatsapp",
                           executor_id="atendente-via-whatsapp", idempotency_key=f"wa-resp:{m['id']}",
                           parametros={"para": m["de"], "texto": resp, "chave": f"wa-resp:{m['id']}"})
        saida.append({"id": m["id"], "resposta": resp})
    return saida


@motor.handler("enviar_whatsapp")
def _h_whatsapp(db: Banco, t: dict[str, Any]) -> dict[str, Any]:
    p = _j(t["parametros"], {})
    w = integracoes.WhatsApp()
    if not w.configurado:
        raise motor.Bloqueio("WhatsApp não configurado (" + ", ".join(w.faltando()) + "). Resposta disponível no painel.")
    r = motor.efeito_unico(db, p["chave"], "whatsapp", lambda: w.enviar(p["para"], p["texto"]),
                           lambda: None, tarefa_id=t["id"])
    return {"resumo": "mensagem enviada", "evidencias": [f"whatsapp:{json.dumps(r)[:200]}"], "_proximo_estado": "em_revisao"}


# ======================================================================= reuniões
def registrar_ata(db: Banco, empresa_id: int, texto: str, contrato_id: int | None = None) -> dict[str, Any]:
    itens: dict[str, list[str]] = {"decisoes": [], "propostas": [], "pendencias": [], "mudancas_escopo": []}
    for ln in texto.splitlines():
        s = ln.strip("-• \t")
        lo = s.lower()
        if lo.startswith(("decidido", "decisão", "decisao", "aprovado em reunião")):
            itens["decisoes"].append(s)
        elif lo.startswith(("proposta", "sugestão", "sugestao", "sugerido")):
            itens["propostas"].append(s)
        elif lo.startswith(("pendente", "a definir", "verificar")):
            itens["pendencias"].append(s)
        if re.search(r"(?i)(incluir|novo m[óo]dulo|nova funcionalidade|ampliar escopo|adicionar)", s):
            itens["mudancas_escopo"].append(s)
    tarefas = []
    for x in itens["decisoes"] + itens["propostas"] + itens["mudancas_escopo"]:
        tarefas.append(motor.criar_tarefa(
            db, empresa_id, f"Avaliar viabilidade: {x[:100]}", "avaliacao_reuniao", executor_id="gerente-de-projeto",
            estado="planejada", contrato_id=contrato_id, idempotency_key=f"ata:{hashlib.sha1(x.encode()).hexdigest()}"))  # noqa: S324
    auditoria.registrar(db, "reuniao.registrada", f"Ata registrada: {len(itens['decisoes'])} decisões, "
                        f"{len(itens['propostas'])} propostas, {len(itens['mudancas_escopo'])} possíveis mudanças de "
                        "escopo — nada executa sem aprovação", ator_tipo="agente", ator_id="secretario-de-reunioes",
                        empresa_id=empresa_id, contrato_id=contrato_id)
    return {**itens, "tarefas_de_avaliacao": tarefas,
            "aviso": "Sugestões de reunião não são autorização: cada item gera avaliação e depois pedido de aprovação."}


# ======================================================================= relatório diário
def relatorio_diario(db: Banco, empresa_id: int) -> dict[str, Any]:
    desde = (datetime.now(UTC) - timedelta(hours=24)).isoformat(timespec="seconds")

    def n(sql: str, *p: Any) -> int:
        return int(db.um(sql, *p)["n"])

    fin = painel_financeiro(db, empresa_id)
    ex = db.todos("SELECT e.comando, e.codigo_saida FROM execucao_ferramenta e JOIN tarefa t ON t.id=e.tarefa_id "
                  "WHERE t.empresa_id=? AND e.inicio>=?", empresa_id, desde)
    conteudo = {
        "gerado_em": agora(), "janela_desde": desde,
        "oportunidades_novas": n("SELECT COUNT(*) n FROM oportunidade WHERE empresa_id=? AND consultado_em>=?", empresa_id, desde),
        "editais_analisados": n("SELECT COUNT(DISTINCT oportunidade_id) n FROM evento WHERE empresa_id=? AND "
                                "tipo='analise.concluida' AND criado_em>=?", empresa_id, desde),
        "recomendacoes": db.todos("SELECT o.id, o.objeto, json_extract(a.resultado,'$.recomendacao') recomendacao FROM "
                                  "analise a JOIN oportunidade o ON o.id=a.oportunidade_id WHERE o.empresa_id=? AND "
                                  "a.criado_em>=?", empresa_id, desde),
        "pendencias_documentais": db.todos("SELECT id, titulo FROM tarefa WHERE empresa_id=? AND tipo='pendencia_documental' "
                                           "AND estado NOT IN ('concluida','cancelada')", empresa_id),
        "prazos_proximos": db.todos("SELECT id, objeto, data_abertura FROM oportunidade WHERE empresa_id=? AND "
                                    "data_abertura BETWEEN ? AND ?", empresa_id, agora(),
                                    (datetime.now(UTC) + timedelta(days=7)).isoformat()),
        "contratos_em_execucao": db.todos("SELECT id, numero, objeto FROM contrato WHERE empresa_id=? AND "
                                          "situacao='em_execucao'", empresa_id),
        "entregas_aceitas_24h": n("SELECT COUNT(*) n FROM entrega e JOIN contrato c ON c.id=e.contrato_id WHERE "
                                  "c.empresa_id=? AND e.aceita_em>=?", empresa_id, desde),
        "chamados_abertos": db.todos("SELECT id, descricao, severidade, situacao FROM chamado WHERE empresa_id=? AND "
                                     "situacao!='fechado'", empresa_id),
        "execucoes_de_teste_24h": {"total": len(ex), "sucesso": sum(1 for e in ex if e["codigo_saida"] == 0),
                                   "falha": sum(1 for e in ex if e["codigo_saida"] != 0)},
        "financeiro": fin["totais"], "notas_pendentes": len(fin["notas"]["previa"]) + len(fin["notas"]["aguardando_integracao"]),
        "custo_ia": db.um("SELECT COALESCE(SUM(CAST(custo AS REAL)),0) n FROM tarefa WHERE empresa_id=?", empresa_id)["n"],
        "bloqueios": db.todos("SELECT id, titulo, erro FROM tarefa WHERE empresa_id=? AND estado='bloqueada'", empresa_id),
        "decisoes_necessarias": db.todos("SELECT id, acao, resumo, valor FROM aprovacao WHERE empresa_id=? AND "
                                         "situacao='pendente'", empresa_id),
        "integridade_auditoria": auditoria.verificar_cadeia(db),
        "proximo_dia": db.todos("SELECT id, titulo, executor_id FROM tarefa WHERE empresa_id=? AND estado IN "
                                "('pronta','planejada') ORDER BY id LIMIT 15", empresa_id),
        "limitacoes": [i["nome"] + ": " + i["situacao"] for i in integracoes.situacao_integracoes(db)
                       if i["situacao"] not in ("conectado", "ativo")],
    }
    rid = db.inserir("relatorio", {"empresa_id": empresa_id, "data": hoje().isoformat(), "conteudo": conteudo,
                                   "criado_em": agora()})
    auditoria.registrar(db, "relatorio.gerado", f"Relatório diário #{rid} gerado", ator_tipo="agente",
                        ator_id="gerador-de-relatorios-diarios", empresa_id=empresa_id, objeto_tipo="relatorio",
                        objeto_id=rid)
    return {"id": rid, **conteudo}


@motor.handler("relatorio_diario")
def _h_relatorio(db: Banco, t: dict[str, Any]) -> dict[str, Any]:
    r = relatorio_diario(db, t["empresa_id"])
    return {"resumo": f"relatório #{r['id']}", "evidencias": [f"relatorio:{r['id']}"], "_proximo_estado": "em_revisao"}


@motor.handler("verificar_prazos")
def _h_prazos(db: Banco, t: dict[str, Any]) -> dict[str, Any]:
    alertas = []
    lim = (hoje() + timedelta(days=15)).isoformat()
    for d in db.todos("SELECT id, titulo, validade FROM documento WHERE empresa_id=? AND validade IS NOT NULL AND "
                      "validade <= ? AND oportunidade_id IS NULL", t["empresa_id"], lim):
        alertas.append(f"Documento #{d['id']} {d['titulo']} vence/venceu em {d['validade']}")
    for o in db.todos("SELECT id, objeto, data_abertura, fuso_sessao FROM oportunidade WHERE empresa_id=? AND "
                      "data_abertura BETWEEN ? AND ?", t["empresa_id"], agora(), lim):
        alertas.append(f"Sessão da oportunidade #{o['id']} em {o['data_abertura']} ({o['fuso_sessao']})")
    for a in alertas:
        auditoria.registrar(db, "alerta.prazo", a, ator_tipo="agente", ator_id="monitor-de-prazos-e-sessoes",
                            empresa_id=t["empresa_id"])
    return {"resumo": f"{len(alertas)} alerta(s)", "alertas": alertas, "evidencias": ["evento:alerta.prazo"],
            "_proximo_estado": "em_revisao"}


def exportar(db: Banco, empresa_id: int) -> dict[str, Any]:
    diretas = ["servico", "funcionario", "fornecedor", "oportunidade", "cotacao", "aprovacao", "contrato", "chamado",
               "tarefa", "lancamento", "relatorio"]
    por_op = ["requisito", "conformidade", "analise"]
    por_contrato = ["obrigacao", "projeto", "entrega", "medicao", "nota_fiscal"]
    out: dict[str, Any] = {"empresa": db.todos("SELECT * FROM empresa WHERE id=?", empresa_id)}
    for tb in diretas:
        out[tb] = db.todos(f"SELECT * FROM {tb} WHERE empresa_id=?", empresa_id)  # noqa: S608
    for tb in por_op:
        out[tb] = db.todos(f"SELECT x.* FROM {tb} x JOIN oportunidade o ON o.id=x.oportunidade_id "  # noqa: S608
                           "WHERE o.empresa_id=?", empresa_id)
    for tb in por_contrato:
        out[tb] = db.todos(f"SELECT x.* FROM {tb} x JOIN contrato c ON c.id=x.contrato_id "  # noqa: S608
                           "WHERE c.empresa_id=?", empresa_id)
    out["documentos"] = db.todos("SELECT id, titulo, tipo, sha256, versao, validade, criado_em FROM documento "
                                 "WHERE empresa_id=?", empresa_id)
    return out
