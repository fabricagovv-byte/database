"""Google Trends (pytrends), notificações (SMTP e WhatsApp Business Cloud API) e captura de título de links."""

from __future__ import annotations

import html
import ipaddress
import logging
import re
import smtplib
import socket
from datetime import UTC, datetime
from email.message import EmailMessage
from urllib.parse import urljoin, urlparse

import httpx

from ..config import cfg

log = logging.getLogger(__name__)


# ---------- Google Trends ----------
def tendencias(termos: list[str], geo: str = "BR", periodo: str = "today 3-m") -> list[dict]:
    """Interesse de busca (0–100) dos termos no Google, via pytrends. Até 5 termos por consulta."""
    from pytrends.request import TrendReq

    t = TrendReq(hl="pt-BR", tz=180, timeout=(5, 20))
    t.build_payload(termos[:5], geo=geo, timeframe=periodo)
    df = t.interest_over_time()
    agora = datetime.now(UTC).isoformat()
    saida = []
    for termo in termos[:5]:
        if df is None or df.empty or termo not in df:
            continue
        serie = [{"data": idx.strftime("%Y-%m-%d"), "valor": int(v)} for idx, v in df[termo].items()]
        saida.append({"id": "tr-" + re.sub(r"[^a-z0-9]+", "-", termo.lower()).strip("-")[:60], "termo": termo, "serie": serie,
                      "fonte": f"Google Trends via pytrends ({geo}, {periodo})", "coletado_em": agora})
    return saida


# ---------- notificações ----------
def enviar_email(para: str, assunto: str, texto: str) -> str:
    if not (cfg.smtp_host and cfg.smtp_remetente):
        return "e-mail não configurado (SMTP_HOST/SMTP_FROM)"
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = cfg.smtp_remetente, para, assunto
    m.set_content(texto)
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_porta, timeout=20) as s:
        s.starttls()
        if cfg.smtp_usuario:
            s.login(cfg.smtp_usuario, cfg.smtp_senha)
        s.send_message(m)
    return "e-mail enviado"


def enviar_whatsapp(numero: str, texto: str) -> str:
    """WhatsApp Business Cloud API. Fora da janela de 24 h a Meta exige mensagem de modelo aprovada."""
    if not (cfg.whatsapp_token and cfg.whatsapp_phone_id):
        return "WhatsApp não configurado (WHATSAPP_TOKEN/WHATSAPP_PHONE_ID)"
    r = httpx.post(f"https://graph.facebook.com/v20.0/{cfg.whatsapp_phone_id}/messages", timeout=20,
                   headers={"Authorization": f"Bearer {cfg.whatsapp_token}"},
                   json={"messaging_product": "whatsapp", "to": re.sub(r"\D", "", numero), "type": "text", "text": {"body": texto[:4000]}})
    return "WhatsApp enviado" if r.is_success else f"WhatsApp recusou: {r.status_code} {r.text[:200]}"


# ---------- captura de título (com proteção contra SSRF) ----------
def _endereco_publico(host: str) -> bool:
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except (socket.gaierror, ValueError):
        return False


def capturar_titulo(url: str, cliente: httpx.Client | None = None, checar_ip: bool = True) -> dict[str, str]:
    u = urlparse(url)
    if u.scheme not in {"http", "https"} or not u.hostname:
        raise ValueError("Use um endereço http ou https.")
    if checar_ip and not _endereco_publico(u.hostname):
        raise ValueError("Endereço interno ou inválido.")
    c = cliente or httpx.Client(timeout=10, follow_redirects=False, headers={"User-Agent": "Mozilla/5.0 (ChinaTrade link preview)"})
    r = c.get(url)
    r.raise_for_status()
    corpo = r.text[:300_000]
    meta = lambda p: (re.search(p, corpo, re.I | re.S) or [None, ""])[1]
    titulo = meta(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)') or meta(r"<title[^>]*>(.*?)</title>")
    imagem = meta(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)')
    return {"titulo": html.unescape(titulo.strip())[:300], "imagem": urljoin(url, imagem) if imagem else ""}
