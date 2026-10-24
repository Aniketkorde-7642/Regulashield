from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from app import config
from app.api import api_router
from app.db import Base, SessionLocal, engine
from app import models  # noqa: F401
from app.services.security import bootstrap_users
from app.services.validation import seed_rules

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("regula_shield")


@asynccontextmanager
async def lifespan(_: FastAPI):
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    if "owner_username" not in {
        column["name"] for column in inspect(engine).get_columns("applications")
    }:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE applications ADD COLUMN owner_username VARCHAR(80)")
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_applications_owner_username "
                    "ON applications (owner_username)"
                )
            )
    with SessionLocal() as db:
        bootstrap_users(db)
        seed_rules(db)
    if not os.getenv("SECRET_KEY"):
        logger.warning("SECRET_KEY is not set; tokens will be invalidated after restart.")
    yield


app = FastAPI(
    title="Regula Shield AI",
    description="Synthetic evidence intake, validation, human review, and audit workflow.",
    version="1.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=config.APP_DIR / "static"), name="static")
app.include_router(api_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(config.APP_DIR / "static" / "index.html")
