"""Configuração lida das variáveis de ambiente (veja .env.example). Segredos ficam só no servidor."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _b(nome: str, padrao: bool = False) -> bool:
    return os.environ.get(nome, str(padrao)).lower() in {"1", "true", "sim", "yes"}


@dataclass
class Config:
    database_url: str = field(default_factory=lambda: os.environ.get("CT_DATABASE_URL", "sqlite:///./chinatrade.db"))
    redis_url: str = field(default_factory=lambda: os.environ.get("CT_REDIS_URL", ""))
    # chave Fernet (base64, 32 bytes) para cifrar os documentos no banco
    chave_cripto: str = field(default_factory=lambda: os.environ.get("CT_CHAVE_CRIPTO", ""))
    cookie_seguro: bool = field(default_factory=lambda: _b("CT_COOKIE_SEGURO", False))
    sessao_horas: int = field(default_factory=lambda: int(os.environ.get("CT_SESSAO_HORAS", "12")))
    cadastro_aberto: bool = field(default_factory=lambda: _b("CT_CADASTRO_ABERTO", True))
    pasta_anexos: Path = field(default_factory=lambda: Path(os.environ.get("CT_PASTA_ANEXOS", "./anexos")))
    intervalo_cotacoes: int = field(default_factory=lambda: int(os.environ.get("CT_INTERVALO_COTACOES", "60")))
    worker_embutido: bool = field(default_factory=lambda: _b("CT_WORKER_EMBUTIDO", False))
    # integrações opcionais
    brapi_token: str = field(default_factory=lambda: os.environ.get("BRAPI_TOKEN", ""))
    alphavantage_key: str = field(default_factory=lambda: os.environ.get("ALPHAVANTAGE_KEY", ""))
    aliyun_key_id: str = field(default_factory=lambda: os.environ.get("ALIYUN_ACCESS_KEY_ID", ""))
    aliyun_key_secret: str = field(default_factory=lambda: os.environ.get("ALIYUN_ACCESS_KEY_SECRET", ""))
    aliyun_regiao: str = field(default_factory=lambda: os.environ.get("ALIYUN_REGION", "cn-hangzhou"))
    alibaba_app_key: str = field(default_factory=lambda: os.environ.get("ALIBABA_APP_KEY", ""))
    alibaba_app_secret: str = field(default_factory=lambda: os.environ.get("ALIBABA_APP_SECRET", ""))
    smtp_host: str = field(default_factory=lambda: os.environ.get("SMTP_HOST", ""))
    smtp_porta: int = field(default_factory=lambda: int(os.environ.get("SMTP_PORT", "587")))
    smtp_usuario: str = field(default_factory=lambda: os.environ.get("SMTP_USER", ""))
    smtp_senha: str = field(default_factory=lambda: os.environ.get("SMTP_PASS", ""))
    smtp_remetente: str = field(default_factory=lambda: os.environ.get("SMTP_FROM", ""))
    whatsapp_token: str = field(default_factory=lambda: os.environ.get("WHATSAPP_TOKEN", ""))
    whatsapp_phone_id: str = field(default_factory=lambda: os.environ.get("WHATSAPP_PHONE_ID", ""))


cfg = Config()
