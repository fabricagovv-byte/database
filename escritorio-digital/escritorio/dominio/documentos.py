"""Leitura de documentos, classificação e extração de requisitos com referência de página.

Método atual: extração de texto + regras léxicas (determinístico). Não é IA. Onde não há texto
extraível (página escaneada), a leitura é marcada como INCOMPLETA — OCR não está instalado.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

MIN_CHARS_PAGINA = 40

ASSINATURAS = {
    b"%PDF": "application/pdf",
    b"PK\x03\x04": "application/zip",
    b"\x89PNG": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
}


def detectar_mime(conteudo: bytes, nome: str) -> str:
    for ass, mime in ASSINATURAS.items():
        if conteudo.startswith(ass):
            if mime == "application/zip" and nome.lower().endswith(".xlsx"):
                return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            return mime
    if nome.lower().endswith((".txt", ".md", ".csv")):
        return "text/plain"
    return "application/octet-stream"


@dataclass
class Leitura:
    mime: str
    sha256: str
    paginas: list[str] = field(default_factory=list)
    paginas_sem_texto: list[int] = field(default_factory=list)
    alertas: list[str] = field(default_factory=list)
    arquivos_internos: list[str] = field(default_factory=list)

    @property
    def completa(self) -> bool:
        return not self.paginas_sem_texto and not self.alertas


def ler(conteudo: bytes, nome: str) -> Leitura:
    mime = detectar_mime(conteudo, nome)
    lt = Leitura(mime=mime, sha256=hashlib.sha256(conteudo).hexdigest())
    if mime == "application/pdf":
        try:
            from pypdf import PdfReader

            r = PdfReader(io.BytesIO(conteudo))
            if r.is_encrypted:
                lt.alertas.append("PDF protegido por senha: conteúdo não lido")
                return lt
            for i, p in enumerate(r.pages, start=1):
                t = (p.extract_text() or "").strip()
                lt.paginas.append(t)
                if len(t) < MIN_CHARS_PAGINA:
                    lt.paginas_sem_texto.append(i)
        except Exception as ex:
            lt.alertas.append(f"PDF ilegível ou corrompido: {type(ex).__name__}")
        if lt.paginas_sem_texto:
            lt.alertas.append(
                f"Páginas sem texto extraível (provável digitalização): {lt.paginas_sem_texto}. "
                "OCR não instalado neste servidor — leitura INCOMPLETA."
            )
    elif mime == "application/zip":
        try:
            with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
                for info in z.infolist():
                    if info.file_size > 200 * 1024 * 1024 or ".." in info.filename or info.filename.startswith("/"):
                        lt.alertas.append(f"Arquivo suspeito ignorado no ZIP: {info.filename}")
                        continue
                    lt.arquivos_internos.append(info.filename)
            lt.alertas.append("ZIP: envie os arquivos internos individualmente para leitura (extração automática pendente)")
        except zipfile.BadZipFile:
            lt.alertas.append("ZIP corrompido")
    elif mime == "text/plain":
        texto = conteudo.decode("utf-8", errors="replace")
        lt.paginas = [p for p in texto.split("\f")] or [texto]
    elif mime.startswith("image/"):
        lt.paginas = [""]
        lt.paginas_sem_texto = [1]
        lt.alertas.append("Imagem recebida: OCR não instalado — conteúdo não lido")
    else:
        lt.alertas.append(f"Tipo de arquivo não suportado: {mime}")
    return lt


# ---------------------------------------------------------------- classificação
CLASSES = [
    ("retificacao", [r"retifica[çc][ãa]o", r"errata"]),
    ("edital", [r"\bedital\b", r"preg[ãa]o eletr[ôo]nico", r"concorr[êe]ncia", r"termo de refer[êe]ncia"]),
    ("contrato", [r"\bcontrato n", r"cl[áa]usula primeira", r"contratante", r"contratada"]),
    ("ata", [r"\bata\b", r"registro de pre[çc]os"]),
    ("certidao", [r"certid[ãa]o", r"regularidade fiscal", r"\bcnd\b", r"fgts"]),
    ("atestado", [r"atestado de capacidade", r"atestamos"]),
    ("balanco", [r"balan[çc]o patrimonial", r"demonstra[çc][ãa]o do resultado"]),
    ("proposta", [r"proposta comercial", r"proposta de pre[çc]os"]),
]


def classificar(texto: str) -> tuple[str, str]:
    t = texto.lower()[:20000]
    cabecalho = t[:300]  # o título do documento pesa mais que menções no corpo
    pontos = {c: sum(len(re.findall(p, t)) + 5 * len(re.findall(p, cabecalho)) for p in pads) for c, pads in CLASSES}
    melhor = max(pontos, key=lambda k: pontos[k])
    if pontos[melhor] == 0:
        return "outro", "baixa"
    ordenados = sorted(pontos.values(), reverse=True)
    conf = "alta" if ordenados[0] >= 3 and ordenados[0] >= 2 * max(ordenados[1], 1) else "media"
    return melhor, conf


# ---------------------------------------------------------------- extração de requisitos
@dataclass
class Requisito:
    categoria: str  # habilitacao_documental | capacidade_tecnica | capacidade_operacional | financeiro | contratual
    chave: str
    descricao: str
    pagina: int
    trecho: str
    valor_exigido: str | None = None


PADROES: list[tuple[str, str, str, str]] = [
    # (categoria, chave, regex, descrição)
    ("habilitacao_documental", "certidao_federal", r"(receita federal|d[íi]vida ativa da uni[ãa]o|tributos federais)", "Certidão de regularidade fiscal federal"),
    ("habilitacao_documental", "certidao_fgts", r"\bfgts\b", "Certificado de regularidade do FGTS"),
    ("habilitacao_documental", "certidao_trabalhista", r"(\bcndt\b|d[ée]bitos trabalhistas)", "Certidão negativa de débitos trabalhistas"),
    ("habilitacao_documental", "certidao_estadual", r"fazenda estadual", "Certidão de regularidade estadual"),
    ("habilitacao_documental", "certidao_municipal", r"fazenda municipal", "Certidão de regularidade municipal"),
    ("habilitacao_documental", "certidao_falencia", r"(fal[êe]ncia|recupera[çc][ãa]o judicial)", "Certidão negativa de falência"),
    ("habilitacao_documental", "contrato_social", r"(ato constitutivo|contrato social|estatuto social)", "Ato constitutivo / contrato social"),
    ("financeiro", "balanco", r"balan[çc]o patrimonial", "Balanço patrimonial do último exercício"),
    ("financeiro", "indices_liquidez", r"(liquidez geral|liquidez corrente|solv[êe]ncia geral)", "Índices de liquidez (LG, LC, SG)"),
    ("financeiro", "patrimonio_liquido", r"patrim[ôo]nio l[íi]quido m[íi]nimo[^.]{0,80}", "Patrimônio líquido mínimo"),
    ("financeiro", "capital_social", r"capital social m[íi]nimo[^.]{0,80}", "Capital social mínimo"),
    ("capacidade_tecnica", "atestado_capacidade", r"atestado[s]? de capacidade t[ée]cnica", "Atestado(s) de capacidade técnica"),
    ("capacidade_tecnica", "registro_conselho", r"\b(crea|cau|crc|cra)\b", "Registro no conselho profissional"),
    ("capacidade_tecnica", "responsavel_tecnico", r"respons[áa]vel t[ée]cnico", "Responsável técnico indicado"),
    ("capacidade_tecnica", "certificacao", r"certifica[çc][ãa]o (iso|itil|pmp|cobit|[a-z]+ certified)", "Certificação exigida"),
    ("capacidade_operacional", "equipe_minima", r"equipe m[íi]nima", "Equipe mínima"),
    ("capacidade_operacional", "prazo_execucao", r"prazo de (execu[çc][ãa]o|entrega|implanta[çc][ãa]o)[^.]{0,80}", "Prazo de execução/entrega"),
    ("capacidade_operacional", "sla", r"(acordo de n[íi]vel de servi[çc]o|\bsla\b|n[íi]vel m[íi]nimo de servi[çc]o)", "Níveis de serviço (SLA)"),
    ("contratual", "garantia_contratual", r"garantia (contratual|de execu[çc][ãa]o)[^.]{0,80}", "Garantia contratual"),
    ("contratual", "multa", r"multa[^.]{0,80}%", "Multas e penalidades"),
    ("contratual", "medicao", r"(medi[çc][ãa]o|ordem de servi[çc]o|\bust\b|pontos? de fun[çc][ãa]o)", "Regra de medição"),
    ("contratual", "pagamento", r"pagamento[^.]{0,40}(dias|prazo)[^.]{0,60}", "Prazo de pagamento"),
    ("contratual", "subcontratacao", r"subcontrata[çc][ãa]o", "Regras de subcontratação"),
    ("contratual", "lgpd", r"(\blgpd\b|lei n?[ºo°.]* ?13\.709|prote[çc][ãa]o de dados)", "Proteção de dados (LGPD)"),
]

RE_VALOR = re.compile(r"R\$\s?([\d.]+,\d{2})")
RE_PCT = re.compile(r"(\d{1,3}(?:,\d+)?)\s?%")
RE_DATA_SESSAO = re.compile(
    r"(?i)(sess[ãa]o p[úu]blica|abertura)[^.\n]{0,80}?(\d{2}/\d{2}/\d{4})[^.\n]{0,20}?(\d{1,2}[:h]\d{2})?"
)


def _trecho(texto: str, ini: int, fim: int) -> str:
    a = max(0, ini - 90)
    b = min(len(texto), fim + 160)
    return re.sub(r"\s+", " ", texto[a:b]).strip()


def extrair_requisitos(paginas: list[str]) -> list[Requisito]:
    vistos: set[str] = set()
    saida: list[Requisito] = []
    for n, texto in enumerate(paginas, start=1):
        for cat, chave, rx, desc in PADROES:
            if chave in vistos:
                continue
            m = re.search(rx, texto, flags=re.IGNORECASE)
            if not m:
                continue
            vistos.add(chave)
            trecho = _trecho(texto, m.start(), m.end())
            valor = None
            if chave in ("patrimonio_liquido", "capital_social", "garantia_contratual", "multa"):
                mv = RE_VALOR.search(trecho) or RE_PCT.search(trecho)
                valor = mv.group(0) if mv else None
            saida.append(Requisito(cat, chave, desc, n, trecho, valor))
    return saida


def extrair_metadados(paginas: list[str]) -> dict[str, Any]:
    texto = "\n".join(paginas)
    meta: dict[str, Any] = {}
    m = re.search(r"(?i)objeto[:\s-]+(.{20,300}?)(?:\.\s|\n\n)", texto)
    if m:
        meta["objeto"] = re.sub(r"\s+", " ", m.group(1)).strip()
    m = RE_DATA_SESSAO.search(texto)
    if m:
        meta["sessao"] = {"data": m.group(2), "hora": m.group(3), "texto": m.group(0)[:160]}
    m = re.search(r"(?i)valor (total )?estimado[^R]{0,40}(R\$\s?[\d.]+,\d{2})", texto)
    if m:
        meta["valor_estimado"] = m.group(2)
    m = re.search(r"(?i)hor[áa]rio (oficial )?de (bras[íi]lia|[a-z]+)", texto)
    if m:
        meta["fuso_texto"] = m.group(0)
    return meta


def diff_versoes(antigas: list[str], novas: list[str]) -> list[dict[str, Any]]:
    """Comparação por página para retificações (linhas adicionadas/removidas)."""
    import difflib

    mudancas = []
    for i in range(max(len(antigas), len(novas))):
        a = antigas[i] if i < len(antigas) else ""
        b = novas[i] if i < len(novas) else ""
        if a == b:
            continue
        d = [ln for ln in difflib.unified_diff(a.splitlines(), b.splitlines(), lineterm="", n=0)
             if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
        mudancas.append({"pagina": i + 1, "alteracoes": d[:40]})
    return mudancas
