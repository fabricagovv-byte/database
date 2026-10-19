from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from escritorio.agentes import CATALOGO, formar_squad, montar_catalogo, tipo_objeto
from escritorio.dominio import conformidade, documentos
from escritorio.dominio.financeiro import (
    EntradaViabilidade,
    RegraTributo,
    analisar_viabilidade,
    formar_preco,
    tributos_aplicaveis,
)
from escritorio.dominio.regras import AprovacaoInvalida, TransicaoInvalida, checar_aprovacao, hash_versao, validar_transicao
from tests.pdf_teste import edital_teste


def regra(nome="ISS", pct="5", validado=True, fim=None):
    return RegraTributo(nome, Decimal(pct), date(2026, 1, 1), fim, "teste", validado)


def test_preco_por_divisor():
    assert formar_preco(Decimal(800), Decimal(10), Decimal(10)) == Decimal(1000)
    with pytest.raises(ValueError):
        formar_preco(Decimal(1), Decimal(60), Decimal(40))


def test_tributo_sem_regra_e_provisorio():
    r = tributos_aplicaveis([], "servico", date(2026, 10, 1))
    assert r.provisorio and r.aliquota_total_pct == 0
    r2 = tributos_aplicaveis([regra(validado=False)], "servico", date(2026, 10, 1))
    assert r2.provisorio and "sem validação" in r2.alertas[0]
    r3 = tributos_aplicaveis([regra(fim=date(2026, 6, 30))], "servico", date(2026, 10, 1))
    assert r3.aliquota_total_pct == 0  # regra fora da vigência não se aplica


def _entrada(**kw):
    base = dict(custos_diretos=[{"descricao": "dev", "valor": "100000", "origem": "x"}], indiretos_pct=Decimal(10),
                margem_alvo_pct=Decimal(15), margem_minima_pct=Decimal(10),
                tributos=tributos_aplicaveis([regra(pct="11.33")], "servico", date(2026, 10, 1)), duracao_meses=12,
                prazo_recebimento_dias=60, prazo_pagamento_fornecedor_dias=0, capital_giro_disponivel=Decimal(50000))
    base.update(kw)
    return EntradaViabilidade(**base)


def test_viabilidade_margem_e_capital_de_giro():
    r = analisar_viabilidade(_entrada())
    assert r["custo_total"] == "110000.00"
    assert Decimal(r["margem_pct"]) == Decimal("15.00")
    # recebe 2 meses depois de pagar: precisa ~2 meses de custo líquido
    assert Decimal(r["capital_giro_necessario"]) > Decimal(15000)
    assert r["recomendacao"] == "recomendado"


def test_viabilidade_margem_abaixo_da_minima():
    r = analisar_viabilidade(_entrada(preco_proposto=Decimal(130000)))
    assert r["recomendacao"] == "nao_recomendado"
    assert any("abaixo da mínima" in a for a in r["alertas"])


def test_viabilidade_sem_capital_de_giro():
    r = analisar_viabilidade(_entrada(capital_giro_disponivel=Decimal(0)))
    assert r["recomendacao"] == "recomendado_com_condicoes"
    assert any("Capital de giro" in a for a in r["alertas"])


def test_transicoes():
    validar_transicao("pronta", "executando")
    with pytest.raises(TransicaoInvalida):
        validar_transicao("criada", "concluida")


def _aprov(**kw):
    a = {"id": 1, "acao": "emitir_nota", "objeto_tipo": "nota_fiscal", "objeto_id": 5, "hash": hash_versao({"v": 1}),
         "situacao": "aprovada", "validade": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
         "consumido_em": None, "aprovador_id": 1, "solicitante": "agente:x"}
    a.update(kw)
    return a


def test_aprovacao_vinculada_a_versao():
    agora = datetime.now(UTC)
    checar_aprovacao(_aprov(), "emitir_nota", "nota_fiscal", 5, hash_versao({"v": 1}), agora, "sistema:x")
    with pytest.raises(AprovacaoInvalida, match="mudou"):
        checar_aprovacao(_aprov(), "emitir_nota", "nota_fiscal", 5, hash_versao({"v": 2}), agora, "sistema:x")
    with pytest.raises(AprovacaoInvalida, match="expirada"):
        checar_aprovacao(_aprov(validade=(agora - timedelta(1)).isoformat()), "emitir_nota", "nota_fiscal", 5,
                         hash_versao({"v": 1}), agora, "sistema:x")
    with pytest.raises(AprovacaoInvalida, match="já utilizada"):
        checar_aprovacao(_aprov(consumido_em="x"), "emitir_nota", "nota_fiscal", 5, hash_versao({"v": 1}), agora, "s:x")
    with pytest.raises(AprovacaoInvalida, match="outra ação"):
        checar_aprovacao(_aprov(), "pagar", "nota_fiscal", 5, hash_versao({"v": 1}), agora, "sistema:x")
    with pytest.raises(AprovacaoInvalida, match="proibida"):
        checar_aprovacao(None, "ampliar_permissao_propria", "agente", 1, "", agora, "agente:x")
    with pytest.raises(AprovacaoInvalida, match="Separação"):
        checar_aprovacao(_aprov(), "emitir_nota", "nota_fiscal", 5, hash_versao({"v": 1}), agora, "usuario:1")


def test_leitura_pdf_detecta_pagina_sem_texto_e_requisitos():
    lt = documentos.ler(edital_teste(), "edital.pdf")
    assert lt.mime == "application/pdf" and len(lt.paginas) == 4
    assert lt.paginas_sem_texto == [4] and not lt.completa
    assert documentos.classificar("\n".join(lt.paginas))[0] == "edital"
    reqs = {r.chave: r for r in documentos.extrair_requisitos(lt.paginas)}
    for chave in ("certidao_federal", "certidao_fgts", "certidao_trabalhista", "balanco", "atestado_capacidade",
                  "equipe_minima", "sla", "medicao", "pagamento", "garantia_contratual", "lgpd", "subcontratacao"):
        assert chave in reqs, chave
    assert reqs["certidao_fgts"].pagina == 2 and reqs["sla"].pagina == 3
    meta = documentos.extrair_metadados(lt.paginas)
    assert meta["sessao"]["data"] == "20/12/2026" and meta["valor_estimado"] == "R$ 480.000,00"


def test_arquivo_invalido_e_zip():
    assert documentos.ler(b"%PDF-1.4 lixo", "x.pdf").alertas
    assert "não suportado" in documentos.ler(b"\x00\x01", "x.bin").alertas[0]


def test_conformidade_documento_vencido():
    reqs = [{"id": 1, "categoria": "habilitacao_documental", "chave": "certidao_fgts", "descricao": "FGTS"},
            {"id": 2, "categoria": "habilitacao_documental", "chave": "certidao_federal", "descricao": "Federal"},
            {"id": 3, "categoria": "capacidade_tecnica", "chave": "atestado_capacidade", "descricao": "Atestado"}]
    docs = [{"id": 9, "tipo": "certidao_fgts", "titulo": "CRF", "validade": "2026-11-01", "validacao": "validado"},
            {"id": 8, "tipo": "certidao_federal", "titulo": "CND", "validade": "2027-03-01", "validacao": "validado"}]
    linhas = conformidade.avaliar(reqs, docs, [], date(2026, 12, 20), date(2026, 10, 19))
    sit = {x["requisito"]: x["situacao"] for x in linhas}
    assert sit == {"FGTS": "nao_atende", "Federal": "atende", "Atestado": "nao_atende"}
    assert "Vencido" in linhas[0]["pendencia"]
    assert conformidade.resumo(linhas)["parecer_habilitacao"] == "nao_pode_participar_sem_sanar_pendencias"


def test_catalogo_117_agentes_unicos():
    cat = montar_catalogo()
    assert len(CATALOGO) == 117 and len({a["id"] for a in cat}) == 117
    impl = {a["implementacao"] for a in cat}
    assert impl == {"deterministico", "ia_pendente", "apoio_humano"}
    jur = [a for a in cat if a["departamento"] == "juridico"]
    assert all(a["implementacao"] != "ia_pendente" for a in jur)
    assert all(any("não se apresenta como advogado" in x.lower() for x in a["limites"]) for a in jur)


def test_squads_por_objeto():
    assert tipo_objeto("Serviços de digitalização e OCR de acervo") == "digitalizacao"
    assert tipo_objeto("Aquisição de notebooks") == "fornecimento"
    assert tipo_objeto("Reforma de edificação escolar") == "engenharia_obras"
    s = formar_squad("Manutenção de sistema legado com banco de dados", "execucao")
    ids = [m["agente"] for m in s["membros"]]
    assert "administrador-de-banco-de-dados" in ids and "especialista-em-sistemas-legados" in ids
    assert formar_squad("Reforma de edificação", "execucao")["humanos_obrigatorios"]
    todos = {a["id"] for a in montar_catalogo()}
    for tipo in ("software manutenção", "digitalização", "aquisição", "reforma obra"):
        for m in formar_squad(tipo, "execucao")["membros"] + formar_squad(tipo, "licitacao")["membros"]:
            assert m["agente"] in todos, m
