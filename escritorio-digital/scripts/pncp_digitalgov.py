"""Busca editais no PNCP compatíveis com os serviços da DigitalGov e prepara os documentos
para gravar no banco do Escritório DigitalGov (claude.ai).

Uso: python scripts/pncp_digitalgov.py --saida /tmp/pncp --dias 2 [--existentes ids.txt] [--anterior HASH]
Gera: <saida>/oportunidades__<id>.json (uma por edital novo), <saida>/evento.json, <saida>/resumo.json
"""
import argparse, hashlib, json, re, time, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SERVICOS = [
    ("desenvolvimento de software,fábrica de software,sistema web,sistemas de informação,manutenção de sistema,aplicativo,software,ust,pontos de função,sustentação de sistemas", "medicamento,hospitalar,veículo,irrigação,cftv,videomonitoramento,engenharia elétrica"),
    ("licença de software,licenciamento de software,licença de uso,software de gestão,cessão de uso,saas", "cftv,videomonitoramento"),
    ("consultoria em tecnologia da informação,governança de ti,serviços de tecnologia da informação,solução de tecnologia da informação", "proteção individual,conferência municipal"),
    ("hospedagem,computação em nuvem,cloud,datacenter,data center,tratamento de dados,backup", ""),
    ("microfilmagem,digitalização,gestão documental,gestão eletrônica de documentos,acervo,ocr,indexação", ""),
    ("outsourcing de impressão,locação de impressoras,locação de equipamentos de informática,reprografia,fotocópias,impressão departamental", ""),
]
RUIDO = ["sistema de registro de preços", "sistema de registro de preço", "registro de preços", "sistema único de saúde"]


def aderencia(obj: str) -> tuple[int, list[str]]:
    t = " " + obj.lower() + " "
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
    a = ap.parse_args()
    out = Path(a.saida)
    out.mkdir(parents=True, exist_ok=True)
    existentes = set(Path(a.existentes).read_text().split()) if a.existentes else set()
    fim, ini = date.today(), date.today() - timedelta(days=a.dias)
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lidos, novos = 0, {}
    for mod in (6, 8, 4):
        for pg in range(1, 11):
            q = urllib.parse.urlencode({"dataInicial": ini.strftime("%Y%m%d"), "dataFinal": fim.strftime("%Y%m%d"),
                                        "codigoModalidadeContratacao": mod, "pagina": pg, "tamanhoPagina": 50})
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
                            "situacao": "encontrada", "criado_em": agora}
            if pg >= int(d.get("totalPaginas") or 1):
                break
            time.sleep(2)
    for k, v in novos.items():
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
