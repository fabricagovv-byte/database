"""Matriz de conformidade: requisito do edital × evidência cadastrada da empresa."""

from __future__ import annotations

from datetime import date
from typing import Any

ATENDE = "atende"
CONDICOES = "atende_com_condicoes"
NAO = "nao_atende"
INSUF = "informacao_insuficiente"

RESPONSAVEL = {
    "habilitacao_documental": "agente:analista-habilitacao",
    "capacidade_tecnica": "agente:analista-qualificacao-tecnica",
    "capacidade_operacional": "agente:gestor-capacidade",
    "financeiro": "agente:analista-economico-financeiro",
    "contratual": "agente:assistente-juridico-licitacoes",
}


def _validade(d: dict[str, Any]) -> date | None:
    return date.fromisoformat(d["validade"]) if d.get("validade") else None


def avaliar(
    requisitos: list[dict[str, Any]],
    documentos_empresa: list[dict[str, Any]],
    funcionarios: list[dict[str, Any]],
    data_sessao: date | None,
    hoje: date,
) -> list[dict[str, Any]]:
    ref = data_sessao or hoje
    por_tipo: dict[str, list[dict[str, Any]]] = {}
    for d in documentos_empresa:
        por_tipo.setdefault(d["tipo"], []).append(d)

    linhas = []
    for r in requisitos:
        cat, chave = r["categoria"], r["chave"]
        sit, evid, pend = INSUF, None, None
        docs = sorted(por_tipo.get(chave, []), key=lambda d: d.get("validade") or "", reverse=True)

        if cat == "habilitacao_documental" or chave == "balanco":
            if not docs:
                sit, pend = NAO, f"Cadastrar documento: {r['descricao']}"
            else:
                d = docs[0]
                v = _validade(d)
                evid = f"documento #{d['id']} '{d['titulo']}'" + (f" válido até {v.isoformat()}" if v else "")
                if v is None:
                    sit, pend = (CONDICOES, "Validade não informada — confirmar") if chave != "balanco" else (
                        CONDICOES, "Conferir exercício e índices com o contador")
                elif v < ref:
                    sit, pend = NAO, f"Vencido em {v.isoformat()} (sessão/referência {ref.isoformat()}). Renovar."
                elif v < hoje:
                    sit, pend = NAO, f"Vencido em {v.isoformat()}. Renovar."
                else:
                    sit = ATENDE
                if d.get("validacao") != "validado" and sit == ATENDE:
                    sit, pend = CONDICOES, "Documento cadastrado mas ainda não validado por responsável"
        elif chave in ("patrimonio_liquido", "capital_social", "indices_liquidez"):
            sit, pend = INSUF, (
                f"Exigência: {r.get('valor_exigido') or 'ver trecho'}. Informar o valor do último balanço "
                "para comparação determinística.")
        elif chave == "atestado_capacidade":
            if docs:
                sit = CONDICOES
                evid = ", ".join(f"#{d['id']} {d['titulo']}" for d in docs)
                pend = "Conferir compatibilidade de objeto e quantitativos dos atestados com o exigido"
            else:
                sit, pend = NAO, "Nenhum atestado de capacidade técnica cadastrado"
        elif chave in ("registro_conselho", "responsavel_tecnico"):
            com_registro = [f for f in funcionarios if f.get("registro_profissional")]
            if com_registro:
                sit = CONDICOES
                evid = ", ".join(f"{f['nome']} ({f['registro_profissional']})" for f in com_registro)
                pend = "Confirmar se o conselho/registro corresponde ao exigido e se há vínculo comprovável"
            else:
                sit, pend = NAO, "Nenhum profissional com registro cadastrado"
        elif cat == "capacidade_operacional":
            livres = sum(max(f["horas_mes"] - f["horas_alocadas"], 0) for f in funcionarios)
            if chave == "equipe_minima":
                sit = CONDICOES if livres > 0 else NAO
                evid = f"{len(funcionarios)} pessoas cadastradas, {livres} h/mês livres"
                pend = "Comparar perfis e quantidades da equipe mínima do edital"
            else:
                sit, pend = CONDICOES, "Verificar se o prazo/SLA é exequível com a capacidade atual"
        elif cat == "contratual":
            sit, pend = CONDICOES, "Risco contratual identificado: revisão jurídica (profissional habilitado)"
        elif docs:
            sit, evid = CONDICOES, ", ".join(f"#{d['id']}" for d in docs)
        linhas.append({
            "requisito_id": r["id"], "categoria": cat, "requisito": r["descricao"],
            "origem": f"doc #{r.get('documento_id')} p.{r.get('pagina')}", "trecho": r.get("trecho"),
            "situacao": sit, "evidencia": evid, "pendencia": pend,
            "responsavel": RESPONSAVEL.get(cat, "agente:orquestrador-geral"),
            "prazo": data_sessao.isoformat() if data_sessao and sit != ATENDE else None,
        })
    return linhas


def resumo(linhas: list[dict[str, Any]]) -> dict[str, Any]:
    cont: dict[str, int] = {}
    for x in linhas:
        cont[x["situacao"]] = cont.get(x["situacao"], 0) + 1
    if cont.get(NAO):
        parecer = "nao_pode_participar_sem_sanar_pendencias"
    elif cont.get(INSUF) or cont.get(CONDICOES):
        parecer = "pode_participar_com_condicoes"
    else:
        parecer = "apto"
    return {"contagem": cont, "parecer_habilitacao": parecer}
