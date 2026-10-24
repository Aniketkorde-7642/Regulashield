from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app import config


def save_pdf(data: bytes) -> str:
    key = f"{uuid4().hex}.pdf"
    if config.DOCUMENT_STORAGE == "vercel_blob":
        from vercel.blob import sync as blob

        result = blob.put_blob(
            f"evidence/{key}",
            data,
            access="private",
            content_type="application/pdf",
        )
        return result.pathname

    root = config.STORAGE_DIR.resolve()
    root.mkdir(parents=True, exist_ok=True)
    destination = (root / key).resolve()
    if destination.parent != root:
        raise HTTPException(status_code=500, detail="Invalid storage destination.")
    destination.write_bytes(data)
    return key


def read_document(key: str) -> Path:
    root = config.STORAGE_DIR.resolve()
    path = (root / key).resolve()
    if path.parent != root or not path.is_file():
        raise FileNotFoundError("Stored document is unavailable.")
    return path


def read_document_bytes(key: str) -> bytes:
    if config.DOCUMENT_STORAGE == "vercel_blob":
        from vercel.blob import sync as blob

        return blob.get_blob(key, access="private").body
    return read_document(key).read_bytes()


def delete_document(key: str) -> None:
    if config.DOCUMENT_STORAGE == "vercel_blob":
        from vercel.blob import sync as blob

        blob.delete_blob(key)
        return
    try:
        read_document(key).unlink(missing_ok=True)
    except FileNotFoundError:
        return
