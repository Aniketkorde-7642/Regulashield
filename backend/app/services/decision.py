from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, Document, FieldExtraction, Finding


def approval_blockers(db: Session, application_id: str) -> list[str]:
    application = db.get(Application, application_id)
    if application is None:
        return ["Application not found."]

    blockers: list[str] = []
    documents = list(
        db.scalars(select(Document).where(Document.application_id == application_id))
    )
    if not documents:
        blockers.append("Upload at least one supporting PDF before approval.")
    pending_documents = [
        document
        for document in documents
        if document.status in {"uploaded", "processing"}
    ]
    if pending_documents:
        blockers.append(
            f"{len(pending_documents)} document(s) are still processing."
        )
    failed_documents = [
        document for document in documents if document.status == "failed"
    ]
    if failed_documents:
        blockers.append(
            f"{len(failed_documents)} document(s) failed processing."
        )

    pending_fields = list(
        db.scalars(
            select(FieldExtraction)
            .join(Document, FieldExtraction.document_id == Document.id)
            .where(
                Document.application_id == application_id,
                (FieldExtraction.review_action.is_(None))
                | FieldExtraction.requires_review.is_(True),
            )
        )
    )
    if pending_fields:
        blockers.append(f"{len(pending_fields)} extracted field(s) awaiting review.")

    required_fields = {"institution_name", "academic_year", "affiliation_number"}
    available_fields = set(
        db.scalars(
            select(FieldExtraction.field_name)
            .join(Document, FieldExtraction.document_id == Document.id)
            .where(
                Document.application_id == application_id,
                FieldExtraction.field_name.in_(required_fields),
                (FieldExtraction.review_action.is_(None))
                | (FieldExtraction.review_action != "absent"),
                FieldExtraction.reviewed_value.is_not(None)
                | FieldExtraction.extracted_value.is_not(None),
            )
        )
    )
    missing_fields = sorted(required_fields - available_fields)
    if missing_fields:
        blockers.append(
            f"Required evidence fields are missing: {', '.join(missing_fields)}."
        )

    high_findings = list(
        db.scalars(
            select(Finding.id).where(
                Finding.application_id == application_id,
                Finding.status == "open",
                Finding.severity == "high",
            )
        )
    )
    if high_findings:
        blockers.append(
            f"{len(high_findings)} open high-severity finding(s) must be resolved or dismissed."
        )

    if application.status in {"approved", "rejected"}:
        blockers.append("A final decision has already been recorded.")

    return blockers


def can_approve(db: Session, application_id: str) -> bool:
    return not approval_blockers(db, application_id)
