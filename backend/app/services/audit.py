from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditEntry, utc_now


GENESIS_HASH = "0" * 64


def _timestamp_value(entry: AuditEntry) -> str:
    timestamp = entry.created_at
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.isoformat()


def append_audit(
    db: Session,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    details: dict[str, Any] | None = None,
) -> AuditEntry:
    previous = db.scalar(select(AuditEntry).order_by(AuditEntry.created_at.desc(), AuditEntry.id.desc()))
    previous_hash = previous.entry_hash if previous else GENESIS_HASH
    created_at = utc_now()
    if previous:
        previous_time = previous.created_at
        if previous_time.tzinfo is None:
            previous_time = previous_time.replace(tzinfo=timezone.utc)
        created_at = max(created_at, previous_time + timedelta(microseconds=1))
    entry = AuditEntry(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or {},
        previous_hash=previous_hash,
        entry_hash="",
        created_at=created_at,
    )
    db.add(entry)
    db.flush()
    payload = {
        "id": entry.id,
        "actor": entry.actor,
        "action": entry.action,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "details": entry.details,
        "previous_hash": entry.previous_hash,
        "created_at": _timestamp_value(entry),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    entry.entry_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    db.flush()
    return entry


def verify_audit_chain(entries: list[AuditEntry]) -> bool:
    previous_hash = GENESIS_HASH
    for entry in entries:
        if entry.previous_hash != previous_hash:
            return False
        payload = {
            "id": entry.id,
            "actor": entry.actor,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "details": entry.details,
            "previous_hash": entry.previous_hash,
            "created_at": _timestamp_value(entry),
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        if hashlib.sha256(canonical.encode("utf-8")).hexdigest() != entry.entry_hash:
            return False
        previous_hash = entry.entry_hash
    return True
