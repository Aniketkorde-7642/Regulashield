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


def initialize_database() -> None:
    with engine.connect() as connection:
        is_postgres = engine.dialect.name == "postgresql"
        if is_postgres:
            connection.execute(text("SELECT pg_advisory_lock(731968021)"))
            connection.commit()
        try:
            Base.metadata.create_all(bind=connection)
            columns = {
                column["name"]
                for column in inspect(connection).get_columns("applications")
            }
            if "owner_username" not in columns:
                connection.execute(
                    text(
                        "ALTER TABLE applications ADD COLUMN "
                        + ("IF NOT EXISTS " if is_postgres else "")
                        + "owner_username VARCHAR(80)"
                    )
                )
            extraction_columns = {
                column["name"]
                for column in inspect(connection).get_columns("field_extractions")
            }
            if "source_page" not in extraction_columns:
                connection.execute(
                    text(
                        "ALTER TABLE field_extractions ADD COLUMN "
                        + ("IF NOT EXISTS " if is_postgres else "")
                        + "source_page INTEGER"
                    )
                )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_applications_owner_username "
                    "ON applications (owner_username)"
                )
            )
            connection.commit()
            with SessionLocal(bind=connection) as db:
                bootstrap_users(db)
                seed_rules(db)
        finally:
            if is_postgres:
                if connection.in_transaction():
                    connection.rollback()
                connection.execute(text("SELECT pg_advisory_unlock(731968021)"))
                connection.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("VERCEL") == "1":
        missing_settings = []
        if not config.SECRET_KEY_CONFIGURED:
            missing_settings.append("SECRET_KEY")
        if config.DEMO_MODE:
            if not config.DEMO_ROLE_PASSWORD:
                missing_settings.append("DEMO_ROLE_PASSWORD")
            if config.DEMO_ACCESS_PROTECTION != "vercel_sso":
                missing_settings.append("DEMO_ACCESS_PROTECTION=vercel_sso")
        else:
            if not config.ADMIN_PASSWORD:
                missing_settings.append("ADMIN_PASSWORD")
            if config.DEMO_ACCESS_PROTECTION:
                missing_settings.append("DEMO_ACCESS_PROTECTION must be empty for production")
        if not config.DATABASE_URL.startswith(("postgres://", "postgresql://", "postgresql+")):
            missing_settings.append("DATABASE_URL")
        if config.DOCUMENT_STORAGE != "vercel_blob":
            missing_settings.append("DOCUMENT_STORAGE=vercel_blob")
        elif not os.getenv("BLOB_READ_WRITE_TOKEN") and not os.getenv("VERCEL_OIDC_TOKEN"):
            missing_settings.append(
                "BLOB_READ_WRITE_TOKEN or VERCEL_OIDC_TOKEN for private Blob access"
            )
        if missing_settings:
            raise RuntimeError(
                "Vercel deployment is missing required settings: "
                + ", ".join(missing_settings)
            )
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    initialize_database()
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
@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(config.APP_DIR / "static" / "index.html")
