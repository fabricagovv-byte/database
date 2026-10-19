"""Busca editais no PNCP compatíveis com os serviços da DigitalGov e prepara os documentos
para gravar no banco do Escritório DigitalGov (claude.ai).

Uso: python scripts/pncp_digitalgov.py --saida /tmp/pncp --dias 2 [--existentes ids.txt] [--anterior HASH]
         [--palavras "a,b"] [--uf MG] [--detalhar]
Gera: <saida>/oportunidades__<id>.json (uma por edital novo), <saida>/textos__<id>.json (texto dos arquivos,
com --detalhar), <saida>/evento.json, <saida>/resumo.json
Requer: pip install pypdf (para --detalhar)
"""
import argparse, hashlib, json, re, time, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SERVICOS = [
    ("desenvolvimento de software,fábrica de software,sistema web,sistemas de informação,manutenção de sistema,aplicativo,software,ust,pontos de função,sustentação de sistemas", "medicamento,hospitalar,veículo,irrigação,cftv,videomonitoramento,engenharia elétrica"),
    ("licença de software,licenciamento de software,licença de uso,software de gestão,cessão de uso de software,saas", "cftv,videomonitoramento,imóvel,imóveis,cilindro,oxigênio"),
    ("consultoria em tecnologia da informação,governança de ti,serviços de tecnologia da informação,solução de tecnologia da informação", "proteção individual,conferência municipal"),
    ("hospedagem,computação em nuvem,cloud,datacenter,data center,tratamento de dados,backup", ""),
    ("microfilmagem,digitalização,gestão documental,gestão eletrônica de documentos,acervo,ocr,indexação", ""),
    ("outsourcing de impressão,locação de impressoras,locação de equipamentos de informática,reprografia,fotocópias,impressão departamental", ""),
]
RUIDO = ["sistema de registro de preços", "sistema de registro de preço", "registro de preços", "sistema único de saúde"]


EXTRA: list[str] = []


def aderencia(obj: str) -> tuple[int, list[str]]:
    t = " " + obj.lower() + " "
    if EXTRA:  # busca pedida: só as palavras informadas contam
        extra = [x for x in EXTRA if x and re.search(rf"\b{re.escape(x)}\b", t)]
        return (min(100, 40 * len(extra)), extra) if extra else (0, [])
    for r in RUIDO:
        t = t.replace(r, " ")
    p, casou = 0, []
    for pal, ex in SERVICOS:
        if any(x and re.search(rf"\b{re.escape(x)}\b", t) for x in ex.split(",")):
            continue
        for k in [x.strip() for x in pal.split(",") if x.strip()]:
            if re.search(rf"\b{re.escape(k)}\b", t):
                p += 40 if " " in k else 15
                casou.append(k)
    return min(100, p), casou


UA = {"User-Agent": "EscritorioDigitalGov/0.1"}


def _get(url: str, timeout: int = 60) -> bytes:
    for tent in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()  # noqa: S310
        except Exception:  # noqa: BLE001
            time.sleep(10 * (tent + 1))
    raise RuntimeError("PNCP indisponível: " + url)


def detalhar(cnpj: str, ano: int, seq: int) -> tuple[list[dict], list[dict], dict]:
    """Itens oficiais + texto dos arquivos (PDF) da contratação."""
    base = f"https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}"
    itens = []
    for pg in range(1, 11):
        lote = json.loads(_get(f"{base}/itens?pagina={pg}&tamanhoPagina=50") or b"[]")
        for i in lote:
            itens.append({k: i.get(k) for k in ("numeroItem", "descricao", "materialOuServicoNome", "quantidade",
                                                "unidadeMedida", "valorUnitarioEstimado", "valorTotal",
                                                "criterioJulgamentoNome", "tipoBeneficioNome", "orcamentoSigiloso")})
        if len(lote) < 50:
            break
        time.sleep(1)
    arquivos, partes, sem = [], [], []
    for a in json.loads(_get(f"{base}/arquivos") or b"[]"):
        if not a.get("statusAtivo", True):
            continue
        info = {"titulo": a.get("titulo"), "tipo": a.get("tipoDocumentoNome"), "url": a.get("url")}
        try:
            dados = _get(a["url"], timeout=120)
            if dados[:4] == b"%PDF" and len(dados) < 40 * 1024 * 1024:
                import io

                from pypdf import PdfReader
                r = PdfReader(io.BytesIO(dados))
                pags = [(p.extract_text() or "").strip() for p in r.pages]
                info["paginas"] = len(pags)
                vazias = [n for n, t in enumerate(pags, 1) if len(t) < 40]
                info["paginas_sem_texto"] = vazias
                sem += [f"{info['titulo']} p.{n}" for n in vazias]
                partes.append(f"=== ARQUIVO: {info['titulo']} ===\n" + "\n".join(f"[p.{n}] {t}" for n, t in enumerate(pags, 1)))
            else:
                info["obs"] = "não é PDF (ZIP/planilha/imagem): abrir no PNCP"
        except Exception as ex:  # noqa: BLE001
            info["obs"] = f"falha ao ler: {type(ex).__name__}"
        arquivos.append(info)
        time.sleep(1)
    texto = "\n".join(partes)[:3_000_000]
    return itens, arquivos, {"texto": texto, "paginas_sem_texto": sem[:200]}


def gravar_texto(out: Path, k: str, txt: dict) -> int:
    """Divide o texto em partes de até ~200 KB (limite de documento do banco)."""
    texto, partes, n = txt["texto"], [], 0
    while texto:
        corte = len(texto)
        while len(texto[:corte].encode()) > 200_000:
            corte = int(corte * 0.9)
        if corte < len(texto):
            nl = texto.rfind("\n[p.", 0, corte)
            corte = nl if nl > corte * 0.5 else corte
        partes.append(texto[:corte])
        texto = texto[corte:]
    for n, t in enumerate(partes, 1):
        (out / f"textos__op-{k}-{n}.json").write_text(json.dumps({"texto": t, "parte": n, "de": len(partes)}, ensure_ascii=False))
    (out / f"textos__op-{k}.json").write_text(json.dumps({"partes": len(partes), "paginas_sem_texto": txt["paginas_sem_texto"]},
                                                         ensure_ascii=False))
    return len(partes)


def canon(o):
    if isinstance(o, dict):
        return {k: canon(o[k]) for k in sorted(o)}
    if isinstance(o, list):
        return [canon(x) for x in o]
    return o


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--dias", type=int, default=2)
    ap.add_argument("--existentes", help="arquivo com ids já gravados (um por linha)")
    ap.add_argument("--anterior", default="0" * 64, help="hash do último evento do dia (encadeamento)")
    ap.add_argument("--palavras", default="", help="palavras extras pedidas na página, separadas por vírgula")
    ap.add_argument("--uf", default=None)
    ap.add_argument("--detalhar", action="store_true", help="baixar itens e texto dos arquivos de cada edital novo")
    a = ap.parse_args()
    EXTRA.extend(x.strip().lower() for x in a.palavras.split(",") if x.strip())
    out = Path(a.saida)
    out.mkdir(parents=True, exist_ok=True)
    existentes = set(Path(a.existentes).read_text().split()) if a.existentes else set()
    fim, ini = date.today(), date.today() - timedelta(days=a.dias)
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lidos, novos = 0, {}
    for mod in (6, 8, 4):
        for pg in range(1, (41 if EXTRA else 11)):
            prm = {"dataInicial": ini.strftime("%Y%m%d"), "dataFinal": fim.strftime("%Y%m%d"),
                   "codigoModalidadeContratacao": mod, "pagina": pg, "tamanhoPagina": 50}
            if a.uf:
                prm["uf"] = a.uf
            q = urllib.parse.urlencode(prm)
            d = None
            for tent in range(4):
                try:
                    req = urllib.request.Request("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?" + q,
                                                 headers={"User-Agent": "EscritorioDigitalGov/0.1"})
                    corpo = urllib.request.urlopen(req, timeout=60).read()  # noqa: S310
                    d = json.loads(corpo) if corpo.strip() else {"data": []}
                    break
                except Exception:  # noqa: BLE001
                    time.sleep(15 * (tent + 1))
            if d is None:
                break
            for it in d.get("data", []):
                lidos += 1
                ad, casou = aderencia(it.get("objetoCompra") or "")
                if ad < 30:
                    continue
                k = re.sub(r"[^A-Za-z0-9_]", "_", it["numeroControlePNCP"])
                if k in existentes:
                    continue
                org, un = it["orgaoEntidade"], it["unidadeOrgao"]
                novos[k] = {"objeto": it["objetoCompra"], "orgao": org["razaoSocial"], "uf": un["ufSigla"],
                            "municipio": un["municipioNome"], "valor_estimado": str(it.get("valorTotalEstimado") or ""),
                            "modalidade": it.get("modalidadeNome"),
                            "data_sessao": (it.get("dataEncerramentoProposta") or "")[:10] or None,
                            "link": f'https://pncp.gov.br/app/editais/{org["cnpj"]}/{it["anoCompra"]}/{it["sequencialCompra"]}',
                            "fonte": "pncp", "id_pncp": it["numeroControlePNCP"], "aderencia": ad, "palavras": casou,
                            "situacao": "encontrada", "criado_em": agora,
                            "_ref": [org["cnpj"], it["anoCompra"], it["sequencialCompra"]]}
            if pg >= int(d.get("totalPaginas") or 1):
                break
            time.sleep(2)
    for k, v in novos.items():
        ref = v.pop("_ref")
        if a.detalhar:
            try:
                itens, arqs, txt = detalhar(*ref)
                v["itens"], v["arquivos"] = itens[:300], arqs
                v["leitura"] = "completa" if txt["texto"] and not txt["paginas_sem_texto"] else (
                    "incompleta" if txt["texto"] else "sem texto")
                v["texto_partes"] = gravar_texto(out, k, txt)
            except Exception as ex:  # noqa: BLE001
                v["detalhe_erro"] = f"{type(ex).__name__}: {ex}"[:200]
        (out / f"oportunidades__{k}.json").write_text(json.dumps(v, ensure_ascii=False))
    item = {"em": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "tipo": "pncp.busca", "ator": "agente:buscador-de-editais",
            "resumo": f"Rotina diária PNCP {ini}→{fim}: {lidos} publicações lidas, {len(novos)} novas compatíveis"}
    item["hash"] = hashlib.sha256((a.anterior + json.dumps(canon(item), ensure_ascii=False, separators=(",", ":"))).encode()).hexdigest()
    item["anterior"] = a.anterior
    (out / "evento.json").write_text(json.dumps(item, ensure_ascii=False))
    (out / "resumo.json").write_text(json.dumps({"lidos": lidos, "novos": list(novos)}, ensure_ascii=False))
    print(json.dumps({"lidos": lidos, "novos": len(novos), "ids": list(novos)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
