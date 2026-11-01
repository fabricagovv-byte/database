from alembic import context
from sqlalchemy import engine_from_config, pool

from chinatrade.config import cfg
from chinatrade.db import Base

config = context.config
config.set_main_option("sqlalchemy.url", cfg.database_url)
alvo = Base.metadata

if context.is_offline_mode():
    context.configure(url=cfg.database_url, target_metadata=alvo, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    conexao = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with conexao.connect() as c:
        context.configure(connection=c, target_metadata=alvo, render_as_batch=c.dialect.name == "sqlite")
        with context.begin_transaction():
            context.run_migrations()
