"""API FastAPI: login com MFA, cadastros por usuário (cifrados), cotações ao vivo (WebSocket), anexos, exportação e agentes.

A mesma página web (web/index.html + web/app.js) é servida em "/" e detecta este servidor sozinha.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from . import agentes
from . import seguranca as seg
from .config import cfg
from .db import Anexo, Auditoria, Cotacao, Documento, Redefinicao, Sessao, Usuario, auditar, contar_falhas, sessao
from .integracoes import china, outras

log = logging.getLogger(__name__)
WEB = Path(__file__).resolve().parent.parent / "web"
COLECOES = {"produtos", "fornecedores", "contatos", "tarefas", "clientes", "vendas", "links", "watchlist", "carteira", "paper",
            "alertas", "alertas_log", "conversoes", "cotacoes", "tendencias", "agentes_log", "config", "ofertas", "anuncios"}
COOKIE = "ct_sessao"
MAX_DOC = 256 * 1024
MAX_ANEXO = 20 * 1024 * 1024


@asynccontextmanager
async def ciclo_vida(app: FastAPI) -> AsyncIterator[None]:
    if cfg.worker_embutido:
        from .worker import laco
        threading.Thread(target=laco, daemon=True, name="coletor").start()
    yield


app = FastAPI(title="China Trade & Market Intelligence", version="1.0.0", lifespan=ciclo_vida)

CSP = ("default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src * data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


@app.middleware("http")
async def protecoes(request: Request, call_next):
    # Pedido que altera dados precisa do cabeçalho X-CT (navegadores não o enviam entre sites sem CORS) — barra CSRF.
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path.startswith("/api/") and request.headers.get("x-ct") != "1":
        return JSONResponse({"detail": "Pedido recusado (cabeçalho de segurança ausente)."}, status_code=403)
    resp = await call_next(request)
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


# ---------- autenticação ----------
def usuario_atual(request: Request) -> Usuario:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Entre para continuar.")
    with sessao() as s:
        ss = s.get(Sessao, seg.hash_token(token))
        if not ss or ss.expira_em.replace(tzinfo=ss.expira_em.tzinfo or UTC) < datetime.now(UTC):
            raise HTTPException(401, "Sessão expirada.")
        u = s.get(Usuario, ss.usuario_id)
        if not u or not u.ativo:
            raise HTTPException(401, "Usuário inativo.")
        return u


Usu = Annotated[Usuario, Depends(usuario_atual)]


def pode_escrever(u: Usuario) -> None:
    if u.papel == "leitor":
        raise HTTPException(403, "Seu perfil é somente leitura.")


def so_admin(u: Usuario) -> None:
    if u.papel != "admin":
        raise HTTPException(403, "Somente administradores.")


def _publico(u: Usuario) -> dict:
    return {"id": u.id, "nome": u.nome, "email": u.email, "papel": u.papel, "mfa": u.mfa_ativo,
            "ultimo_acesso": u.ultimo_acesso.isoformat() if u.ultimo_acesso else None}


class Cadastro(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    senha: str = Field(min_length=1, max_length=200)


class Entrada(BaseModel):
    email: str
    senha: str
    codigo_mfa: str | None = None


@app.get("/api/saude")
def saude() -> dict:
    return {"app": "china-trade", "ok": True, "hora": datetime.now(UTC).isoformat()}


@app.post("/api/auth/cadastrar", status_code=201)
def cadastrar(dados: Cadastro, request: Request) -> dict:
    email = dados.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "E-mail inválido.")
    if erro := seg.senha_forte(dados.senha):
        raise HTTPException(422, erro)
    with sessao() as s:
        primeiro = s.scalar(select(Usuario.id).limit(1)) is None
        if not primeiro and not cfg.cadastro_aberto:
            raise HTTPException(403, "Cadastro fechado. Peça acesso ao administrador.")
        if s.scalar(select(Usuario.id).where(Usuario.email == email)):
            raise HTTPException(409, "Este e-mail já tem conta.")
        u = Usuario(nome=dados.nome.strip(), email=email, senha_hash=seg.hash_senha(dados.senha), papel="admin" if primeiro else "analista")
        s.add(u)
        s.flush()
        auditar(s, "cadastro", u.id, email, f"papel={u.papel}", _ip(request))
        return _publico(u)


@app.post("/api/auth/entrar")
def entrar(dados: Entrada, request: Request, response: Response) -> dict:
    email = dados.email.strip().lower()
    erro: HTTPException | None = None
    with sessao() as s:  # a falha é gravada (commit) antes de responder, para o bloqueio funcionar
        u = s.scalar(select(Usuario).where(Usuario.email == email))
        if contar_falhas(s, email, datetime.now(UTC) - timedelta(minutes=15)) >= 5:
            auditar(s, "login_bloqueado", None, email, None, _ip(request))
            erro = HTTPException(429, "Muitas tentativas. Aguarde 15 minutos.")
        else:
            ok = bool(u and u.ativo and seg.conferir_senha(dados.senha, u.senha_hash))
            if ok and u and u.mfa_ativo and not dados.codigo_mfa:
                erro = HTTPException(401, "Informe o código MFA do seu aplicativo autenticador.")
            else:
                if ok and u and u.mfa_ativo:
                    ok = seg.conferir_totp(seg.decifrar(u.mfa_segredo or ""), dados.codigo_mfa or "")
                if not ok or not u:
                    auditar(s, "login_falhou", u.id if u else None, email, None, _ip(request))
                    erro = HTTPException(401, "E-mail, senha ou código incorretos.")
    if erro or not u:
        raise erro or HTTPException(401, "E-mail, senha ou código incorretos.")
    with sessao() as s:
        u = s.get(Usuario, u.id)
        assert u
        token, h = seg.novo_token()
        s.add(Sessao(token_hash=h, usuario_id=u.id, expira_em=datetime.now(UTC) + timedelta(hours=cfg.sessao_horas), ip=_ip(request)))
        u.ultimo_acesso = datetime.now(UTC)
        auditar(s, "login", u.id, email, None, _ip(request))
        response.set_cookie(COOKIE, token, httponly=True, secure=cfg.cookie_seguro, samesite="strict", max_age=cfg.sessao_horas * 3600, path="/")
        return _publico(u)


@app.post("/api/auth/sair")
def sair(request: Request, response: Response) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        with sessao() as s:
            s.execute(delete(Sessao).where(Sessao.token_hash == seg.hash_token(token)))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/eu")
def eu(u: Usu) -> dict:
    return _publico(u)


@app.post("/api/auth/mfa/iniciar")
def mfa_iniciar(u: Usu) -> dict:
    segredo = seg.novo_segredo_totp()
    with sessao() as s:
        x = s.get(Usuario, u.id)
        assert x
        x.mfa_segredo, x.mfa_ativo = seg.cifrar(segredo), False
    return {"segredo": segredo, "uri": seg.uri_totp(segredo, u.email)}


@app.post("/api/auth/mfa/confirmar")
def mfa_confirmar(u: Usu, request: Request, codigo: Annotated[str, Body(embed=True)]) -> dict:
    with sessao() as s:
        x = s.get(Usuario, u.id)
        assert x
        if not x.mfa_segredo or not seg.conferir_totp(seg.decifrar(x.mfa_segredo), codigo):
            raise HTTPException(400, "Código incorreto. Confira a hora do celular e tente de novo.")
        x.mfa_ativo = True
        auditar(s, "mfa_ativado", u.id, u.email, None, _ip(request))
    return {"ok": True}


@app.post("/api/auth/mfa/desativar")
def mfa_desativar(u: Usu, request: Request, senha: Annotated[str, Body()], codigo: Annotated[str, Body()]) -> dict:
    with sessao() as s:
        x = s.get(Usuario, u.id)
        assert x
        if not (seg.conferir_senha(senha, x.senha_hash) and x.mfa_segredo and seg.conferir_totp(seg.decifrar(x.mfa_segredo), codigo)):
            raise HTTPException(400, "Senha ou código incorretos.")
        x.mfa_ativo, x.mfa_segredo = False, None
        auditar(s, "mfa_desativado", u.id, u.email, None, _ip(request))
    return {"ok": True}


@app.post("/api/auth/recuperar")
def recuperar(request: Request, email: Annotated[str, Body(embed=True)]) -> dict:
    email = email.strip().lower()
    with sessao() as s:
        u = s.scalar(select(Usuario).where(Usuario.email == email, Usuario.ativo.is_(True)))
        if u:
            codigo = secrets.token_urlsafe(9)
            s.add(Redefinicao(token_hash=seg.hash_token(codigo), usuario_id=u.id, expira_em=datetime.now(UTC) + timedelta(minutes=30)))
            auditar(s, "recuperacao_pedida", u.id, email, None, _ip(request))
            texto = f"Seu código para trocar a senha do China Trade é: {codigo}\nVale por 30 minutos. Se não foi você, ignore."
            try:
                entrega = outras.enviar_email(email, "Código para trocar a senha", texto)
            except OSError as e:
                entrega = f"falha no e-mail: {e}"
            if entrega != "e-mail enviado":
                log.warning("Código de redefinição para %s (%s): %s", email, entrega, codigo)
    return {"ok": True}


@app.post("/api/auth/redefinir")
def redefinir(request: Request, email: Annotated[str, Body()], token: Annotated[str, Body()], nova_senha: Annotated[str, Body()]) -> dict:
    if erro := seg.senha_forte(nova_senha):
        raise HTTPException(422, erro)
    with sessao() as s:
        r = s.get(Redefinicao, seg.hash_token(token.strip()))
        u = s.scalar(select(Usuario).where(Usuario.email == email.strip().lower()))
        invalido = not r or not u or r.usado or r.usuario_id != u.id or r.expira_em.replace(tzinfo=r.expira_em.tzinfo or UTC) < datetime.now(UTC)
        if invalido:
            auditar(s, "recuperacao_falhou", u.id if u else None, email, None, _ip(request))
    if invalido:
        raise HTTPException(400, "Código inválido ou vencido.")
    with sessao() as s:
        r = s.get(Redefinicao, seg.hash_token(token.strip()))
        u = s.scalar(select(Usuario).where(Usuario.email == email.strip().lower()))
        assert r and u
        r.usado = True
        u.senha_hash = seg.hash_senha(nova_senha)
        s.execute(delete(Sessao).where(Sessao.usuario_id == u.id))
        auditar(s, "senha_trocada", u.id, u.email, None, _ip(request))
    return {"ok": True}


# ---------- administração ----------
@app.get("/api/admin/usuarios")
def admin_usuarios(u: Usu) -> list[dict]:
    so_admin(u)
    with sessao() as s:
        return [_publico(x) for x in s.scalars(select(Usuario).order_by(Usuario.id))]


@app.patch("/api/admin/usuarios/{uid}")
def admin_alterar(uid: int, u: Usu, request: Request, papel: Annotated[str | None, Body()] = None, ativo: Annotated[bool | None, Body()] = None) -> dict:
    so_admin(u)
    if papel and papel not in {"admin", "analista", "leitor"}:
        raise HTTPException(422, "Perfil inválido.")
    with sessao() as s:
        x = s.get(Usuario, uid)
        if not x:
            raise HTTPException(404, "Usuário não encontrado.")
        if papel:
            x.papel = papel
        if ativo is not None:
            x.ativo = ativo
            if not ativo:
                s.execute(delete(Sessao).where(Sessao.usuario_id == uid))
        auditar(s, "usuario_alterado", u.id, u.email, f"alvo={uid} papel={papel} ativo={ativo}", _ip(request))
        return _publico(x)


@app.get("/api/admin/auditoria")
def admin_auditoria(u: Usu, limite: int = 200) -> list[dict]:
    so_admin(u)
    with sessao() as s:
        rs = s.scalars(select(Auditoria).order_by(Auditoria.id.desc()).limit(min(limite, 1000)))
        return [{"quando": a.quando.isoformat(), "email": a.email, "acao": a.acao, "detalhe": a.detalhe, "ip": a.ip} for a in rs]


# ---------- cadastros (documentos por usuário) ----------
def docs(s: Any, uid: int, col: str | None = None) -> list[tuple[str, dict]]:
    q = select(Documento).where(Documento.usuario_id == uid)
    if col:
        q = q.where(Documento.colecao == col)
    return [(d.colecao, seg.decifrar_json(d.conteudo)) for d in s.scalars(q)]


def salvar_doc(s: Any, uid: int, col: str, doc: dict) -> None:
    d = s.scalar(select(Documento).where(Documento.usuario_id == uid, Documento.colecao == col, Documento.doc_id == doc["id"]))
    if d:
        d.conteudo = seg.cifrar(doc)
        d.atualizado_em = datetime.now(UTC)
    else:
        s.add(Documento(usuario_id=uid, colecao=col, doc_id=doc["id"], conteudo=seg.cifrar(doc)))


@app.get("/api/colecoes")
def listar_tudo(u: Usu) -> dict[str, list[dict]]:
    with sessao() as s:
        saida: dict[str, list[dict]] = {c: [] for c in COLECOES}
        for col, d in docs(s, u.id):
            saida.setdefault(col, []).append(d)
        saida["auditoria"] = [{"id": str(a.id), "criado_em": a.quando.isoformat(), "acao": a.acao, "colecao": (a.detalhe or "").split("/")[0],
                               "titulo": a.detalhe, "usuario": a.email}
                              for a in s.scalars(select(Auditoria).where(Auditoria.usuario_id == u.id).order_by(Auditoria.id.desc()).limit(200))]
        return saida


@app.put("/api/colecoes/{col}/{doc_id}")
async def gravar(col: str, doc_id: str, request: Request, u: Usu) -> dict:
    pode_escrever(u)
    if col not in COLECOES:
        raise HTTPException(404, "Cadastro desconhecido.")
    corpo = await request.body()
    if len(corpo) > MAX_DOC:
        raise HTTPException(413, "Registro grande demais (máx. 256 KB).")
    doc = json.loads(corpo)
    if not isinstance(doc, dict):
        raise HTTPException(422, "Envie um objeto JSON.")
    doc["id"] = doc_id
    with sessao() as s:
        novo = not s.scalar(select(Documento.id).where(Documento.usuario_id == u.id, Documento.colecao == col, Documento.doc_id == doc_id))
        salvar_doc(s, u.id, col, doc)
        if col not in {"alertas_log", "agentes_log", "conversoes"}:
            auditar(s, "criou" if novo else "alterou", u.id, u.email, f"{col}/{doc_id}", _ip(request))
    return doc


@app.delete("/api/colecoes/{col}/{doc_id}")
def apagar(col: str, doc_id: str, request: Request, u: Usu) -> dict:
    pode_escrever(u)
    with sessao() as s:
        s.execute(delete(Documento).where(Documento.usuario_id == u.id, Documento.colecao == col, Documento.doc_id == doc_id))
        auditar(s, "excluiu", u.id, u.email, f"{col}/{doc_id}", _ip(request))
    return {"ok": True}


@app.get("/api/exportar")
def exportar(u: Usu) -> Response:
    with sessao() as s:
        dados: dict[str, list] = {}
        for col, d in docs(s, u.id):
            dados.setdefault(col, []).append(d)
        auditar(s, "exportou", u.id, u.email, None, None)
    corpo = json.dumps({"app": "china-trade", "versao": 1, "exportado_em": datetime.now(UTC).isoformat(), "dados": dados}, ensure_ascii=False)
    nome = f"china-trade-backup-{datetime.now(UTC):%Y-%m-%d}.json"
    return Response(corpo, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{nome}"'})


# ---------- cotações ----------
@app.get("/api/cotacoes")
def cotacoes(u: Usu) -> list[dict]:
    with sessao() as s:
        return [c.dados for c in s.scalars(select(Cotacao))]


@app.websocket("/api/ws")
async def ws(sock: WebSocket) -> None:
    token = sock.cookies.get(COOKIE)
    with sessao() as s:
        ss = s.get(Sessao, seg.hash_token(token)) if token else None
        valida = bool(ss and ss.expira_em.replace(tzinfo=ss.expira_em.tzinfo or UTC) > datetime.now(UTC))
    if not valida:
        await sock.close(code=4401)
        return
    await sock.accept()
    desde = datetime.now(UTC)
    try:
        if cfg.redis_url:
            import redis.asyncio as aioredis
            r = aioredis.from_url(cfg.redis_url)
            ps = r.pubsub()
            await ps.subscribe("ct:cotacoes")
            async for msg in ps.listen():
                if msg.get("type") == "message":
                    await sock.send_text(msg["data"].decode() if isinstance(msg["data"], bytes) else msg["data"])
        else:
            while True:
                await asyncio.sleep(3)
                with sessao() as s:
                    novas = list(s.scalars(select(Cotacao).where(Cotacao.atualizado_em > desde)))
                for c in novas:
                    await sock.send_text(json.dumps(c.dados, ensure_ascii=False))
                    at = c.atualizado_em.replace(tzinfo=c.atualizado_em.tzinfo or UTC)
                    desde = max(desde, at)
    except (WebSocketDisconnect, RuntimeError):
        return


# ---------- China, tendências, links ----------
@app.get("/api/traduzir")
def traduzir(texto: str, u: Usu) -> dict:
    return china.traduzir(texto[:200])


@app.get("/api/china/buscar")
def buscar_china(termo: str, u: Usu) -> dict:
    t = china.traduzir(termo[:200])
    return {"traducao": t, "links": china.links_busca(termo, t["zh"], t["en"]),
            "open_platform": "ativa" if china.Alibaba1688().ativo else "sem credenciais (ALIBABA_APP_KEY/SECRET + token OAuth)"}


@app.post("/api/tendencias")
def coletar_tendencias(u: Usu, termos: Annotated[list[str], Body(embed=True)]) -> list[dict]:
    pode_escrever(u)
    termos = [t.strip() for t in termos if t.strip()][:5]
    if not termos:
        raise HTTPException(422, "Informe até 5 termos.")
    try:
        series = outras.tendencias(termos)
    except Exception as e:
        raise HTTPException(502, f"Google Trends não respondeu: {type(e).__name__}") from e
    with sessao() as s:
        for d in series:
            salvar_doc(s, u.id, "tendencias", d)
    return series


@app.get("/api/links/capturar")
def capturar(url: str, u: Usu) -> dict:
    try:
        return outras.capturar_titulo(url)
    except (ValueError, OSError) as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"O site não respondeu: {type(e).__name__}") from e


# ---------- anexos ----------
@app.post("/api/anexos", status_code=201)
async def anexar(u: Usu, arquivo: Annotated[UploadFile, File()]) -> dict:
    pode_escrever(u)
    conteudo = await arquivo.read(MAX_ANEXO + 1)
    if len(conteudo) > MAX_ANEXO:
        raise HTTPException(413, "Arquivo maior que 20 MB.")
    aid = secrets.token_hex(12)
    pasta = cfg.pasta_anexos / str(u.id)
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / aid).write_bytes(seg._f().encrypt(conteudo))
    with sessao() as s:
        s.add(Anexo(id=aid, usuario_id=u.id, nome=(arquivo.filename or "arquivo")[:300], tipo=arquivo.content_type or "application/octet-stream", tamanho=len(conteudo)))
        auditar(s, "anexou", u.id, u.email, arquivo.filename, None)
    return {"id": aid, "url": f"api/anexos/{aid}", "nome": arquivo.filename}


@app.get("/api/anexos/{aid}")
def baixar_anexo(aid: str, u: Usu) -> Response:
    with sessao() as s:
        a = s.get(Anexo, aid)
        if not a or a.usuario_id != u.id:
            raise HTTPException(404, "Anexo não encontrado.")
    dados = seg._f().decrypt((cfg.pasta_anexos / str(u.id) / aid).read_bytes())
    seguro = a.tipo in {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"}
    disp = "inline" if seguro else "attachment"
    return Response(dados, media_type=a.tipo if seguro else "application/octet-stream",
                    headers={"Content-Disposition": f'{disp}; filename="{a.nome.replace(chr(34), "")}"'})


# ---------- agentes ----------
@app.post("/api/agentes/{agente}")
def executar_agente(agente: str, u: Usu) -> dict:
    if agente not in agentes.AGENTES:
        raise HTTPException(404, "Agente desconhecido.")
    with sessao() as s:
        meus = {}
        for col, d in docs(s, u.id):
            meus.setdefault(col, []).append(d)
        cots = {c.id: c.dados for c in s.scalars(select(Cotacao))}
        r = agentes.executar(agente, meus, cots)
        reg = {"id": secrets.token_hex(8), "agente": r["agente"], "entrada": "API", "resultado": r["resultado"][:4000], "fontes": r["fontes"],
               "limitacoes": r["limitacoes"], "criado_em": datetime.now(UTC).isoformat()}
        salvar_doc(s, u.id, "agentes_log", reg)
    return reg


# ---------- página ----------
_ESQ = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}"
        "img{max-width:100%}[hidden]{display:none!important}</style></head><body>")


@app.get("/", response_class=HTMLResponse)
def pagina() -> str:
    return _ESQ + (WEB / "index.html").read_text(encoding="utf-8") + "</body></html>"


@app.get("/{arquivo}.js")
def script(arquivo: str) -> FileResponse:
    if arquivo not in {"app", "modulos"}:
        raise HTTPException(404, "Arquivo não encontrado.")
    return FileResponse(WEB / f"{arquivo}.js", media_type="text/javascript")
