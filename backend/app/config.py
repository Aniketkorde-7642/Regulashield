from __future__ import annotations

import os
import secrets
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BACKEND_DIR / "storage" / "uploads"))).resolve()
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL_NON_POOLING")
    or os.getenv("POSTGRES_URL")
    or f"sqlite:///{(BACKEND_DIR / 'storage' / 'regula.db').as_posix()}"
)
SECRET_KEY_CONFIGURED = bool(os.getenv("SECRET_KEY"))
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(48)
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "480"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
DOCUMENT_STORAGE = os.getenv("DOCUMENT_STORAGE", "local").strip().casefold()
FIELD_CONFIDENCE_THRESHOLD = float(os.getenv("FIELD_CONFIDENCE_THRESHOLD", "0.75"))
OCR_LANGUAGE = os.getenv("OCR_LANGUAGE", "eng")
OCR_DPI = int(os.getenv("OCR_DPI", "300"))
TESSDATA_PATH = os.getenv("TESSDATA_PATH")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
OFFICER_PASSWORD = os.getenv("OFFICER_PASSWORD")
REGULATORY_PASSWORD = os.getenv("REGULATORY_PASSWORD")
INSTITUTION_PASSWORD = os.getenv("INSTITUTION_PASSWORD")
COMPLIANCE_ADMIN_PASSWORD = os.getenv("COMPLIANCE_ADMIN_PASSWORD")
DEMO_MODE = os.getenv("DEMO_MODE", "false").strip().casefold() == "true"
