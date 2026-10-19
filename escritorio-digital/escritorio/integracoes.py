"""Integrações externas. Cada uma informa honestamente sua situação:
conectado | nao_configurado | indisponivel | simulado."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import shlex
import subprocess
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .db import Banco, agora

USER_AGENT = "EscritorioDigital/0.1 (consulta publica)"


# ---------------------------------------------------------------- circuit breaker
def _circuito(db: Banco, nome: str) -> None:
    i = db.um("SELECT * FROM integracao WHERE nome=?", nome)
    if i and i["aberto_ate"] and i["aberto_ate"] > agora():
        raise ConnectionError(f"Integração '{nome}' em pausa (circuit breaker) até {i['aberto_ate']}")


def _resultado(db: Banco, nome: str, ok: bool, detalhe: str) -> None:
    i = db.um("SELECT * FROM integracao WHERE nome=?", nome) or {"falhas_seguidas": 0}
    falhas = 0 if ok else int(i["falhas_seguidas"]) + 1
    aberto = (datetime.now(UTC) + timedelta(minutes=5)).isoformat(timespec="seconds") if falhas >= 3 else None
    with db.tx() as c:
        c.execute("INSERT INTO integracao (nome, situacao, detalhe, verificado_em, falhas_seguidas, aberto_ate) "
                  "VALUES (?,?,?,?,?,?) ON CONFLICT(nome) DO UPDATE SET situacao=excluded.situacao, "
                  "detalhe=excluded.detalhe, verificado_em=excluded.verificado_em, "
                  "falhas_seguidas=excluded.falhas_seguidas, aberto_ate=excluded.aberto_ate",
                  (nome, "conectado" if ok else "indisponivel", detalhe[:300], agora(), falhas, aberto))


def _get(url: str, timeout: int = 40) -> bytes:
    if not url.startswith("https://"):
        raise PermissionError("Somente HTTPS")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*"})  # noqa: S310
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - URLs fixas de fontes oficiais
        return bytes(r.read())


# ---------------------------------------------------------------- PNCP (fonte oficial)
PNCP_CONSULTA = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao"
PNCP_ARQUIVOS = "https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/arquivos"
MODALIDADES = {6: "Pregão - Eletrônico", 8: "Dispensa", 4: "Concorrência - Eletrônica", 9: "Inexigibilidade"}


def pncp_buscar(db: Banco, data_inicial: str, data_final: str, modalidade: int = 6, uf: str | None = None,
                pagina: int = 1, tamanho: int = 50) -> dict[str, Any]:
    """Consulta pública do PNCP por data de publicação. Datas AAAAMMDD."""
    _circuito(db, "pncp")
    q = {"dataInicial": data_inicial, "dataFinal": data_final, "codigoModalidadeContratacao": modalidade,
         "pagina": pagina, "tamanhoPagina": tamanho}
    if uf:
        q["uf"] = uf
    url = PNCP_CONSULTA + "?" + urllib.parse.urlencode(q)
    try:
        bruto = _get(url)
        dados = json.loads(bruto) if bruto.strip() else {"data": [], "totalRegistros": 0}
        _resultado(db, "pncp", True, f"consulta ok: {url}")
        return {"url": url, "consultado_em": agora(), **dados}
    except Exception as ex:
        _resultado(db, "pncp", False, f"{type(ex).__name__}: {ex}")
        raise


def pncp_arquivos(db: Banco, cnpj: str, ano: int, seq: int) -> list[dict[str, Any]]:
    _circuito(db, "pncp")
    url = PNCP_ARQUIVOS.format(cnpj=cnpj, ano=ano, seq=seq)
    try:
        r = json.loads(_get(url) or b"[]")
        _resultado(db, "pncp", True, f"arquivos ok: {url}")
        return list(r)
    except Exception as ex:
        _resultado(db, "pncp", False, f"{type(ex).__name__}: {ex}")
        raise


def baixar(url: str, limite_mb: int = 60) -> bytes:
    if not url.startswith("https://pncp.gov.br/"):
        raise PermissionError("Download permitido apenas de fontes oficiais cadastradas (pncp.gov.br)")
    dados = _get(url, timeout=120)
    if len(dados) > limite_mb * 1024 * 1024:
        raise ValueError("Arquivo acima do limite")
    return dados


# ---------------------------------------------------------------- WhatsApp Cloud API (oficial Meta)
class WhatsApp:
    """Requer: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_GRAPH_VERSION (ex.: conferir a versão vigente na documentação da Meta)."""

    def __init__(self) -> None:
        self.token = os.getenv("WHATSAPP_TOKEN")
        self.phone_id = os.getenv("WHATSAPP_PHONE_ID")
        self.app_secret = os.getenv("WHATSAPP_APP_SECRET")
        self.verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN")
        self.versao = os.getenv("WHATSAPP_GRAPH_VERSION")

    @property
    def configurado(self) -> bool:
        return all([self.token, self.phone_id, self.app_secret, self.verify_token, self.versao])

    def faltando(self) -> list[str]:
        return [n for n, v in [("WHATSAPP_TOKEN", self.token), ("WHATSAPP_PHONE_ID", self.phone_id),
                               ("WHATSAPP_APP_SECRET", self.app_secret), ("WHATSAPP_VERIFY_TOKEN", self.verify_token),
                               ("WHATSAPP_GRAPH_VERSION", self.versao)] if not v]

    def assinatura_valida(self, corpo: bytes, cabecalho: str | None, segredo: str | None = None) -> bool:
        segredo = segredo or self.app_secret
        if not segredo or not cabecalho or not cabecalho.startswith("sha256="):
            return False
        esperado = hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
        return hmac.compare_digest(esperado, cabecalho.removeprefix("sha256="))

    def enviar(self, para: str, texto: str) -> dict[str, Any]:
        if not self.configurado:
            raise RuntimeError("WhatsApp não configurado: " + ", ".join(self.faltando()))
        url = f"https://graph.facebook.com/{self.versao}/{self.phone_id}/messages"
        corpo = json.dumps({"messaging_product": "whatsapp", "to": para, "type": "text",
                            "text": {"body": texto[:4000]}}).encode()
        req = urllib.request.Request(url, data=corpo, method="POST", headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            return dict(json.loads(r.read()))


def extrair_mensagens_whatsapp(payload: dict[str, Any]) -> list[dict[str, str]]:
    msgs = []
    for entry in payload.get("entry", []):
        for ch in entry.get("changes", []):
            for m in ch.get("value", {}).get("messages", []) or []:
                if m.get("type") == "text":
                    msgs.append({"id": m["id"], "de": m["from"], "texto": m["text"]["body"]})
    return msgs


# ---------------------------------------------------------------- Emissor fiscal
class EmissorFiscal:
    """Interface do emissor. Produção exige provedor autorizado (prefeitura/ADN NFS-e ou empresa
    emissora) e certificado no cofre. Sem configuração, NADA é transmitido."""

    nome = "nao_configurado"
    simulado = False

    def transmitir(self, nota: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("Emissor fiscal não configurado: nenhuma nota foi transmitida")

    def consultar(self, idempotency_key: str) -> dict[str, Any] | None:
        raise RuntimeError("Emissor fiscal não configurado")


class EmissorSimulado(EmissorFiscal):
    """Simulador LOCAL para testar o fluxo (retorno, rejeição, duplicidade).
    Notas por ele 'autorizadas' ficam com situação 'emitida_simulacao' — não têm valor fiscal."""

    nome = "simulador_local"
    simulado = True

    def __init__(self, rejeitar_se: str | None = None) -> None:
        self.registro: dict[str, dict[str, Any]] = {}
        self.rejeitar_se = rejeitar_se
        self.chamadas = 0

    def transmitir(self, nota: dict[str, Any]) -> dict[str, Any]:
        self.chamadas += 1
        if self.rejeitar_se and self.rejeitar_se in json.dumps(nota, default=str):
            return {"status": "rejeitada", "motivo": "SIMULADO: tomador sem inscrição municipal"}
        r = {"status": "autorizada", "numero": f"SIMULADO-{len(self.registro) + 1:06d}",
             "protocolo": hashlib.sha1(nota["idempotency_key"].encode()).hexdigest()[:12]}  # noqa: S324
        self.registro[nota["idempotency_key"]] = r
        return r

    def consultar(self, idempotency_key: str) -> dict[str, Any] | None:
        return self.registro.get(idempotency_key)


def emissor_configurado() -> EmissorFiscal:
    if os.getenv("ESCRITORIO_EMISSOR") == "simulador_local":
        return EmissorSimulado()
    return EmissorFiscal()


# ---------------------------------------------------------------- IA (opcional)
MODELO_COMPLEXO = "claude-opus-5-5"   # decisões, análise jurídica/técnica, redação de proposta
MODELO_SIMPLES = "claude-haiku-5-5"   # classificação e resumos curtos


class IA:
    """Camada de IA. Só ativa com credencial válida (ANTHROPIC_API_KEY). Sem ela, `disponivel` é False
    e os agentes respondem apenas com dados e cálculos determinísticos."""

    def __init__(self) -> None:
        self.chave = os.getenv("ANTHROPIC_API_KEY")

    @property
    def disponivel(self) -> bool:
        if not self.chave:
            return False
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False
        return True

    def responder(self, sistema: str, pergunta: str, contexto: str, complexo: bool = True) -> dict[str, Any]:
        import anthropic

        cliente = anthropic.Anthropic()
        modelo = MODELO_COMPLEXO if complexo else MODELO_SIMPLES
        # Contexto (documentos, mensagens) vai como dado delimitado, nunca como instrução.
        conteudo = (f"<dados_nao_confiaveis>\n{contexto}\n</dados_nao_confiaveis>\n\n"
                    f"Pergunta do administrador: {pergunta}")
        params: dict[str, Any] = {
            "model": modelo, "max_tokens": 16000, "system": sistema,
            "messages": [{"role": "user", "content": conteudo}],
            "output_config": {"effort": "high" if complexo else "low"},
        }
        if complexo:
            r = cliente.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
        else:
            r = cliente.messages.create(**params)
        if r.stop_reason == "refusal":
            return {"texto": "O modelo recusou a solicitação.", "modelo": modelo, "recusa": True}
        texto = "".join(b.text for b in r.content if b.type == "text")
        u = r.usage
        return {"texto": texto, "modelo": r.model, "tokens_entrada": u.input_tokens, "tokens_saida": u.output_tokens}


# ---------------------------------------------------------------- execução de ferramentas (sandbox)
COMANDOS_PERMITIDOS = {"pytest", "python", "git", "ruff", "npm", "node"}


def executar_sandbox(diretorio: str, comando: str, timeout: int = 300) -> dict[str, Any]:
    """Executa comando permitido em diretório autorizado, com ambiente mínimo (sem credenciais)."""
    raiz = Path(os.getenv("ESCRITORIO_SANDBOX_RAIZ", "/tmp")).resolve()  # noqa: S108
    alvo = Path(diretorio).resolve()
    if raiz not in alvo.parents and alvo != raiz:
        raise PermissionError(f"Diretório fora da área de sandbox autorizada ({raiz})")
    args = shlex.split(comando)
    if not args or Path(args[0]).name not in COMANDOS_PERMITIDOS:
        raise PermissionError(f"Comando não permitido: {args[:1]}")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(alvo), "LANG": "C.UTF-8",
           "PYTHONDONTWRITEBYTECODE": "1", "GIT_TERMINAL_PROMPT": "0"}
    inicio = agora()
    try:
        p = subprocess.run(args, cwd=alvo, env=env, capture_output=True, text=True, timeout=timeout, check=False)  # noqa: S603
        saida, codigo = (p.stdout + p.stderr)[-20000:], p.returncode
    except subprocess.TimeoutExpired:
        saida, codigo = f"TIMEOUT após {timeout}s", -1
    return {"comando": comando, "diretorio": str(alvo), "codigo_saida": codigo, "saida": saida,
            "sha256_saida": hashlib.sha256(saida.encode()).hexdigest(), "inicio": inicio, "fim": agora()}


def situacao_integracoes(db: Banco) -> list[dict[str, Any]]:
    w = WhatsApp()
    ia = IA()
    em = emissor_configurado()
    reg = {i["nome"]: i for i in db.todos("SELECT * FROM integracao")}
    pn = reg.get("pncp", {})
    wk = reg.get("worker", {})
    return [
        {"nome": "PNCP (editais oficiais)", "situacao": pn.get("situacao", "nao_verificado"),
         "detalhe": pn.get("detalhe") or "API pública de consulta; sem credencial", "verificado_em": pn.get("verificado_em")},
        {"nome": "WhatsApp Cloud API", "situacao": "configurado" if w.configurado else "nao_configurado",
         "detalhe": "Faltando: " + ", ".join(w.faltando()) if not w.configurado else "credenciais presentes (envio não testado)"},
        {"nome": "Emissor fiscal", "situacao": "simulado" if em.simulado else "nao_configurado",
         "detalhe": "Simulador local — sem valor fiscal" if em.simulado else "Nenhum provedor autorizado configurado"},
        {"nome": "IA (modelos Claude)", "situacao": "configurado" if ia.disponivel else "nao_configurado",
         "detalhe": f"{MODELO_COMPLEXO} / {MODELO_SIMPLES}" if ia.disponivel
         else "Sem ANTHROPIC_API_KEY: agentes operam só com regras determinísticas"},
        {"nome": "Worker de tarefas", "situacao": wk.get("situacao", "parado"), "detalhe": wk.get("detalhe"),
         "verificado_em": wk.get("verificado_em")},
        {"nome": "OCR", "situacao": "nao_instalado", "detalhe": "Instale tesseract-ocr + idioma por para ler digitalizados"},
        {"nome": "Repositórios Git (sandbox)", "situacao": "conectado",
         "detalhe": f"Execução local isolada em {os.getenv('ESCRITORIO_SANDBOX_RAIZ', '/tmp')}"},  # noqa: S108
    ]
