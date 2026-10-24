from __future__ import annotations

import json
import operator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models import ComplianceRule


_OPERATORS = {
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    ">": operator.gt,
    "<": operator.lt,
}


class OcrProcessingError(RuntimeError):
    pass


@dataclass(frozen=True)
class PdfTextExtraction:
    raw_text: str
    page_texts: tuple[str, ...]
    page_count: int
    scanned_pages: int
    ocr_pages: int
    ocr_used_pages: int
    unreadable_scanned_pages: int


def _validate_pdf(pdf_bytes: bytes) -> fitz.Document:
    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    if pdf.is_encrypted:
        pdf.close()
        raise ValueError("Password-protected PDFs are not supported.")
    if pdf.page_count < 1 or pdf.page_count > 100:
        pdf.close()
        raise ValueError("PDF must contain between 1 and 100 pages.")
    return pdf


def get_pdf_page_count(pdf_bytes: bytes) -> int:
    pdf = _validate_pdf(pdf_bytes)
    try:
        return pdf.page_count
    finally:
        pdf.close()


def extract_pdf_document(pdf_bytes: bytes) -> PdfTextExtraction:
    text_by_page: list[str] = []
    scanned_pages = 0
    ocr_pages = 0
    ocr_used_pages = 0
    unreadable_scanned_pages = 0
    pdf = _validate_pdf(pdf_bytes)
    page_count = pdf.page_count
    try:
        for page in pdf:
            native_text = page.get_text("text").strip()
            image_info = page.get_image_info()
            image_area = sum(
                max(0.0, image["bbox"][2] - image["bbox"][0])
                * max(0.0, image["bbox"][3] - image["bbox"][1])
                for image in image_info
            )
            page_area = page.rect.get_area()
            has_scan_image = page_area > 0 and image_area / page_area >= 0.3
            has_vector_content = (
                bool(page.get_drawings()) if len(native_text) < 80 else False
            )
            is_scanned = len(native_text) < 80 and (
                has_scan_image or (not image_info and has_vector_content)
            )
            needs_ocr = has_scan_image or (
                not native_text and (bool(image_info) or has_vector_content)
            )

            if needs_ocr:
                ocr_pages += 1
                try:
                    text_page = page.get_textpage_ocr(
                        language=config.OCR_LANGUAGE,
                        dpi=config.OCR_DPI,
                        full=False,
                        tessdata=config.TESSDATA_PATH,
                    )
                except Exception as exc:
                    raise OcrProcessingError(
                        f"OCR failed for language {config.OCR_LANGUAGE!r}. "
                        "Install Tesseract OCR and verify that the matching "
                        f"language data are available. Engine error: {exc}"
                    ) from exc
                extracted_text = page.get_text("text", textpage=text_page).strip()
                if extracted_text != native_text:
                    ocr_used_pages += 1
                if is_scanned:
                    scanned_pages += 1
                    if extracted_text == native_text:
                        unreadable_scanned_pages += 1
            else:
                extracted_text = native_text
            text_by_page.append(extracted_text)
    finally:
        pdf.close()

    return PdfTextExtraction(
        raw_text="\n".join(text_by_page).strip(),
        page_texts=tuple(text_by_page),
        page_count=page_count,
        scanned_pages=scanned_pages,
        ocr_pages=ocr_pages,
        ocr_used_pages=ocr_used_pages,
        unreadable_scanned_pages=unreadable_scanned_pages,
    )


def extract_pdf_text(pdf_bytes: bytes) -> tuple[str, int]:
    result = extract_pdf_document(pdf_bytes)
    return result.raw_text, result.page_count


def load_rules(db: Session, academic_year: str) -> list[dict[str, Any]]:
    records = list(
        db.scalars(
            select(ComplianceRule).where(
                ComplianceRule.is_active.is_(True),
                ComplianceRule.academic_year.in_(("all", academic_year)),
            )
        )
    )
    selected: dict[str, ComplianceRule] = {}
    for record in records:
        previous = selected.get(record.rule_key)
        if previous is None or (
            record.academic_year == academic_year
            and previous.academic_year == "all"
        ):
            selected[record.rule_key] = record
    for rule in selected.values():
        if rule.operator not in _OPERATORS:
            raise ValueError(f"Unsupported operator in rule {rule.rule_key!r}.")
    return [
        {
            "id": rule.rule_key,
            "field": rule.field,
            "operator": rule.operator,
            "threshold": rule.threshold,
            "severity": rule.severity,
            "message": rule.message,
            "clause_reference": rule.clause_reference,
            "source_title": rule.source_title,
            "source_url": rule.source_url,
            "version": rule.version,
            "academic_year": rule.academic_year,
        }
        for rule in selected.values()
    ]


def seed_rules(db: Session) -> None:
    if db.scalar(select(ComplianceRule.id).limit(1)) is not None:
        return
    rules_path = Path(__file__).resolve().parents[1] / "rules.json"
    with rules_path.open(encoding="utf-8") as rules_file:
        rules = json.load(rules_file)
    for rule in rules:
        if rule.get("operator") not in _OPERATORS:
            raise ValueError(f"Unsupported operator in rule {rule.get('id')!r}.")
        db.add(
            ComplianceRule(
                rule_key=rule["id"],
                version=1,
                academic_year="all",
                field=rule["field"],
                operator=rule["operator"],
                threshold=rule["threshold"],
                severity=rule.get("severity", "medium"),
                message=rule["message"],
                source_title="Synthetic demonstration rules",
                created_by="system",
            )
        )
    db.commit()


def regulatory_findings(application: Any, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings = []
    for rule in rules:
        value = getattr(application, rule["field"], None)
        threshold = rule["threshold"]
        if value is None:
            continue
        if not _OPERATORS[rule["operator"]](value, threshold):
            findings.append(
                {
                    "rule_id": f"pipeline.{rule['id']}",
                    "category": "regulatory",
                    "severity": rule.get("severity", "medium"),
                    "message": rule["message"],
                    "expected": f"{rule['field']} {rule['operator']} {threshold}",
                    "actual": str(value),
                    "details": {
                        "source": rule.get("source_title", "Unspecified source"),
                        "source_url": rule.get("source_url"),
                        "clause_reference": rule.get("clause_reference"),
                        "rule_version": rule.get("version"),
                        "academic_year": rule.get("academic_year", "all"),
                    },
                }
            )
    return findings


def cross_document_findings(documents: list[Any]) -> list[dict[str, Any]]:
    values_by_field: dict[str, dict[str, str]] = {}
    for document in documents:
        for extraction in document.extractions:
            value = extraction.reviewed_value or extraction.extracted_value
            if value:
                values_by_field.setdefault(extraction.field_name, {})[document.id] = value.strip()

    findings = []
    for field_name in ("institution_name", "faculty_count", "academic_year"):
        values = values_by_field.get(field_name, {})
        canonical = {value.casefold() for value in values.values()}
        if len(canonical) > 1:
            findings.append(
                {
                    "rule_id": f"pipeline.cross_document.{field_name}",
                    "category": "consistency",
                    "severity": "high" if field_name == "faculty_count" else "medium",
                    "message": f"{field_name.replace('_', ' ').capitalize()} differs across documents.",
                    "expected": "The field should be consistent across supporting documents.",
                    "actual": str(values),
                    "details": {"per_document": values},
                }
            )
    return findings


def duplicate_finding(matching_document_ids: list[str]) -> dict[str, Any]:
    return {
        "rule_id": "pipeline.duplicate.exact_file_hash",
        "category": "duplicate",
        "severity": "high",
        "message": "This PDF is byte-identical to an existing document.",
        "expected": "Unique evidence file.",
        "actual": "Matching SHA-256 fingerprint found.",
        "details": {"matching_document_ids": matching_document_ids},
    }


def issuer_finding(affiliation_number: str) -> dict[str, Any] | None:
    value = affiliation_number.strip().upper()
    if value.startswith(("AICTE-FAKE", "UGC-INVALID")):
        return {
            "rule_id": "pipeline.issuer.mock_revocation",
            "category": "issuer",
            "severity": "high",
            "message": "The synthetic issuer registry marks this affiliation number revoked.",
            "expected": "Active affiliation record.",
            "actual": affiliation_number,
            "details": {"registry": "synthetic demo registry"},
        }
    return None
