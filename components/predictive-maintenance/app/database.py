import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Defaults to a file in the working directory for local runs. In Docker it is
# pointed at /app/data, which is a named volume, so ingested telemetry survives
# a rebuild.
DATABASE_URL = os.getenv("PREDICTIVE_DATABASE_URL", "sqlite:///./predictive.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
