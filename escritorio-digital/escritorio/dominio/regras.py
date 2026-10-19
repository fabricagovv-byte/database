"""Regras puras: estados de tarefa, aprovações por hash de versão, permissões e autonomia."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

# ---------------------------------------------------------------- estados de tarefa
TRANSICOES: dict[str, set[str]] = {
    "criada": {"triada", "cancelada"},
    "triada": {"planejada", "cancelada", "bloqueada"},
    "planejada": {"aguardando_aprovacao", "pronta", "cancelada", "bloqueada"},
    "aguardando_aprovacao": {"pronta", "cancelada", "bloqueada"},
    "pronta": {"executando", "pausada", "cancelada", "bloqueada"},
    "executando": {"em_revisao", "falhou", "pronta", "pausada", "bloqueada", "cancelada"},
    "em_revisao": {"aguardando_aceite", "concluida", "pronta", "falhou"},
    "aguardando_aceite": {"concluida", "pronta"},
    "falhou": {"pronta", "cancelada"},
    "bloqueada": {"pronta", "planejada", "cancelada"},
    "pausada": {"pronta", "cancelada"},
    "concluida": set(),
    "cancelada": set(),
}


class TransicaoInvalida(ValueError):
    pass


def validar_transicao(de: str, para: str) -> None:
    if para not in TRANSICOES.get(de, set()):
        raise TransicaoInvalida(f"Transição não permitida: {de} → {para}")


def pode_concluir(evidencias: list[Any]) -> bool:
    """Tarefa só conclui com ao menos uma evidência verificável."""
    return bool(evidencias)


# ---------------------------------------------------------------- aprovações
def hash_versao(conteudo: dict[str, Any]) -> str:
    canon = json.dumps(conteudo, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(canon.encode()).hexdigest()


# Ações que sempre exigem aprovação explícita de humano autorizado.
ACOES_APROVACAO_EXPLICITA = {
    "enviar_proposta", "dar_lance", "assinar", "comprar", "contratar_fornecedor", "pagar",
    "emitir_nota", "compartilhar_sensivel", "mudar_escopo", "publicar_producao", "participar_licitacao",
    "iniciar_execucao",
}
ACOES_PROIBIDAS = {
    "falsificar_documento", "combinar_precos", "adulterar_evidencia", "acesso_nao_autorizado",
    "ampliar_permissao_propria", "apagar_auditoria",
}
# Autonomia operacional (sem aprovação): leitura, análise, rascunho, classificação, testes em sandbox.
ACOES_AUTONOMAS = {
    "ler", "analisar", "rascunhar", "classificar", "testar_sandbox", "alterar_branch_isolada",
    "notificar_interno", "consultar_publico",
}


class AprovacaoInvalida(PermissionError):
    pass


def checar_aprovacao(aprov: dict[str, Any] | None, acao: str, objeto_tipo: str, objeto_id: int,
                     hash_atual: str, agora: datetime, executor: str) -> None:
    """Levanta erro se a aprovação não cobre exatamente esta ação e esta versão."""
    if acao in ACOES_PROIBIDAS:
        raise AprovacaoInvalida(f"Ação proibida: {acao}")
    if acao not in ACOES_APROVACAO_EXPLICITA:
        return
    if aprov is None:
        raise AprovacaoInvalida(f"Ação '{acao}' exige aprovação explícita")
    if aprov["situacao"] != "aprovada":
        raise AprovacaoInvalida(f"Aprovação #{aprov['id']} está '{aprov['situacao']}'")
    if (aprov["acao"], aprov["objeto_tipo"], int(aprov["objeto_id"])) != (acao, objeto_tipo, int(objeto_id)):
        raise AprovacaoInvalida("Aprovação refere-se a outra ação ou objeto")
    if aprov["hash"] != hash_atual:
        raise AprovacaoInvalida(
            "O conteúdo mudou depois da aprovação (versão aprovada difere da atual). Nova aprovação necessária."
        )
    if aprov.get("validade") and datetime.fromisoformat(aprov["validade"]) < agora:
        raise AprovacaoInvalida("Aprovação expirada")
    if aprov.get("consumido_em"):
        raise AprovacaoInvalida("Aprovação já utilizada (uso único)")
    aprovador = f"usuario:{aprov.get('aprovador_id')}"
    if executor == aprovador or aprov.get("solicitante") == aprovador:
        raise AprovacaoInvalida("Separação de funções: solicitante/executor não pode ser o aprovador")


# ---------------------------------------------------------------- papéis
PAPEIS = {
    "admin": {"*"},
    "gestor": {"ler", "operar", "aprovar_operacional"},
    "financeiro": {"ler", "financeiro"},
    "operador": {"ler", "operar"},
    "fornecedor": {"portal_fornecedor"},
    "leitor": {"ler"},
}


def tem_permissao(papel: str, permissao: str) -> bool:
    p = PAPEIS.get(papel, set())
    return "*" in p or permissao in p


# ---------------------------------------------------------------- severidade de chamado
def classificar_severidade(descricao: str, regras_sla: dict[str, Any] | None) -> tuple[str, str]:
    """Classifica pela regra do contrato (palavras-chave → severidade). Sem regra: 'a_classificar'."""
    t = descricao.lower()
    for sev, palavras in (regras_sla or {}).get("severidade_por_palavra", {}).items():
        if any(p in t for p in palavras):
            return sev, f"regra do contrato: palavra-chave de '{sev}'"
    return "a_classificar", "nenhuma regra do contrato casou; triagem humana necessária"
