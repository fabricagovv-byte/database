"""Ponto de entrada ASGI: uvicorn broker.api.asgi:app"""

from broker.api.main import create_app

app = create_app()
