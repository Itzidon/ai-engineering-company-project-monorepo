import os
from functools import lru_cache

from dotenv import load_dotenv
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.pool import NullPool

load_dotenv()


@lru_cache(maxsize=1)
def get_engine():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL no configurada")

    return create_engine(
        database_url,
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args={"prepare_threshold": None},
    )


def create_db_and_tables():
    from services import models
    SQLModel.metadata.create_all(get_engine())


def get_db():
    with Session(get_engine()) as session:
        yield session
