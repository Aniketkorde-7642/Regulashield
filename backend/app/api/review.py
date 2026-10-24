from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Application, AuditEntry, Document, FieldExtraction, Finding, User, utc_now
from app.schemas import (
    ApplicationDetail,
    AuditOut,
    DecisionRequest,
    ExtractionOut,
    FieldReviewRequest,
    FindingOut,
    FindingReviewRequest,
)
from app.services.audit import append_audit, verify_audit_chain
from app.services.decision import approval_blockers
from app.services.extraction import (
    expected_application_value,
    extraction_label_match_score,
    overall_metadata_match_score,
    value_match_score,
)
from app.services.security import get_current_user, has_role, require_role

router = APIRouter(tags=["review"])


@router.get("/review/queue", response_model=list[dict])
def get_review_queue(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    require_role(user, "admin", "officer")
    applications = list(
        db.scalars(
            select(Application)
            .where(Application.status.notin_(("approved", "rejected")))
            .options(
                selectinload(Application.documents).selectinload(Document.extractions),
                selectinload(Application.findings),
            )
        )
    )
    queue = []
    for application in applications:
        open_findings = [
            finding for finding in application.findings if finding.status == "open"
        ]
        high_findings = sum(finding.severity == "high" for finding in open_findings)
        medium_findings = sum(finding.severity == "medium" for finding in open_findings)
        pending_fields = sum(
            extraction.requires_review or extraction.review_action in (None, "flag")
            for document in application.documents
            for extraction in document.extractions
        )
        processing_documents = sum(
            document.status in ("uploaded", "processing")
            for document in application.documents
        )
        metadata_discrepancies = []
        for document in application.documents:
            for extraction in document.extractions:
                expected = expected_application_value(
                    extraction.field_name,
                    application,
                )
                match_score = value_match_score(
                    extraction.extracted_value,
                    expected,
                )
                if expected is not None and match_score is not None and match_score < 0.99:
                    metadata_discrepancies.append(
                        {
                            "field_name": extraction.field_name,
                            "expected_value": expected,
                            "extracted_value": extraction.extracted_value,
                            "match_percentage": round(match_score * 100),
                        }
                    )
        priority = (
            high_findings * 100
            + medium_findings * 35
            + len(metadata_discrepancies) * 20
            + pending_fields * 10
            + processing_documents * 5
        )
        queue.append(
            {
                **ApplicationDetail.model_validate(application).model_dump(mode="json"),
                "priority_score": priority,
                "open_findings": len(open_findings),
                "high_findings": high_findings,
                "pending_fields": pending_fields,
                "metadata_discrepancies": metadata_discrepancies,
                "report": [
                    {
                        "rule_id": finding.rule_id,
                        "severity": finding.severity,
                        "message": finding.message,
                        "clause_reference": finding.details.get("clause_reference"),
                        "rule_version": finding.details.get("rule_version"),
                    }
                    for finding in sorted(
                        open_findings,
                        key=lambda item: {"high": 0, "medium": 1, "low": 2}.get(
                            item.severity, 3
                        ),
                    )
                ],
            }
        )
    return sorted(
        queue,
        key=lambda item: (
            -item["priority_score"],
            item["created_at"],
        ),
    )


@router.get("/applications/{application_id}/review", response_model=dict)
def get_review(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(
        user,
        "admin",
        "officer",
        "regulatory_officer",
        "compliance_admin",
        "institution",
    )
    application = db.scalar(
        select(Application)
        .where(Application.id == application_id)
        .options(
            selectinload(Application.documents).selectinload(Document.extractions),
            selectinload(Application.findings),
        )
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    if has_role(user, "institution") and application.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")
    extractions = [field for document in application.documents for field in document.extractions]
    extraction_results = []
    for field in extractions:
        expected_value = expected_application_value(field.field_name, application)
        result = ExtractionOut.model_validate(field).model_dump()
        metadata_match = value_match_score(field.extracted_value, expected_value)
        confidence = field.confidence
        if metadata_match is not None:
            confidence *= 0.5 + 0.5 * metadata_match
        result.update(
            confidence=round(confidence, 2),
            label_match_score=extraction_label_match_score(
                field.raw_ocr_text, field.field_name
            ),
            expected_value=expected_value,
            metadata_match_score=metadata_match,
        )
        extraction_results.append(result)
    return {
        "application": ApplicationDetail.model_validate(application),
        "extractions": extraction_results,
        "findings": [FindingOut.model_validate(finding) for finding in application.findings],
        "match_summary": overall_metadata_match_score(application, extractions),
    }


@router.post("/extractions/{extraction_id}/review", response_model=ExtractionOut)
def review_extraction(
    extraction_id: str,
    payload: FieldReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FieldExtraction:
    require_role(user, "admin", "officer", "regulatory_officer", "compliance_admin")
    extraction = db.get(FieldExtraction, extraction_id)
    if extraction is None:
        raise HTTPException(status_code=404, detail="Extracted field not found.")
    if payload.action == "correct":
        corrected = (payload.corrected_value or "").strip()
        if not corrected:
            raise HTTPException(status_code=422, detail="Enter a corrected value.")
        extraction.reviewed_value = corrected
        extraction.requires_review = False
    elif payload.action == "confirm":
        extraction.reviewed_value = extraction.extracted_value
        extraction.requires_review = False
    else:
        extraction.reviewed_value = (payload.corrected_value or "").strip() or None
        extraction.requires_review = True
    extraction.reviewed_by = user.username
    extraction.review_action = payload.action
    extraction.reviewed_at = utc_now()
    document = db.get(Document, extraction.document_id)
    application_id = document.application_id if document else ""
    append_audit(
        db,
        actor=user.username,
        action=f"field.{payload.action}",
        entity_type="extraction",
        entity_id=extraction.id,
        details={
            "field_name": extraction.field_name,
            "original_value": extraction.extracted_value,
            "reviewed_value": extraction.reviewed_value,
            "application_id": application_id,
        },
    )
    db.commit()
    db.refresh(extraction)
    return extraction


@router.post("/findings/{finding_id}/review", response_model=FindingOut)
def review_finding(
    finding_id: str,
    payload: FindingReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Finding:
    require_role(user, "admin", "officer", "regulatory_officer")
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found.")
    reason = (payload.reason or "").strip()
    if payload.status == "dismissed" and not reason:
        raise HTTPException(
            status_code=422,
            detail="Reason is required when dismissing a finding.",
        )
    finding.status = payload.status
    finding.resolved_by = user.username if payload.status != "open" else None
    finding.resolved_at = utc_now() if payload.status != "open" else None
    details = dict(finding.details or {})
    if payload.status == "dismissed":
        details["dismissal_reason"] = reason
    elif payload.status == "open":
        details.pop("dismissal_reason", None)
    finding.details = details
    append_audit(
        db,
        actor=user.username,
        action=f"finding.{payload.status}",
        entity_type="finding",
        entity_id=finding.id,
        details={
            "application_id": finding.application_id,
            "rule_id": finding.rule_id,
            **({"reason": reason} if payload.status == "dismissed" else {}),
        },
    )
    db.commit()
    db.refresh(finding)
    return finding


@router.get("/applications/{application_id}/blockers", response_model=dict[str, list[str]])
def get_approval_blockers(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    require_role(user, "admin", "officer", "regulatory_officer", "compliance_admin")
    blockers = approval_blockers(db, application_id)
    if blockers == ["Application not found."]:
        raise HTTPException(status_code=404, detail="Application not found.")
    return {"blockers": blockers}


@router.post("/applications/{application_id}/decision", response_model=ApplicationDetail)
def decide_application(
    application_id: str,
    payload: DecisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
    application = db.scalar(
        select(Application)
        .where(Application.id == application_id)
        .options(selectinload(Application.documents), selectinload(Application.findings))
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    if application.owner_username is not None:
        require_role(user, "admin")
        if application.status != "pending_admin_review":
            raise HTTPException(
                status_code=409,
                detail="Institution applications must be submitted before an administrator can decide them.",
            )
    else:
        require_role(user, "admin", "officer")
    if application.status in {"approved", "rejected"}:
        raise HTTPException(status_code=409, detail="A decision has already been recorded.")
    blockers: list[str] = []
    match_summary: dict[str, int | str] = {}
    if payload.decision == "approve":
        blockers = approval_blockers(db, application.id)
        active_processing = any(
            blocker.endswith("document(s) are still processing.")
            for blocker in blockers
        )
        if blockers and (not payload.override_blockers or active_processing):
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        "Wait for active document processing to finish before approving."
                        if active_processing
                        else "Application cannot be approved yet."
                    ),
                    "blockers": blockers,
                },
            )
        match_extractions = list(
            db.scalars(
                select(FieldExtraction)
                .join(Document, FieldExtraction.document_id == Document.id)
                .where(Document.application_id == application.id)
            )
        )
        match_summary = overall_metadata_match_score(application, match_extractions)
    application.status = "approved" if payload.decision == "approve" else "rejected"
    application.decision_note = payload.note
    application.decided_by = user.username
    application.decided_at = utc_now()
    append_audit(
        db,
        actor=user.username,
        action=f"application.{payload.decision}d" if payload.decision == "approve" else "application.rejected",
        entity_type="application",
        entity_id=application.id,
        details={
            "note": payload.note,
            "override_blockers": payload.override_blockers,
            "overridden_blockers": blockers if payload.override_blockers else [],
            **({"match_summary": match_summary} if payload.decision == "approve" else {}),
        },
    )
    db.commit()
    db.refresh(application)
    return application


@router.get("/audit", response_model=dict)
def list_audit(
    application_id: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(user, "admin", "officer", "regulatory_officer", "compliance_admin")
    limit = max(1, min(limit, 500))
    query = select(AuditEntry).order_by(AuditEntry.created_at, AuditEntry.id)
    all_entries = list(db.scalars(query))
    integrity_ok = verify_audit_chain(all_entries) if not application_id else None
    if application_id:
        all_entries = [
            entry
            for entry in all_entries
            if entry.entity_id == application_id
            or entry.details.get("application_id") == application_id
        ]
    entries = all_entries[-limit:]
    return {"integrity_ok": integrity_ok, "entries": [AuditOut.model_validate(e) for e in entries]}
