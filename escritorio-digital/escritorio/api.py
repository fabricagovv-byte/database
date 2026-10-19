"""API HTTP do escritório digital."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import auditoria, integracoes, motor
from . import servicos as sv
from .db import Banco
from .dominio.regras import AprovacaoInvalida, TransicaoInvalida

WEB = Path(__file__).parent / "web"


def criar_app(db: Banco, iniciar_worker: bool = True) -> FastAPI:
    app = FastAPI(title="Escritório Digital", docs_url="/api/docs", openapi_url="/api/openapi.json")
    sv.inicializar(db)
    worker = motor.Worker(db) if iniciar_worker else None
    app.state.db = db
    app.state.emissor = integracoes.emissor_configurado()

    @app.on_event("startup")
    def _ini() -> None:
        if worker:
            worker.start()

    @app.on_event("shutdown")
    def _fim() -> None:
        if worker:
            worker.parar.set()

    @app.middleware("http")
    async def cabecalhos(request: Request, call_next: Any) -> Response:
        resp: Response = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; style-src 'self' "
                                                   "'unsafe-inline'; script-src 'self'; connect-src 'self'")
        return resp

    @app.exception_handler(sv.ErroNegocio)
    async def _erro_neg(_: Request, ex: sv.ErroNegocio) -> JSONResponse:
        return JSONResponse({"erro": str(ex)}, status_code=422)

    @app.exception_handler(PermissionError)
    async def _erro_perm(_: Request, ex: PermissionError) -> JSONResponse:
        return JSONResponse({"erro": str(ex)}, status_code=403)

    @app.exception_handler(TransicaoInvalida)
    async def _erro_tr(_: Request, ex: TransicaoInvalida) -> JSONResponse:
        return JSONResponse({"erro": str(ex)}, status_code=409)

    def usuario(request: Request) -> dict[str, Any]:
        tok = request.cookies.get("sessao") or request.headers.get("authorization", "").removeprefix("Bearer ")
        u = sv.usuario_por_token(db, tok) if tok else None
        if not u:
            raise HTTPException(401, "Não autenticado")
        return u

    def admin(u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        if u["papel"] != "admin":
            raise HTTPException(403, "Somente administrador")
        return u

    def contratos_visiveis(u: dict[str, Any]) -> list[int] | None:
        if u["papel"] == "admin":
            return None
        return [a["objeto_id"] for a in db.todos("SELECT objeto_id FROM acesso WHERE usuario_id=? AND objeto_tipo='contrato'",
                                                 u["id"])]

    def checar(u: dict[str, Any], tipo: str, oid: int | None) -> None:
        if oid is not None and not sv.pode_ver(db, u, tipo, oid):
            auditoria.registrar(db, "seguranca.acesso_negado", f"{u['nome']} tentou acessar {tipo} #{oid}",
                                ator_tipo="usuario", ator_id=str(u["id"]), empresa_id=u["empresa_id"])
            raise HTTPException(403, "Sem permissão para este objeto")

    # ------------------------------------------------------------ autenticação
    @app.post("/api/login")
    async def login(request: Request) -> Response:
        d = await request.json()
        tok = sv.login(db, d["email"], d["senha"])
        r = JSONResponse({"ok": True})
        r.set_cookie("sessao", tok, httponly=True, samesite="strict", secure=os.getenv("ESCRITORIO_HTTPS") == "1",
                     max_age=12 * 3600)
        return r

    @app.post("/api/logout")
    def logout() -> Response:
        r = JSONResponse({"ok": True})
        r.delete_cookie("sessao")
        return r

    @app.get("/api/eu")
    def eu(u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        emp = db.um("SELECT * FROM empresa WHERE id=?", u["empresa_id"])
        return {"usuario": {k: u[k] for k in ("id", "nome", "email", "papel")}, "empresa": emp}

    @app.get("/health")
    def health() -> dict[str, Any]:
        db.um("SELECT 1 x")
        w = db.um("SELECT * FROM integracao WHERE nome='worker'")
        return {"status": "ok", "worker": w["situacao"] if w else "desconhecido", "agora": datetime.now(UTC).isoformat()}

    # ------------------------------------------------------------ visão executiva / escritório ao vivo
    @app.get("/api/painel")
    def painel(u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        e = u["empresa_id"]
        cv = contratos_visiveis(u)
        fin = sv.painel_financeiro(db, e, cv)
        return {
            "aprovacoes_pendentes": db.todos("SELECT * FROM aprovacao WHERE empresa_id=? AND situacao='pendente' "
                                             "ORDER BY id DESC", e) if u["papel"] == "admin" else [],
            "tarefas": {r["estado"]: r["n"] for r in db.todos(
                "SELECT estado, COUNT(*) n FROM tarefa WHERE empresa_id=? GROUP BY estado", e)},
            "bloqueios": db.todos("SELECT id, titulo, erro, executor_id FROM tarefa WHERE empresa_id=? AND "
                                  "estado IN ('bloqueada','falhou') ORDER BY id DESC LIMIT 20", e),
            "oportunidades": db.todos("SELECT id, objeto, situacao, aderencia, data_abertura FROM oportunidade WHERE "
                                      "empresa_id=? ORDER BY id DESC LIMIT 10", e) if u["papel"] == "admin" else [],
            "contratos": [c for c in db.todos("SELECT id, numero, objeto, situacao, valor_total FROM contrato WHERE "
                                              "empresa_id=?", e) if cv is None or c["id"] in cv],
            "financeiro": fin["totais"],
            "integracoes": integracoes.situacao_integracoes(db),
            "proximo_passo": _proximo_passo(e, u),
        }

    def _proximo_passo(e: int, u: dict[str, Any]) -> list[str]:
        p = []
        if not db.um("SELECT id FROM servico WHERE empresa_id=?", e):
            p.append("Cadastre seus serviços (Meus serviços) para a busca de editais funcionar")
        n = db.um("SELECT COUNT(*) n FROM aprovacao WHERE empresa_id=? AND situacao='pendente'", e)["n"]
        if n and u["papel"] == "admin":
            p.append(f"Você tem {n} aprovação(ões) aguardando decisão")
        h = db.um("SELECT COUNT(*) n FROM tarefa WHERE empresa_id=? AND executor_tipo='humano' AND "
                  "estado NOT IN ('concluida','cancelada')", e)["n"]
        if h and u["papel"] == "admin":
            p.append(f"{h} pendência(s) atribuída(s) a você (documentos a sanar) — veja no Escritório ao vivo")
        b = db.um("SELECT COUNT(*) n FROM tarefa WHERE empresa_id=? AND estado='bloqueada'", e)["n"]
        if b:
            p.append(f"{b} tarefa(s) bloqueadas aguardando dado ou integração")
        return p or ["Sem pendências imediatas"]

    @app.get("/api/escritorio")
    def escritorio(u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        agora_dt = datetime.now(UTC)
        ags = db.todos("SELECT a.id, a.nome, a.departamento, a.estado, a.ativo, a.implementacao, a.custo_acumulado, "
                       "t.id tarefa_id, t.titulo tarefa, t.estado tarefa_estado, t.atualizado_em, t.contrato_id, "
                       "e.resumo ultimo_evento, e.criado_em ultimo_evento_em FROM agente a "
                       "LEFT JOIN tarefa t ON t.id=a.tarefa_atual_id LEFT JOIN evento e ON e.id=a.ultimo_evento_id "
                       "ORDER BY a.numero")
        cv = contratos_visiveis(u)
        for a in ags:
            if not a["ativo"]:
                a["estado"] = "offline"
            if cv is not None and a["contrato_id"] and a["contrato_id"] not in cv:
                a["tarefa"], a["ultimo_evento"] = "(contrato sem permissão)", None
            if a["atualizado_em"] and a["estado"] == "trabalhando":
                a["decorrido_s"] = int((agora_dt - datetime.fromisoformat(a["atualizado_em"])).total_seconds())
            prox = db.um("SELECT id, titulo, depende_de FROM tarefa WHERE executor_id=? AND estado IN "
                         "('pronta','planejada') ORDER BY id LIMIT 1", a["id"])
            a["proxima"] = prox
        squads = db.todos("SELECT * FROM squad WHERE empresa_id=?", u["empresa_id"])
        for s in squads:
            s["membros"] = [m["membro_id"] for m in db.todos("SELECT membro_id FROM squad_membro WHERE squad_id=?", s["id"])]
        pessoas = db.todos("SELECT id, nome, funcao, situacao, horas_mes, horas_alocadas FROM funcionario WHERE "
                           "empresa_id=?", u["empresa_id"])
        for p in pessoas:
            p["tarefas_abertas"] = db.todos("SELECT id, titulo, estado FROM tarefa WHERE executor_tipo='humano' AND "
                                            "executor_id=? AND estado NOT IN ('concluida','cancelada')", str(p["id"]))
        humano_adm = db.todos("SELECT id, titulo, estado FROM tarefa WHERE executor_tipo='humano' AND executor_id='arthur' "
                              "AND estado NOT IN ('concluida','cancelada') AND empresa_id=?", u["empresa_id"])
        return {"agentes": ags, "squads": squads, "pessoas": pessoas, "administrador": humano_adm,
                "nota": "Estados vêm exclusivamente de tarefas e eventos registrados; nada é animado artificialmente."}

    @app.get("/api/eventos")
    def eventos(depois: int = 0, limite: int = 100, u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        return _filtrar_eventos(u, db.todos("SELECT id, tipo, ator_tipo, ator_id, objeto_tipo, objeto_id, resumo, "
                                            "contrato_id, criado_em, hash FROM evento WHERE id>? AND (empresa_id=? OR "
                                            "empresa_id IS NULL) ORDER BY id DESC LIMIT ?", depois, u["empresa_id"],
                                            min(limite, 500)))

    def _filtrar_eventos(u: dict[str, Any], evs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        if cv is None:
            return evs
        return [e for e in evs if e["contrato_id"] in cv]

    @app.get("/api/eventos/stream")
    async def stream(request: Request, depois: int = 0, u: dict[str, Any] = Depends(usuario)) -> StreamingResponse:
        async def gerar() -> AsyncIterator[str]:
            ultimo = depois or (db.um("SELECT COALESCE(MAX(id),0) m FROM evento")["m"])
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                novos = db.todos("SELECT id, tipo, ator_tipo, ator_id, resumo, contrato_id, criado_em FROM evento "
                                 "WHERE id>? AND (empresa_id=? OR empresa_id IS NULL) ORDER BY id LIMIT 200",
                                 ultimo, u["empresa_id"])
                for e in _filtrar_eventos(u, novos):
                    yield f"id: {e['id']}\nevent: evento\ndata: {json.dumps(e, ensure_ascii=False)}\n\n"
                if novos:
                    ultimo = novos[-1]["id"]
                else:
                    yield ": keepalive\n\n"
                await asyncio.sleep(1)
        return StreamingResponse(gerar(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    # ------------------------------------------------------------ agentes / squads
    @app.get("/api/agentes")
    def agentes(_: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        return db.todos("SELECT * FROM agente ORDER BY numero")

    @app.patch("/api/agentes/{aid}")
    async def ajustar_agente(aid: str, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        permitidos = {k: d[k] for k in ("ativo", "limite_custo", "limite_minutos", "missao", "revisor") if k in d}
        a = db.um("SELECT versao_config FROM agente WHERE id=?", aid)
        db.atualizar("agente", aid, {**permitidos, "versao_config": a["versao_config"] + 1})
        auditoria.registrar(db, "agente.configurado", f"Agente {aid} ajustado: {permitidos}", ator_tipo="usuario",
                            ator_id=str(u["id"]), empresa_id=u["empresa_id"], objeto_tipo="agente", objeto_id=aid)
        return {"ok": True}

    @app.get("/api/squads")
    def squads(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        s = db.todos("SELECT * FROM squad WHERE empresa_id=?", u["empresa_id"])
        cv = contratos_visiveis(u)
        s = [x for x in s if cv is None or x["contrato_id"] in cv]
        for x in s:
            x["membros"] = db.todos("SELECT m.*, a.nome, a.implementacao, a.estado FROM squad_membro m LEFT JOIN agente a "
                                    "ON a.id=m.membro_id WHERE squad_id=?", x["id"])
        return s

    # ------------------------------------------------------------ cadastros
    for tabela in ("servico", "funcionario", "fornecedor", "tributo_regra"):
        def _fab(tb: str) -> None:
            @app.get(f"/api/{tb}s", name=f"listar_{tb}")
            def listar(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
                return db.todos(f"SELECT * FROM {tb} WHERE empresa_id=? ORDER BY id DESC", u["empresa_id"])  # noqa: S608

            @app.post(f"/api/{tb}s", name=f"criar_{tb}")
            async def criar(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
                return {"id": sv.cadastrar(db, tb, u["empresa_id"], await request.json(), str(u["id"]))}
        _fab(tabela)

    @app.put("/api/empresa")
    async def atualizar_empresa(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        campos = {k: d[k] for k in ("razao_social", "nome_fantasia", "regime_tributario", "margem_minima_pct",
                                    "capital_giro_disponivel", "risco_maximo", "regioes", "cnaes", "hora_relatorio") if k in d}
        db.atualizar("empresa", u["empresa_id"], {**campos, "atualizado_em": sv.agora(), "responsavel": str(u["id"])})
        auditoria.registrar(db, "empresa.atualizada", f"Cadastro da empresa atualizado: {list(campos)}",
                            ator_tipo="usuario", ator_id=str(u["id"]), empresa_id=u["empresa_id"])
        return {"ok": True}

    # ------------------------------------------------------------ documentos
    @app.post("/api/documentos")
    async def enviar_documento(arquivo: UploadFile = File(...), tipo: str | None = Form(None),
                               validade: str | None = Form(None), oportunidade_id: int | None = Form(None),
                               contrato_id: int | None = Form(None), u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        checar(u, "oportunidade", oportunidade_id)
        checar(u, "contrato", contrato_id)
        conteudo = await arquivo.read()
        if len(conteudo) > 60 * 1024 * 1024:
            raise HTTPException(413, "Arquivo acima de 60 MB")
        return sv.importar_documento(db, u["empresa_id"], conteudo, arquivo.filename or "arquivo", str(u["id"]),
                                     oportunidade_id=oportunidade_id, contrato_id=contrato_id, tipo=tipo or None,
                                     validade=validade or None)

    @app.get("/api/documentos")
    def listar_docs(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        docs = db.todos("SELECT id, titulo, tipo, tipo_confianca, paginas, leitura, validade, versao, validacao, "
                        "oportunidade_id, contrato_id, sha256, criado_em FROM documento WHERE empresa_id=? ORDER BY id DESC",
                        u["empresa_id"])
        cv = contratos_visiveis(u)
        return [d for d in docs if cv is None or (d["contrato_id"] in cv)]

    @app.post("/api/documentos/{did}/validar")
    def validar_doc(did: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        db.atualizar("documento", did, {"validacao": "validado"})
        auditoria.registrar(db, "documento.validado", f"Documento #{did} validado por {u['nome']}", ator_tipo="usuario",
                            ator_id=str(u["id"]), empresa_id=u["empresa_id"], objeto_tipo="documento", objeto_id=did)
        return {"ok": True}

    # ------------------------------------------------------------ licitações
    @app.get("/api/oportunidades")
    def listar_ops(u: dict[str, Any] = Depends(admin)) -> list[dict[str, Any]]:
        return db.todos("SELECT * FROM oportunidade WHERE empresa_id=? ORDER BY id DESC", u["empresa_id"])

    @app.post("/api/oportunidades")
    async def criar_op(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return {"id": sv.criar_oportunidade(db, u["empresa_id"], await request.json(), f"usuario:{u['id']}")}

    @app.post("/api/oportunidades/buscar-pncp")
    async def buscar(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json() if (await request.body()) else {}
        try:
            return sv.buscar_pncp(db, u["empresa_id"], int(d.get("dias", 3)), d.get("uf"), int(d.get("paginas", 2)),
                                  int(d.get("aderencia_minima", 30)))
        except ConnectionError as ex:
            raise HTTPException(503, str(ex)) from ex

    @app.get("/api/oportunidades/{oid}")
    def ver_op(oid: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        checar(u, "oportunidade", oid)
        return {
            "oportunidade": db.um("SELECT * FROM oportunidade WHERE id=?", oid),
            "documentos": db.todos("SELECT id, titulo, tipo, paginas, leitura, versao, paginas_sem_texto FROM documento "
                                   "WHERE oportunidade_id=?", oid),
            "matriz": db.todos("SELECT c.*, r.descricao requisito, r.categoria, r.pagina, r.trecho, r.documento_id FROM "
                               "conformidade c JOIN requisito r ON r.id=c.requisito_id WHERE c.oportunidade_id=?", oid),
            "cotacoes": db.todos("SELECT c.*, f.nome fornecedor FROM cotacao c JOIN fornecedor f ON f.id=c.fornecedor_id "
                                 "WHERE oportunidade_id=?", oid),
            "analises": db.todos("SELECT * FROM analise WHERE oportunidade_id=? ORDER BY versao DESC", oid),
        }

    @app.post("/api/oportunidades/{oid}/baixar-pncp")
    def baixar_pncp(oid: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        checar(u, "oportunidade", oid)
        return {"tarefa_id": sv.agendar_download_pncp(db, oid, str(u["id"])),
                "aviso": "Download e leitura em andamento pelo worker; acompanhe no Escritório ao vivo."}

    @app.post("/api/oportunidades/{oid}/analisar")
    def analisar(oid: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        checar(u, "oportunidade", oid)
        return sv.analisar_oportunidade(db, oid)

    @app.post("/api/oportunidades/{oid}/viabilidade")
    async def viabilidade(oid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return sv.calcular_viabilidade(db, oid, await request.json())

    @app.post("/api/analises/{aid}/solicitar-aprovacao")
    def solicitar(aid: int, _: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return {"aprovacao_id": sv.solicitar_participacao(db, aid)}

    @app.post("/api/oportunidades/{oid}/proposta-enviada")
    async def proposta_enviada(oid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        try:
            sv.registrar_proposta_enviada(db, int(d["analise_id"]), int(d["aprovacao_id"]), u)
        except AprovacaoInvalida as ex:
            raise HTTPException(409, str(ex)) from ex
        return {"ok": True}

    @app.post("/api/oportunidades/{oid}/resultado")
    async def resultado(oid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return sv.registrar_resultado(db, oid, (await request.json())["resultado"], u)

    @app.post("/api/cotacoes")
    async def cotacao(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return {"id": sv.registrar_cotacao(db, u["empresa_id"], await request.json())}

    @app.post("/api/cotacoes/{cid}/marcar")
    async def marcar(cid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        ev = (await request.json())["evento"]
        ator = {"fornecedor": "fornecedor:portal", "agentes": "agente:comparador-de-propostas"}.get(ev, f"usuario:{u['id']}")
        sv.marcar_cotacao(db, cid, ev, ator)
        return {"ok": True}

    # ------------------------------------------------------------ aprovações
    @app.get("/api/aprovacoes")
    def aprovacoes(u: dict[str, Any] = Depends(admin)) -> list[dict[str, Any]]:
        return db.todos("SELECT * FROM aprovacao WHERE empresa_id=? ORDER BY id DESC", u["empresa_id"])

    @app.post("/api/aprovacoes/{aid}/decidir")
    async def decidir(aid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        return sv.decidir_aprovacao(db, aid, u, d["decisao"], "painel", d.get("justificativa", ""), d.get("hash"))

    # ------------------------------------------------------------ contratos
    @app.post("/api/contratos")
    async def criar_contrato(dados: str = Form(...), arquivo: UploadFile | None = File(None),
                             u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        doc = (await arquivo.read(), arquivo.filename or "contrato") if arquivo else None
        return sv.registrar_contrato(db, u["empresa_id"], json.loads(dados), u, doc)

    @app.get("/api/contratos")
    def contratos(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        return [c for c in db.todos("SELECT * FROM contrato WHERE empresa_id=?", u["empresa_id"])
                if cv is None or c["id"] in cv]

    @app.get("/api/contratos/{cid}")
    def ver_contrato(cid: int, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        checar(u, "contrato", cid)
        return {"contrato": db.um("SELECT * FROM contrato WHERE id=?", cid),
                "obrigacoes": db.todos("SELECT * FROM obrigacao WHERE contrato_id=?", cid),
                "projetos": db.todos("SELECT * FROM projeto WHERE contrato_id=?", cid),
                "entregas": db.todos("SELECT * FROM entrega WHERE contrato_id=?", cid),
                "medicoes": db.todos("SELECT * FROM medicao WHERE contrato_id=?", cid),
                "notas": db.todos("SELECT * FROM nota_fiscal WHERE contrato_id=?", cid),
                "chamados": db.todos("SELECT * FROM chamado WHERE contrato_id=?", cid),
                "plano": sv.plano_projeto(db, cid)}

    @app.post("/api/contratos/{cid}/solicitar-inicio")
    def sol_inicio(cid: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return {"aprovacao_id": sv.solicitar_inicio_execucao(db, cid)}

    @app.post("/api/contratos/{cid}/iniciar")
    async def iniciar(cid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        try:
            return sv.iniciar_execucao(db, cid, int((await request.json())["aprovacao_id"]))
        except AprovacaoInvalida as ex:
            raise HTTPException(409, str(ex)) from ex

    @app.post("/api/contratos/{cid}/acesso")
    async def conceder(cid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        uid = int((await request.json())["usuario_id"])
        db.inserir("acesso", {"usuario_id": uid, "objeto_tipo": "contrato", "objeto_id": cid})
        auditoria.registrar(db, "seguranca.acesso_concedido", f"Usuário #{uid} recebeu acesso ao contrato #{cid}",
                            ator_tipo="usuario", ator_id=str(u["id"]), empresa_id=u["empresa_id"], contrato_id=cid)
        return {"ok": True}

    # ------------------------------------------------------------ chamados, tarefas, código
    @app.post("/api/chamados")
    async def chamado(request: Request, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        d = await request.json()
        checar(u, "contrato", d.get("contrato_id"))
        return sv.abrir_chamado(db, u["empresa_id"], d["texto"], "painel", f"usuario:{u['id']}", d.get("contrato_id"),
                                d.get("sistema"))

    @app.get("/api/chamados")
    def chamados(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        return [c for c in db.todos("SELECT * FROM chamado WHERE empresa_id=? ORDER BY id DESC", u["empresa_id"])
                if cv is None or c["contrato_id"] in cv]

    @app.get("/api/tarefas")
    def tarefas(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        return [t for t in db.todos("SELECT * FROM tarefa WHERE empresa_id=? ORDER BY id DESC LIMIT 300", u["empresa_id"])
                if cv is None or t["contrato_id"] in cv]

    @app.post("/api/tarefas/{tid}/revisar")
    async def revisar(tid: int, request: Request, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        d = await request.json()
        t = db.um("SELECT contrato_id FROM tarefa WHERE id=?", tid)
        checar(u, "contrato", t["contrato_id"])
        sv.revisar_tarefa(db, tid, f"usuario:{u['id']}", bool(d["aprovado"]), d.get("nota", ""))
        return {"ok": True}

    @app.post("/api/tarefas/{tid}/estado")
    async def estado(tid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        if d["para"] not in ("pausada", "pronta", "cancelada", "triada", "planejada"):
            raise HTTPException(422, "Estado não permitido manualmente")
        motor.mudar_estado(db, tid, d["para"], ator=f"usuario:{u['id']}", motivo=d.get("motivo", "ação manual"))
        if d.get("reatribuir"):
            db.atualizar("tarefa", tid, {"executor_id": d["reatribuir"]})
        return {"ok": True}

    @app.post("/api/tarefas/{tid}/alteracao-codigo")
    async def alteracao(tid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        return sv.registrar_alteracao_codigo(db, tid, d["repositorio"], d.get("autor", f"usuario:{u['id']}"))

    @app.get("/api/execucoes/{eid}")
    def execucao(eid: int, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        e = db.um("SELECT e.*, t.contrato_id, t.empresa_id FROM execucao_ferramenta e JOIN tarefa t ON t.id=e.tarefa_id "
                  "WHERE e.id=?", eid)
        if not e or e["empresa_id"] != u["empresa_id"]:
            raise HTTPException(404)
        checar(u, "contrato", e["contrato_id"])
        return e

    # ------------------------------------------------------------ entregas, medições, notas, financeiro
    @app.post("/api/entregas")
    async def entrega(request: Request, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        d = await request.json()
        checar(u, "contrato", d["contrato_id"])
        return {"id": sv.registrar_entrega(db, d["contrato_id"], d["descricao"], str(d["quantidade"]), d["unidade"],
                                           d["evidencias"], d.get("executor", f"usuario:{u['id']}"), d.get("tarefa_id"))}

    @app.post("/api/entregas/{eid}/decidir")
    async def dec_entrega(eid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        sv.decidir_entrega(db, eid, bool(d["aceita"]), d.get("quem", "cliente (registrado por " + u["nome"] + ")"),
                           d.get("motivo", ""))
        return {"ok": True}

    @app.post("/api/medicoes")
    async def medicao(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        return sv.gerar_medicao(db, int(d["contrato_id"]), d["periodo"])

    @app.post("/api/medicoes/{mid}/decidir")
    async def dec_medicao(mid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        return sv.decidir_medicao(db, mid, bool(d["aceita"]), str(d.get("glosa", "0")), d.get("motivo", ""),
                                  d.get("quem", "cliente"))

    @app.post("/api/medicoes/{mid}/nota")
    def nota(mid: int, _: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return sv.preparar_nota(db, mid)

    @app.post("/api/notas/{nid}/emitir")
    async def emitir(nid: int, request: Request, _: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        try:
            return sv.emitir_nota(db, nid, int((await request.json())["aprovacao_id"]), app.state.emissor)
        except AprovacaoInvalida as ex:
            raise HTTPException(409, str(ex)) from ex

    @app.get("/api/notas")
    def notas(u: dict[str, Any] = Depends(admin)) -> list[dict[str, Any]]:
        return db.todos("SELECT n.*, c.numero FROM nota_fiscal n JOIN contrato c ON c.id=n.contrato_id WHERE "
                        "c.empresa_id=? ORDER BY n.id DESC", u["empresa_id"])

    @app.get("/api/medicoes")
    def medicoes(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        return [m for m in db.todos("SELECT m.*, c.numero FROM medicao m JOIN contrato c ON c.id=m.contrato_id WHERE "
                                    "c.empresa_id=? ORDER BY m.id DESC", u["empresa_id"])
                if cv is None or m["contrato_id"] in cv]

    @app.get("/api/entregas")
    def entregas(u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        cv = contratos_visiveis(u)
        return [e for e in db.todos("SELECT e.*, c.numero FROM entrega e JOIN contrato c ON c.id=e.contrato_id WHERE "
                                    "c.empresa_id=? ORDER BY e.id DESC", u["empresa_id"])
                if cv is None or e["contrato_id"] in cv]

    @app.get("/api/financeiro")
    def financeiro(u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        if u["papel"] not in ("admin", "financeiro"):
            raise HTTPException(403)
        return sv.painel_financeiro(db, u["empresa_id"], contratos_visiveis(u))

    @app.post("/api/financeiro/perguntar")
    async def perguntar(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return {"resposta": sv.responder_financeiro(db, u["empresa_id"], (await request.json())["pergunta"])}

    @app.post("/api/lancamentos")
    async def lancamento(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        lid = db.inserir("lancamento", {"empresa_id": u["empresa_id"], "situacao": "aberto", "criado_em": sv.agora(), **d})
        auditoria.registrar(db, "financeiro.lancamento", f"Lançamento #{lid} {d['tipo']} R$ {d['valor']} {d['descricao']}",
                            ator_tipo="usuario", ator_id=str(u["id"]), empresa_id=u["empresa_id"],
                            contrato_id=d.get("contrato_id"))
        return {"id": lid}

    @app.post("/api/lancamentos/{lid}/liquidar")
    def liquidar(lid: int, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        sv.liquidar(db, lid, u)
        return {"ok": True}

    # ------------------------------------------------------------ chat, reuniões, relatórios
    @app.get("/api/mensagens")
    def mensagens(canal: str, ref: str, u: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        if canal == "contrato":
            checar(u, "contrato", int(ref))
        return db.todos("SELECT * FROM mensagem WHERE empresa_id=? AND canal=? AND canal_ref=? ORDER BY id DESC LIMIT 100",
                        u["empresa_id"], canal, ref)[::-1]

    @app.post("/api/mensagens")
    async def mensagem(request: Request, u: dict[str, Any] = Depends(usuario)) -> dict[str, Any]:
        d = await request.json()
        if d["canal"] == "contrato":
            checar(u, "contrato", int(d["ref"]))
        return sv.enviar_mensagem(db, u["empresa_id"], d["canal"], d["ref"], f"usuario:{u['id']}", d["texto"])

    @app.post("/api/mensagens/{mid}/tarefa")
    async def msg_tarefa(mid: int, request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return sv.mensagem_para_tarefa(db, mid, (await request.json())["executor"], u)

    @app.post("/api/reunioes")
    async def reuniao(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        return sv.registrar_ata(db, u["empresa_id"], d["texto"], d.get("contrato_id"))

    @app.post("/api/relatorios/diario")
    def gerar_rel(u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return sv.relatorio_diario(db, u["empresa_id"])

    @app.get("/api/relatorios")
    def rels(u: dict[str, Any] = Depends(admin)) -> list[dict[str, Any]]:
        return db.todos("SELECT * FROM relatorio WHERE empresa_id=? ORDER BY id DESC LIMIT 30", u["empresa_id"])

    @app.get("/api/integracoes")
    def integ(_: dict[str, Any] = Depends(usuario)) -> list[dict[str, Any]]:
        return integracoes.situacao_integracoes(db)

    @app.get("/api/auditoria/verificar")
    def verificar(_: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        return auditoria.verificar_cadeia(db)

    @app.get("/api/exportar")
    def exportar(u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        auditoria.registrar(db, "dados.exportados", "Exportação completa solicitada", ator_tipo="usuario",
                            ator_id=str(u["id"]), empresa_id=u["empresa_id"])
        return sv.exportar(db, u["empresa_id"])

    # ------------------------------------------------------------ links seguros
    @app.post("/api/links")
    async def link(request: Request, u: dict[str, Any] = Depends(admin)) -> dict[str, Any]:
        d = await request.json()
        tipo = d["tipo"]
        if tipo not in ("escritorio", "evidencias_contrato", "relatorio"):
            raise HTTPException(422, "Tipo de link: escritorio | evidencias_contrato | relatorio")
        escopo = f"{tipo}:{u['empresa_id']}:{d.get('ref', '')}"
        r = sv.criar_link(db, escopo, int(d.get("horas", 24)), u["id"])
        base = os.getenv("ESCRITORIO_URL_PUBLICA", str(request.base_url).rstrip("/"))
        return {**r, "url": f"{base}/l/{r['token']}"}

    @app.get("/l/{token}", response_class=HTMLResponse)
    def ver_link(token: str) -> HTMLResponse:
        try:
            info = sv.validar_link(db, token)
        except PermissionError as ex:
            return HTMLResponse(f"<h1>Link inválido</h1><p>{ex}</p>", status_code=403)
        tipo, emp, ref = info["escopo"].split(":", 2)
        e = int(emp)
        if tipo == "evidencias_contrato":
            dados: Any = {
                "contrato": db.um("SELECT numero, objeto, situacao FROM contrato WHERE id=? AND empresa_id=?", int(ref), e),
                "entregas": db.todos("SELECT id, descricao, quantidade, unidade, evidencias, situacao, aceita_em FROM "
                                     "entrega WHERE contrato_id=?", int(ref)),
                "execucoes": db.todos("SELECT e.id, e.comando, e.codigo_saida, e.sha256_saida, e.fim FROM "
                                      "execucao_ferramenta e JOIN tarefa t ON t.id=e.tarefa_id WHERE t.contrato_id=?",
                                      int(ref))}
        elif tipo == "relatorio":
            r = db.um("SELECT conteudo FROM relatorio WHERE empresa_id=? ORDER BY id DESC LIMIT 1", e)
            dados = json.loads(r["conteudo"]) if r else {}
        else:
            dados = {"agentes_ativos": db.todos("SELECT a.nome, a.estado, t.titulo tarefa FROM agente a LEFT JOIN tarefa "
                                                "t ON t.id=a.tarefa_atual_id WHERE a.estado!='disponivel'"),
                     "eventos": db.todos("SELECT tipo, ator_id, criado_em, substr(resumo,1,160) resumo FROM evento WHERE "
                                         "empresa_id=? AND tipo NOT LIKE 'seguranca.%' ORDER BY id DESC LIMIT 60", e)}
        corpo = json.dumps(dados, ensure_ascii=False, indent=2, default=str)
        corpo = corpo.replace("&", "&amp;").replace("<", "&lt;")
        return HTMLResponse(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                            f"<title>Escritório — {tipo}</title><body style='font-family:system-ui;margin:16px'>"
                            f"<h2>{tipo.replace('_', ' ')}</h2><p>Somente leitura · válido até {info['expira_em']}</p>"
                            f"<pre style='white-space:pre-wrap'>{corpo}</pre></body>")

    # ------------------------------------------------------------ WhatsApp (webhook oficial)
    @app.get("/webhooks/whatsapp")
    def wa_verificar(request: Request) -> Response:
        q = request.query_params
        w = integracoes.WhatsApp()
        if w.verify_token and q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == w.verify_token:
            return PlainTextResponse(q.get("hub.challenge", ""))
        return PlainTextResponse("proibido", status_code=403)

    @app.post("/webhooks/whatsapp")
    async def wa_receber(request: Request) -> dict[str, Any]:
        corpo = await request.body()
        w = integracoes.WhatsApp()
        if not w.assinatura_valida(corpo, request.headers.get("x-hub-signature-256")):
            auditoria.registrar(db, "seguranca.webhook_invalido", "Webhook WhatsApp com assinatura inválida rejeitado")
            raise HTTPException(401, "assinatura inválida")
        return {"processadas": sv.processar_whatsapp(db, json.loads(corpo))}

    # ------------------------------------------------------------ interface
    app.mount("/static", StaticFiles(directory=WEB), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        return HTMLResponse((WEB / "index.html").read_text(encoding="utf-8"))

    return app
