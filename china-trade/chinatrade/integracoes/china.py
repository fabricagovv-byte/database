"""Pesquisa de produtos chineses.

- Tradução PT→ZH/EN: Aliyun Machine Translation (SDK aliyun-python-sdk-alimt, cena e-commerce "title"),
  com glossário interno como reserva.
- Busca: links oficiais de busca das 7 plataformas (não há API pública gratuita de busca).
- 1688/Alibaba Open Platform: adaptador pronto; exige APP_KEY/APP_SECRET aprovados e o token OAuth do vendedor/comprador.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import quote

import httpx

from ..config import cfg

GLOSSARIO = {
    "fone de ouvido": ("耳机", "earphones"), "fone bluetooth": ("蓝牙耳机", "bluetooth earbuds"), "luminária": ("台灯", "lamp"),
    "garrafa térmica": ("保温杯", "thermos bottle"), "capinha de celular": ("手机壳", "phone case"), "carregador": ("充电器", "charger"),
    "relógio inteligente": ("智能手表", "smart watch"), "mochila": ("背包", "backpack"), "brinquedo": ("玩具", "toy"),
    "tênis": ("运动鞋", "sneakers"), "bolsa feminina": ("女包", "women handbag"), "ferramenta": ("工具", "tools"),
    "cabo usb": ("数据线", "usb cable"), "caixa de som": ("音箱", "speaker"), "panela": ("锅", "cookware"),
    "organizador": ("收纳盒", "organizer"), "óculos de sol": ("太阳镜", "sunglasses"), "pet": ("宠物用品", "pet supplies"),
}


def links_busca(pt: str, zh: str = "", en: str = "") -> list[dict[str, str]]:
    en = en or pt
    zh = zh or en
    q = quote
    return [
        {"plataforma": "1688", "url": f"https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords={q(zh)}"},
        {"plataforma": "Alibaba", "url": f"https://www.alibaba.com/trade/search?SearchText={q(en)}"},
        {"plataforma": "AliExpress", "url": f"https://pt.aliexpress.com/wholesale?SearchText={q(en)}"},
        {"plataforma": "Made-in-China", "url": f"https://www.made-in-china.com/multi-search/{q(en)}/F1/1.html"},
        {"plataforma": "Global Sources", "url": f"https://www.globalsources.com/searchList/products?keyWord={q(en)}"},
        {"plataforma": "DHgate", "url": f"https://www.dhgate.com/wholesale/search.do?searchkey={q(en)}"},
        {"plataforma": "Taobao", "url": f"https://s.taobao.com/search?q={q(zh)}"},
    ]


def _aliyun(texto: str, destino: str) -> str:
    from aliyunsdkalimt.request.v20181012.TranslateECommerceRequest import TranslateECommerceRequest
    from aliyunsdkcore.client import AcsClient

    cliente = AcsClient(cfg.aliyun_key_id, cfg.aliyun_key_secret, cfg.aliyun_regiao)
    req = TranslateECommerceRequest()
    req.set_accept_format("json")
    req.set_SourceLanguage("pt")
    req.set_TargetLanguage(destino)
    req.set_SourceText(texto)
    req.set_FormatType("text")
    req.set_Scene("title")
    resp = json.loads(cliente.do_action_with_exception(req))
    return resp["Data"]["Translated"]


def traduzir(texto: str) -> dict[str, str]:
    """Devolve {zh, en, fonte}. Usa Aliyun quando há credencial; senão o glossário; senão devolve o texto original."""
    chave = texto.lower().strip()
    if cfg.aliyun_key_id and cfg.aliyun_key_secret:
        try:
            return {"zh": _aliyun(texto, "zh"), "en": _aliyun(texto, "en"), "fonte": "Aliyun Machine Translation (e-commerce)"}
        except Exception as e:
            erro = f"Aliyun falhou ({type(e).__name__}); "
        else:  # pragma: no cover
            erro = ""
    else:
        erro = "Aliyun sem credencial; "
    if chave in GLOSSARIO:
        zh, en = GLOSSARIO[chave]
        return {"zh": zh, "en": en, "fonte": erro + "glossário interno"}
    return {"zh": "", "en": "", "fonte": erro + "sem tradução: busque em português/inglês"}


class Alibaba1688:
    """Cliente da 1688/Alibaba Open Platform (open.1688.com). Assinatura HMAC-SHA1 conforme a documentação oficial.

    Para ativar: crie um app em open.1688.com, aguarde a aprovação das APIs de produto
    (ex.: com.alibaba.product:alibaba.product.search / alibaba.cross.productInfo) e informe ALIBABA_APP_KEY,
    ALIBABA_APP_SECRET e o access_token do OAuth.
    """

    base = "https://gw.open.1688.com/openapi"

    def __init__(self, app_key: str = "", app_secret: str = "", token: str = "") -> None:
        self.app_key, self.app_secret, self.token = app_key or cfg.alibaba_app_key, app_secret or cfg.alibaba_app_secret, token

    @property
    def ativo(self) -> bool:
        return bool(self.app_key and self.app_secret and self.token)

    def assinar(self, caminho: str, params: dict[str, str]) -> str:
        texto = caminho + "".join(k + v for k, v in sorted(params.items()))
        return hmac.new(self.app_secret.encode(), texto.encode(), hashlib.sha1).hexdigest().upper()

    def chamar(self, namespace: str, nome: str, params: dict[str, str], versao: int = 1) -> dict:
        if not self.ativo:
            raise RuntimeError("1688 Open Platform sem credenciais: defina ALIBABA_APP_KEY, ALIBABA_APP_SECRET e o token OAuth.")
        caminho = f"param2/{versao}/{namespace}/{nome}/{self.app_key}"
        p = {**params, "access_token": self.token, "_aop_timestamp": str(int(time.time() * 1000))}
        p["_aop_signature"] = self.assinar(caminho, p)
        r = httpx.post(f"{self.base}/{caminho}", data=p, timeout=20)
        r.raise_for_status()
        return r.json()
