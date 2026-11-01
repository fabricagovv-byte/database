"""Senhas (scrypt), tokens de sessão, TOTP (MFA) e criptografia dos dados (Fernet). Só biblioteca padrão + cryptography."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet

from .config import cfg

log = logging.getLogger(__name__)
_N, _R, _P = 2**14, 8, 1


def hash_senha(senha: str) -> str:
    sal = os.urandom(16)
    h = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def conferir_senha(senha: str, guardado: str) -> bool:
    try:
        _, n, r, p, sal, h = guardado.split("$")
        calc = hashlib.scrypt(senha.encode(), salt=base64.b64decode(sal), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


def senha_forte(senha: str) -> str | None:
    if len(senha) < 10:
        return "A senha precisa de pelo menos 10 caracteres."
    if senha.lower() == senha or not any(c.isdigit() for c in senha):
        return "Use letras maiúsculas, minúsculas e números."
    return None


def novo_token() -> tuple[str, str]:
    """Devolve (token para o navegador, hash para o banco)."""
    t = secrets.token_urlsafe(32)
    return t, hash_token(t)


def hash_token(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


# ---------- TOTP (RFC 6238), compatível com Google Authenticator, Authy etc. ----------
def novo_segredo_totp() -> str:
    return base64.b32encode(os.urandom(20)).decode().rstrip("=")


def codigo_totp(segredo: str, instante: float | None = None, passo: int = 30) -> str:
    chave = base64.b32decode(segredo + "=" * (-len(segredo) % 8))
    contador = int((instante or time.time()) // passo)
    h = hmac.new(chave, struct.pack(">Q", contador), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def conferir_totp(segredo: str, codigo: str, janela: int = 1) -> bool:
    agora = time.time()
    return any(hmac.compare_digest(codigo_totp(segredo, agora + d * 30), (codigo or "").strip()) for d in range(-janela, janela + 1))


def uri_totp(segredo: str, email: str) -> str:
    return f"otpauth://totp/ChinaTrade:{quote(email)}?secret={segredo}&issuer=ChinaTrade"


# ---------- criptografia dos dados ----------
_fernet: Fernet | None = None


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        chave = cfg.chave_cripto
        if not chave:
            chave = Fernet.generate_key().decode()
            log.warning("CT_CHAVE_CRIPTO não definida: usando chave temporária. Os dados ficam ilegíveis após reiniciar. "
                        "Gere uma com: python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())'")
            cfg.chave_cripto = chave
        _fernet = Fernet(chave.encode())
    return _fernet


def cifrar(dados: dict | str) -> str:
    texto = dados if isinstance(dados, str) else json.dumps(dados, ensure_ascii=False)
    return _f().encrypt(texto.encode()).decode()


def decifrar(texto: str) -> str:
    return _f().decrypt(texto.encode()).decode()


def decifrar_json(texto: str) -> dict:
    return json.loads(decifrar(texto))
