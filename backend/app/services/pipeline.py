from __future__ import annotations

import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import config
from app.db import SessionLocal
from app.models import Application, Document, FieldExtraction, Finding
from app.services.audit import append_audit
from app.services.extraction import (
    expected_application_value,
    extract_fields,
    value_match_score,
)
from app.services.storage import read_document_bytes
from app.services.validation import (
    cross_document_findings,
    extract_pdf_document,
    issuer_finding,
    load_rules,
    regulatory_findings,
)

logger = logging.getLogger(__name__)


def _save_findings(
    db: Session,
    application_id: str,
    findings: list[dict],
    document_id: str | None = None,
) -> None:
    for finding in findings:
        db.add(
            Finding(
                application_id=application_id,
                document_id=document_id,
                rule_id=finding["rule_id"],
                category=finding["category"],
                severity=finding["severity"],
                message=finding["message"],
                expected=finding.get("expected"),
                actual=finding.get("actual"),
                details=finding.get("details", {}),
            )
        )


def process_document(document_id: str) -> None:
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if document is None:
            return
        application = db.get(Application, document.application_id)
        if application is None:
            document.status = "failed"
            document.processing_error = "Parent application no longer exists."
            db.commit()
            return

        document.status = "processing"
        document.processing_error = None
        db.commit()

        pdf_bytes = read_document_bytes(document.storage_key)
        extraction = extract_pdf_document(pdf_bytes)
        raw_text = extraction.raw_text
        page_count = extraction.page_count
        document.raw_text = raw_text
        document.page_count = page_count
        document.extractions.clear()
        for field in extract_fields(
            raw_text,
            config.FIELD_CONFIDENCE_THRESHOLD,
            ocr_used=extraction.ocr_used_pages > 0,
        ):
            metadata_score = value_match_score(
                field["extracted_value"],
                expected_application_value(field["field_name"], application),
            )
            if metadata_score is not None and metadata_score < 0.99:
                field["requires_review"] = True
            document.extractions.append(
                FieldExtraction(
                    **{key: value for key, value in field.items() if key != "label_match_score"}
                )
            )
        document.status = "processed"
        db.flush()

        db.execute(
            delete(Finding).where(
                Finding.application_id == application.id,
                (Finding.rule_id.like("pipeline.%"))
                | (Finding.rule_id == "extraction.scanned_pdf_no_ocr"),
                Finding.status == "open",
            )
        )
        db.flush()
        if extraction.unreadable_scanned_pages:
            _save_findings(
                db,
                application.id,
                [
                    {
                        "rule_id": "extraction.scanned_pdf_no_ocr",
                        "category": "extraction",
                        "severity": "high",
                        "message": (
                            "OCR could not read text from "
                            f"{extraction.unreadable_scanned_pages} scanned page(s). "
                            "Review the source PDF and enter missing fields manually."
                        ),
                        "expected": "Readable text on each scanned page.",
                        "actual": "No text was recognized on one or more scanned pages.",
                        "details": {
                            "scanned_pages": extraction.scanned_pages,
                            "ocr_pages": extraction.ocr_pages,
                            "ocr_used_pages": extraction.ocr_used_pages,
                            "unreadable_scanned_pages": extraction.unreadable_scanned_pages,
                        },
                    }
                ],
                document_id=document.id,
            )

        documents = list(
            db.scalars(
                select(Document)
                .where(Document.application_id == application.id, Document.status == "processed")
                .order_by(Document.created_at)
            ).unique()
        )
        db.flush()
        findings = cross_document_findings(documents)
        findings.extend(
            regulatory_findings(
                application,
                load_rules(db, application.academic_year),
            )
        )
        _save_findings(db, application.id, findings)

        affiliations = {
            extraction.extracted_value
            for item in documents
            for extraction in item.extractions
            if extraction.field_name == "affiliation_number" and extraction.extracted_value
        }
        for affiliation in affiliations:
            issuer_result = issuer_finding(affiliation)
            if issuer_result:
                _save_findings(db, application.id, [issuer_result])

        for item in documents:
            matches = list(
                db.scalars(
                    select(Document.id).where(
                        Document.file_hash == item.file_hash,
                        Document.id != item.id,
                    )
                )
            )
            if matches:
                _save_findings(
                    db,
                    application.id,
                    [
                        {
                            "rule_id": "pipeline.duplicate.exact_file_hash",
                            "category": "duplicate",
                            "severity": "high",
                            "message": "This PDF is byte-identical to an existing document.",
                            "expected": "Unique evidence file.",
                            "actual": "Matching SHA-256 fingerprint found.",
                            "details": {"matching_document_ids": matches},
                        }
                    ],
                    document_id=item.id,
                )

        if application.status not in {"approved", "rejected"}:
            application.status = "review_required"
        append_audit(
            db,
            actor="system",
            action="document.processed",
            entity_type="document",
            entity_id=document.id,
            details={
                "page_count": page_count,
                "extracted_characters": len(raw_text),
                "ocr_pages": extraction.ocr_pages,
                "scanned_pages": extraction.scanned_pages,
                "unreadable_scanned_pages": extraction.unreadable_scanned_pages,
            },
        )
        db.commit()
    except Exception as exc:
        logger.exception("Document processing failed for %s", document_id)
        db.rollback()
        failed_document = db.get(Document, document_id)
        if failed_document:
            failed_document.status = "failed"
            failed_document.processing_error = str(exc)[:500]
            failed_application = db.get(Application, failed_document.application_id)
            if failed_application and failed_application.status not in {"approved", "rejected"}:
                failed_application.status = "review_required"
            append_audit(
                db,
                actor="system",
                action="document.processing_failed",
                entity_type="document",
                entity_id=failed_document.id,
                details={"error": failed_document.processing_error},
            )
            db.commit()
    finally:
        db.close()
