from __future__ import annotations

from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ComplianceRule, RuleChange, User, utc_now
from app.schemas import (
    ComplianceRuleCreate,
    ComplianceRuleOut,
    RuleChangeOut,
    RuleChangeReviewRequest,
    RuleSimulationRequest,
    SourceVerificationRequest,
)
from app.services.audit import append_audit
from app.services.security import get_current_user, require_role
from app.services.validation import _OPERATORS, regulatory_findings

router = APIRouter(prefix="/compliance/rules", tags=["compliance rules"])
RULE_VIEWERS = ("admin", "officer", "regulatory_officer", "compliance_admin")


def _get_change(db: Session, change_id: str) -> RuleChange:
    change = db.get(RuleChange, change_id)
    if change is None:
        raise HTTPException(status_code=404, detail="Rule change not found.")
    return change


def _validate_rule(payload: ComplianceRuleCreate) -> None:
    if payload.operator not in _OPERATORS:
        raise HTTPException(status_code=422, detail="Unsupported rule operator.")


@router.get("", response_model=list[ComplianceRuleOut])
def list_rules(
    academic_year: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    include_history: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ComplianceRule]:
    require_role(user, *RULE_VIEWERS)
    query = select(ComplianceRule)
    if academic_year:
        query = query.where(ComplianceRule.academic_year.in_(("all", academic_year)))
    if not include_history:
        query = query.where(ComplianceRule.is_active.is_(True))
    return list(
        db.scalars(
            query.order_by(
                ComplianceRule.rule_key,
                ComplianceRule.academic_year,
                ComplianceRule.version.desc(),
            )
        )
    )


@router.get("/changes", response_model=list[RuleChangeOut])
def list_rule_changes(
    status_filter: str | None = Query(
        default=None,
        alias="status",
        pattern=r"^(draft|pending|approved|rejected)$",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RuleChange]:
    require_role(user, "admin", "compliance_admin")
    query = select(RuleChange)
    if status_filter:
        query = query.where(RuleChange.status == status_filter)
    return list(db.scalars(query.order_by(RuleChange.created_at.desc())))


@router.post("", response_model=RuleChangeOut, status_code=status.HTTP_201_CREATED)
def create_rule_draft(
    payload: ComplianceRuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleChange:
    require_role(user, "compliance_admin")
    _validate_rule(payload)
    change = RuleChange(
        id=str(uuid4()),
        payload=payload.model_dump(),
        status="draft",
        created_by=user.username,
    )
    db.add(change)
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.draft_created",
        entity_type="rule_change",
        entity_id=change.id,
        details={"rule_key": payload.rule_key, "academic_year": payload.academic_year},
    )
    db.commit()
    db.refresh(change)
    return change


@router.put("/changes/{change_id}", response_model=RuleChangeOut)
def update_rule_draft(
    change_id: str,
    payload: ComplianceRuleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleChange:
    require_role(user, "compliance_admin")
    _validate_rule(payload)
    change = _get_change(db, change_id)
    if change.status != "draft" or change.created_by != user.username:
        raise HTTPException(status_code=409, detail="Only your own draft can be edited.")
    change.payload = payload.model_dump()
    change.source_verified = False
    change.source_verified_by = None
    change.source_verified_at = None
    change.simulated_at = None
    change.simulation_result = None
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.draft_updated",
        entity_type="rule_change",
        entity_id=change.id,
        details={"rule_key": payload.rule_key, "academic_year": payload.academic_year},
    )
    db.commit()
    db.refresh(change)
    return change


@router.post("/changes/{change_id}/verify-source", response_model=RuleChangeOut)
def verify_rule_source(
    change_id: str,
    payload: SourceVerificationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleChange:
    require_role(user, "compliance_admin")
    change = _get_change(db, change_id)
    if change.status != "draft" or change.created_by != user.username:
        raise HTTPException(status_code=409, detail="Only your own draft can be verified.")
    if not payload.confirmed:
        raise HTTPException(status_code=422, detail="Confirm that you checked the official source.")

    rule = ComplianceRuleCreate.model_validate(change.payload)
    parsed_url = urlparse(rule.source_url or "")
    if (
        parsed_url.scheme != "https"
        or not parsed_url.hostname
        or parsed_url.username
        or parsed_url.password
        or not rule.clause_reference
    ):
        raise HTTPException(
            status_code=422,
            detail="Source verification requires an HTTPS source URL and a clause reference.",
        )

    change.source_verified = True
    change.source_verified_by = user.username
    change.source_verified_at = utc_now()
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.source_verified",
        entity_type="rule_change",
        entity_id=change.id,
        details={
            "rule_key": rule.rule_key,
            "source_title": rule.source_title,
            "source_url": rule.source_url,
            "clause_reference": rule.clause_reference,
        },
    )
    db.commit()
    db.refresh(change)
    return change


@router.post("/changes/{change_id}/simulate", response_model=dict)
def simulate_rule_change(
    change_id: str,
    payload: RuleSimulationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(user, "compliance_admin")
    change = _get_change(db, change_id)
    if change.status != "draft" or change.created_by != user.username:
        raise HTTPException(status_code=409, detail="Only your own draft can be simulated.")
    rule = ComplianceRuleCreate.model_validate(change.payload)
    sample = SimpleNamespace(
        declared_faculty=payload.declared_faculty,
        declared_student_count=payload.declared_student_count,
        declared_land_area=payload.declared_land_area,
    )
    findings = regulatory_findings(
        sample,
        [
            {
                **rule.model_dump(),
                "id": rule.rule_key,
                "version": None,
            }
        ],
    )
    change.simulated_at = utc_now()
    change.simulation_result = {
        "passed": not findings,
        "sample": payload.model_dump(),
        "findings": findings,
    }
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.simulated",
        entity_type="rule_change",
        entity_id=change.id,
        details={
            "rule_key": rule.rule_key,
            "academic_year": rule.academic_year,
            "sample": payload.model_dump(),
            "finding_count": len(findings),
        },
    )
    db.commit()
    return {
        "rule_key": rule.rule_key,
        "sample": payload.model_dump(),
        "passed": not findings,
        "findings": findings,
        "persisted": False,
        "disclaimer": "Simulation only; no application or evaluation result was changed.",
    }


@router.post("/changes/{change_id}/submit", response_model=RuleChangeOut)
def submit_rule_change(
    change_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleChange:
    require_role(user, "compliance_admin")
    change = _get_change(db, change_id)
    if change.status != "draft" or change.created_by != user.username:
        raise HTTPException(status_code=409, detail="Only your own draft can be submitted.")
    if not change.source_verified:
        raise HTTPException(status_code=409, detail="Verify the official source before submitting.")
    if change.simulated_at is None:
        raise HTTPException(status_code=409, detail="Run a rule simulation before submitting.")
    change.status = "pending"
    change.submitted_at = utc_now()
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.submitted",
        entity_type="rule_change",
        entity_id=change.id,
        details={
            "rule_key": change.payload["rule_key"],
            "severity": change.payload["severity"],
        },
    )
    db.commit()
    db.refresh(change)
    return change


@router.post("/changes/{change_id}/review", response_model=RuleChangeOut)
def review_rule_change(
    change_id: str,
    payload: RuleChangeReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleChange:
    require_role(user, "admin")
    change = _get_change(db, change_id)
    if change.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending rule changes can be reviewed.")
    if change.created_by == user.username:
        raise HTTPException(status_code=403, detail="A rule change must be approved by someone other than its author.")

    rule_payload = ComplianceRuleCreate.model_validate(change.payload)
    published_rule: ComplianceRule | None = None
    if payload.decision == "approve":
        existing = list(
            db.scalars(
                select(ComplianceRule).where(
                    ComplianceRule.rule_key == rule_payload.rule_key,
                    ComplianceRule.academic_year == rule_payload.academic_year,
                )
            )
        )
        version = max((rule.version for rule in existing), default=0) + 1
        for previous in existing:
            previous.is_active = False
        published_rule = ComplianceRule(
            id=str(uuid4()),
            **rule_payload.model_dump(),
            version=version,
            is_active=True,
            created_by=change.created_by,
        )
        db.add(published_rule)
        change.published_rule_id = published_rule.id
        change.status = "approved"
    else:
        change.status = "rejected"

    change.reviewed_by = user.username
    change.reviewed_at = utc_now()
    change.review_note = payload.note
    audit_action = (
        "compliance_rule.approved"
        if payload.decision == "approve"
        else "compliance_rule.rejected"
    )
    append_audit(
        db,
        actor=user.username,
        action=audit_action,
        entity_type="rule_change",
        entity_id=change.id,
        details={
            "rule_key": rule_payload.rule_key,
            "decision": payload.decision,
            "review_note": payload.note,
            "published_rule_id": change.published_rule_id,
            "published_version": published_rule.version if published_rule else None,
        },
    )
    db.commit()
    db.refresh(change)
    return change


@router.post("/{rule_key}/deactivate", response_model=ComplianceRuleOut)
def deactivate_rule(
    rule_key: str,
    academic_year: str = Query(pattern=r"^(all|\d{4}-\d{2})$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ComplianceRule:
    require_role(user, "admin")
    rule = db.scalar(
        select(ComplianceRule)
        .where(
            ComplianceRule.rule_key == rule_key,
            ComplianceRule.academic_year == academic_year,
            ComplianceRule.is_active.is_(True),
        )
        .order_by(ComplianceRule.version.desc())
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Active rule version not found.")
    rule.is_active = False
    append_audit(
        db,
        actor=user.username,
        action="compliance_rule.deactivated",
        entity_type="compliance_rule",
        entity_id=rule.id,
        details={
            "rule_key": rule.rule_key,
            "version": rule.version,
            "academic_year": rule.academic_year,
        },
    )
    db.commit()
    db.refresh(rule)
    return rule
