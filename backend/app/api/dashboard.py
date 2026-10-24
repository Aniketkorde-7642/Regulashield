from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Application, AuditEntry, Document, Finding, User
from app.services.audit import verify_audit_chain
from app.services.security import get_current_user, has_role, require_role

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    require_role(
        user,
        "admin",
        "officer",
        "regulatory_officer",
        "compliance_admin",
        "institution",
    )
    application_filter = (
        Application.owner_username == user.username
        if has_role(user, "institution")
        else True
    )
    application_ids = select(Application.id).where(application_filter)
    return {
        "applications": db.scalar(
            select(func.count()).select_from(Application).where(application_filter)
        ) or 0,
        "in_review": db.scalar(
            select(func.count())
            .select_from(Application)
            .where(application_filter, Application.status == "review_required")
        )
        or 0,
        "documents": db.scalar(
            select(func.count()).select_from(Document).where(
                Document.application_id.in_(application_ids)
            )
        ) or 0,
        "open_findings": db.scalar(
            select(func.count())
            .select_from(Finding)
            .where(Finding.status == "open", Finding.application_id.in_(application_ids))
        )
        or 0,
        "users": (
            db.scalar(select(func.count()).select_from(User)) or 0
            if has_role(user, "admin")
            else 0
        ),
    }


@router.get("/security/overview")
def security_overview(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(user, "admin")
    entries = list(
        db.scalars(
            select(AuditEntry).order_by(AuditEntry.created_at, AuditEntry.id)
        )
    )
    return {
        "active_users": db.scalar(
            select(func.count()).select_from(User).where(User.is_active.is_(True))
        )
        or 0,
        "disabled_users": db.scalar(
            select(func.count()).select_from(User).where(User.is_active.is_(False))
        )
        or 0,
        "audit_integrity_ok": verify_audit_chain(entries),
        "audit_events": len(entries),
        "recent_actions": [
            {
                "actor": entry.actor,
                "action": entry.action,
                "entity_type": entry.entity_type,
                "created_at": entry.created_at.isoformat(),
            }
            for entry in reversed(entries[-10:])
        ],
    }
