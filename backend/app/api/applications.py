from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import config
from app.db import get_db
from app.models import Application, Document, User
from app.schemas import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationDecisionReport,
    ApplicationOut,
    DocumentOut,
    InstitutionApplicationUpdate,
    StoredDocumentCreate,
)
from app.services.audit import append_audit
from app.services.extraction import overall_metadata_match_score
from app.services.pipeline import process_document
from app.services.security import get_current_user, has_role, require_role
from app.services.storage import delete_document, read_document_bytes, save_pdf
from app.services.validation import get_pdf_page_count, load_rules, regulatory_findings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/applications", tags=["applications"])
DOCUMENT_TYPES = {"affiliation_letter", "faculty_certificate", "land_record", "fire_safety", "other"}
EXPECTED_DOCUMENTS = {
    "affiliation_letter": "Affiliation / approval letter",
    "faculty_certificate": "Faculty details or faculty certificate",
    "land_record": "Land ownership or lease evidence",
    "fire_safety": "Fire safety certificate",
}


def _assert_application_access(application: Application, user: User) -> None:
    if has_role(user, "institution") and application.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")


def _persist_document(
    db: Session,
    application: Application,
    user: User,
    filename: str,
    document_type: str,
    data: bytes,
    storage_key: str | None = None,
) -> Document:
    try:
        page_count = get_pdf_page_count(data)
    except (ValueError, RuntimeError) as exc:
        logger.info("Rejected invalid PDF upload: %s", exc)
        if storage_key:
            delete_document(storage_key)
        raise HTTPException(status_code=422, detail=f"Unable to read PDF: {exc}") from None

    key = storage_key or save_pdf(data)
    document = Document(
        id=str(uuid4()),
        application_id=application.id,
        filename=filename[:255],
        document_type=document_type,
        content_type="application/pdf",
        storage_key=key,
        file_hash=hashlib.sha256(data).hexdigest(),
        page_count=page_count,
        status="uploaded",
    )
    db.add(document)
    application.status = "processing"
    try:
        db.flush()
        append_audit(
            db,
            actor=user.username,
            action="document.uploaded",
            entity_type="document",
            entity_id=document.id,
            details={
                "application_id": application.id,
                "filename": document.filename,
                "document_type": document.document_type,
                "file_hash": document.file_hash,
            },
        )
        db.commit()
        db.refresh(document)
    except Exception:
        db.rollback()
        delete_document(key)
        raise
    return document


@router.get("", response_model=list[ApplicationOut])
def list_applications(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Application]:
    require_role(
        user,
        "admin",
        "officer",
        "regulatory_officer",
        "compliance_admin",
        "institution",
    )
    query = (
        select(Application)
        .options(selectinload(Application.documents))
        .order_by(Application.created_at.desc())
    )
    if status_filter:
        query = query.where(Application.status == status_filter)
    if has_role(user, "institution"):
        query = query.where(Application.owner_username == user.username)
    return list(db.scalars(query))


@router.post("", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
    require_role(user, "admin", "institution")
    application = Application(**payload.model_dump())
    if has_role(user, "institution"):
        application.owner_username = user.username
    db.add(application)
    try:
        db.flush()
        append_audit(
            db,
            actor=user.username,
            action="application.created",
            entity_type="application",
            entity_id=application.id,
            details={"application_number": application.application_number},
        )
        db.commit()
        db.refresh(application)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Application number already exists.") from None
    return application


@router.post("/validate", response_model=dict)
def validate_application(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(user, "admin", "officer", "institution")
    rules = load_rules(db, payload.academic_year)
    findings = regulatory_findings(payload, rules)
    issues = [
        {
            "severity": finding["severity"],
            "message": finding["message"],
            "field": finding["expected"].split(" ", 1)[0],
            "action": f"Review {finding['expected']} before submission.",
            "clause_reference": finding["details"].get("clause_reference"),
            "source": finding["details"].get("source"),
        }
        for finding in findings
    ]
    issues.extend(
        {
            "severity": "info",
            "message": f"Prepare {label} before final submission.",
            "field": "supporting_documents",
            "action": "Upload this evidence in the application portal.",
            "clause_reference": None,
            "source": "Application evidence checklist",
        }
        for label in EXPECTED_DOCUMENTS.values()
    )
    return {
        "academic_year": payload.academic_year,
        "ready": not findings,
        "issues": issues,
        "rule_count": len(rules),
        "disclaimer": (
            "Pre-checks are advisory and use configured rules; they are not an official AICTE determination."
        ),
    }


@router.post("/{application_id}/resubmissions", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_resubmission(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
    require_role(user, "institution")
    original = db.get(Application, application_id)
    if original is None or original.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")
    if original.status != "rejected":
        raise HTTPException(status_code=409, detail="Only rejected applications can be resubmitted.")

    base_number = original.application_number[:61]
    revision = 1
    while db.scalar(
        select(Application.id).where(
            Application.application_number == f"{base_number}-R{revision}"
        )
    ) is not None:
        revision += 1
    resubmission = Application(
        application_number=f"{base_number}-R{revision}",
        institution_id=original.institution_id,
        institution_name=original.institution_name,
        category=original.category,
        academic_year=original.academic_year,
        declared_faculty=original.declared_faculty,
        declared_student_count=original.declared_student_count,
        declared_land_area=original.declared_land_area,
        owner_username=original.owner_username,
        status="draft",
    )
    db.add(resubmission)
    db.flush()
    append_audit(
        db,
        actor=user.username,
        action="application.resubmitted",
        entity_type="application",
        entity_id=resubmission.id,
        details={
            "original_application_id": original.id,
            "original_application_number": original.application_number,
            "resubmission_number": resubmission.application_number,
        },
    )
    db.commit()
    db.refresh(resubmission)
    return resubmission


@router.get("/{application_id}", response_model=ApplicationDetail)
def get_application(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
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
        .options(selectinload(Application.documents), selectinload(Application.findings))
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    _assert_application_access(application, user)
    return application


@router.post("/{application_id}/submit", response_model=ApplicationOut)
def submit_application(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
    require_role(user, "institution")
    application = db.scalar(
        select(Application)
        .where(Application.id == application_id)
        .options(selectinload(Application.documents))
    )
    if application is None or application.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")
    if application.status not in {"draft", "processing", "review_required"}:
        raise HTTPException(status_code=409, detail="This application cannot be submitted in its current status.")
    if not application.documents:
        raise HTTPException(status_code=409, detail="Upload supporting documents before submitting.")
    unfinished = [document for document in application.documents if document.status != "processed"]
    if unfinished:
        raise HTTPException(status_code=409, detail="Wait until every uploaded document has finished processing.")

    application.status = "pending_admin_review"
    append_audit(
        db,
        actor=user.username,
        action="application.submitted_for_admin_review",
        entity_type="application",
        entity_id=application.id,
        details={"application_number": application.application_number},
    )
    db.commit()
    db.refresh(application)
    return application


@router.get("/{application_id}/decision-report", response_model=ApplicationDecisionReport)
def get_decision_report(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    require_role(user, "admin", "institution")
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
    if user.role == "institution" and application.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")
    if application.status not in {"approved", "rejected"} or not application.decided_by or not application.decided_at:
        raise HTTPException(status_code=409, detail="A decision report is available after the System Administrator records a decision.")

    extractions = [
        extraction
        for document in application.documents
        for extraction in document.extractions
    ]
    return {
        "application_number": application.application_number,
        "institution_id": application.institution_id,
        "institution_name": application.institution_name,
        "category": application.category,
        "academic_year": application.academic_year,
        "status": application.status,
        "decision_note": application.decision_note,
        "decided_by": application.decided_by,
        "decided_at": application.decided_at,
        "match_summary": overall_metadata_match_score(application, extractions),
        "documents": application.documents,
        "findings": application.findings,
    }


@router.patch("/{application_id}", response_model=ApplicationOut)
def update_institution_application(
    application_id: str,
    payload: InstitutionApplicationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Application:
    require_role(user, "institution")
    application = db.get(Application, application_id)
    if application is None or application.owner_username != user.username:
        raise HTTPException(status_code=404, detail="Application not found.")
    if application.status in {"approved", "rejected", "pending_admin_review"}:
        raise HTTPException(status_code=409, detail="Submitted or decided applications cannot be edited.")
    updates = payload.model_dump(exclude_unset=True)
    if not updates or any(value is None for value in updates.values()):
        raise HTTPException(status_code=422, detail="Provide non-empty application details to update.")

    previous_values = {
        field: getattr(application, field)
        for field in updates
    }
    for field, value in updates.items():
        setattr(application, field, value)
    if application.status != "processing":
        application.status = "draft"
    append_audit(
        db,
        actor=user.username,
        action="application.details_updated",
        entity_type="application",
        entity_id=application.id,
        details={
            "application_number": application.application_number,
            "fields": sorted(updates),
            "previous_values": previous_values,
        },
    )
    db.commit()
    db.refresh(application)
    return application


@router.post(
    "/{application_id}/documents",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    application_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Document:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    _assert_application_access(application, user)
    require_role(user, "admin", "officer", "institution")
    if application.status in {"approved", "rejected", "pending_admin_review"}:
        raise HTTPException(status_code=409, detail="Documents cannot be added after submission for review.")
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Choose a document type from {sorted(DOCUMENT_TYPES)}.")
    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF documents are accepted.")
    data = await file.read(config.MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the configured upload limit.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF.")
    document = _persist_document(db, application, user, filename, document_type, data)
    background_tasks.add_task(process_document, document.id)
    return document


@router.post(
    "/{application_id}/documents/from-blob",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def register_blob_document(
    application_id: str,
    payload: StoredDocumentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Document:
    if config.DOCUMENT_STORAGE != "vercel_blob":
        raise HTTPException(status_code=503, detail="Private document storage is not configured.")
    require_role(user, "admin", "officer", "institution")
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    _assert_application_access(application, user)
    if application.status in {"approved", "rejected", "pending_admin_review"}:
        raise HTTPException(status_code=409, detail="Documents cannot be added after submission for review.")
    if not payload.storage_key.startswith(f"evidence/{application.id}/"):
        raise HTTPException(status_code=422, detail="Uploaded file does not belong to this application.")

    filename = Path(payload.filename.replace("\\", "/")).name
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF documents are accepted.")
    data = read_document_bytes(payload.storage_key)
    if len(data) > config.MAX_UPLOAD_BYTES:
        delete_document(payload.storage_key)
        raise HTTPException(status_code=413, detail="PDF exceeds the configured upload limit.")
    if not data.startswith(b"%PDF-"):
        delete_document(payload.storage_key)
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF.")

    document = _persist_document(
        db,
        application,
        user,
        filename,
        payload.document_type,
        data,
        payload.storage_key,
    )
    background_tasks.add_task(process_document, document.id)
    return document


@router.post(
    "/{application_id}/documents/{document_id}/retry",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_document_processing(
    application_id: str,
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Document:
    require_role(user, "admin", "officer")
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found.")
    _assert_application_access(application, user)
    if application.status in {"approved", "rejected"}:
        raise HTTPException(status_code=409, detail="Decided applications are read-only.")
    document = db.get(Document, document_id)
    if document is None or document.application_id != application.id:
        raise HTTPException(status_code=404, detail="Document not found.")
    if document.status not in {"failed", "processed"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or processed documents can be reprocessed.",
        )

    previous_status = document.status
    document.status = "uploaded"
    document.processing_error = None
    application.status = "processing"
    action = (
        "document.processing_retried"
        if previous_status == "failed"
        else "document.reprocessed"
    )
    append_audit(
        db,
        actor=user.username,
        action=action,
        entity_type="document",
        entity_id=document.id,
        details={"application_id": application.id},
    )
    db.commit()
    db.refresh(document)
    background_tasks.add_task(process_document, document.id)
    return document


@router.get("/documents/{document_id}/file", include_in_schema=True)
def download_document(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    require_role(
        user,
        "admin",
        "officer",
        "regulatory_officer",
        "compliance_admin",
        "institution",
    )
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    _assert_application_access(document.application, user)
    try:
        data = read_document_bytes(document.storage_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Stored PDF is unavailable.") from None
    from urllib.parse import quote

    filename = quote(document.filename, safe="")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
