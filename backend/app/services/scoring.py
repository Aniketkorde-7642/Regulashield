from __future__ import annotations

import os
from typing import Any

from app.services.extraction import (
    METADATA_MATCH_FIELDS,
    extraction_label_match_score,
    expected_application_value,
    value_match_score,
)


REQUIRED_DOCUMENT_TYPES = {
    "affiliation_letter": "Affiliation / approval letter",
    "faculty_certificate": "Faculty details or faculty certificate",
    "land_record": "Land ownership or lease evidence",
    "fire_safety": "Fire safety certificate",
}
REQUIRED_REVIEW_FIELDS = ("institution_name", "academic_year", "affiliation_number")
_DEFAULT_WEIGHTS = {
    "metadata_consistency": 0.5,
    "document_completeness": 0.3,
    "regulatory_compliance": 0.2,
}


def _score_settings() -> tuple[dict[str, float], int, tuple[str, ...]]:
    weights = {
        name: float(os.getenv(f"COMPLIANCE_WEIGHT_{name.upper()}", str(default)))
        for name, default in _DEFAULT_WEIGHTS.items()
    }
    if any(weight < 0 for weight in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("Compliance scoring weights must be nonnegative and sum above zero.")
    threshold = int(os.getenv("COMPLIANCE_APPROVE_THRESHOLD", "70"))
    if not 0 <= threshold <= 100:
        raise ValueError("COMPLIANCE_APPROVE_THRESHOLD must be between 0 and 100.")
    required_types = tuple(
        item.strip()
        for item in os.getenv(
            "COMPLIANCE_REQUIRED_DOCUMENT_TYPES",
            ",".join(REQUIRED_DOCUMENT_TYPES),
        ).split(",")
        if item.strip()
    )
    invalid_types = set(required_types) - REQUIRED_DOCUMENT_TYPES.keys()
    if invalid_types:
        raise ValueError(
            "COMPLIANCE_REQUIRED_DOCUMENT_TYPES contains unsupported types: "
            + ", ".join(sorted(invalid_types))
        )
    return weights, threshold, required_types


def calculate_compliance_score(
    application: object,
    documents: list[object],
    extractions: list[object],
    findings: list[object],
    rules: list[dict[str, Any]],
) -> dict[str, Any]:
    weights, threshold, required_types = _score_settings()
    weight_total = sum(weights.values())
    weights = {name: value / weight_total for name, value in weights.items()}

    field_scores = []
    missing_fields = []
    metadata_values = []
    metadata_fields = (*METADATA_MATCH_FIELDS, "application_category")
    scoring_fields = tuple(dict.fromkeys((*metadata_fields, *REQUIRED_REVIEW_FIELDS)))
    for field_name in scoring_fields:
        expected = expected_application_value(field_name, application)
        field_candidates = [
            extraction
            for extraction in extractions
            if getattr(extraction, "field_name", None) == field_name
        ]
        candidate_scores = [
            value_match_score(
                (
                    None
                    if getattr(item, "review_action", None) == "absent"
                    else getattr(item, "reviewed_value", None)
                    or getattr(item, "extracted_value", None)
                ),
                expected,
                field_name=field_name,
            )
            for item in field_candidates
        ]
        present_scores = [score for score in candidate_scores if score is not None]
        has_value = any(
            getattr(item, "review_action", None) != "absent"
            and (
                getattr(item, "reviewed_value", None)
                or getattr(item, "extracted_value", None)
            )
            for item in field_candidates
        )
        score = (
            sum(present_scores) / len(present_scores)
            if present_scores
            else 1.0 if expected is None and has_value else 0.0
        )
        if field_name in metadata_fields:
            metadata_values.append(score)
        if not has_value:
            missing_fields.append(field_name)
        field_scores.append(
            {
                "field_name": field_name,
                "expected_value": expected,
                "extracted_values": [
                    None
                    if getattr(item, "review_action", None) == "absent"
                    else getattr(item, "reviewed_value", None)
                    or getattr(item, "extracted_value", None)
                    for item in field_candidates
                ],
                "review_actions": [
                    getattr(item, "review_action", None) for item in field_candidates
                ],
                "score": round(score * 100),
                "sources": [
                    {
                        "document_id": getattr(item, "document_id", None),
                        "page": getattr(item, "source_page", None),
                    }
                    for item in field_candidates
                ],
            }
        )
    metadata_score = (
        sum(metadata_values) / len(metadata_fields) * 100
        if metadata_values
        else 0.0
    )

    extracted_label_scores = [
        extraction_label_match_score(
            getattr(item, "raw_ocr_text", None),
            getattr(item, "field_name", ""),
        )
        for item in extractions
        if getattr(item, "extracted_value", None)
    ]
    document_similarity = (
        sum(extracted_label_scores) / len(extracted_label_scores) * 100
        if extracted_label_scores
        else 0.0
    )

    completed_types = {
        getattr(document, "document_type", None)
        for document in documents
        if getattr(document, "status", None) == "processed"
    }
    missing_documents = [
        {
            "document_type": document_type,
            "label": REQUIRED_DOCUMENT_TYPES[document_type],
        }
        for document_type in required_types
        if document_type not in completed_types
    ]
    document_score = (
        (len(required_types) - len(missing_documents)) / len(required_types) * 100
        if required_types
        else 100.0
    )

    active_rules = {rule["id"] for rule in rules}
    open_findings = [
        finding
        for finding in findings
        if getattr(finding, "status", None) == "open"
    ]
    failed_rules = [
        finding
        for finding in open_findings
        if getattr(finding, "rule_id", "").removeprefix("pipeline.") in active_rules
    ]
    regulatory_score = (
        max(0.0, (len(active_rules) - len(failed_rules)) / len(active_rules) * 100)
        if active_rules
        else 0.0
    )
    failed_mandatory_rules = [
        {
            "rule_id": getattr(finding, "rule_id", ""),
            "message": getattr(finding, "message", ""),
            "severity": getattr(finding, "severity", ""),
        }
        for finding in open_findings
        if getattr(finding, "severity", "") == "high"
    ]

    overall = round(
        metadata_score * weights["metadata_consistency"]
        + document_score * weights["document_completeness"]
        + regulatory_score * weights["regulatory_compliance"]
    )
    has_unprocessed_documents = any(
        getattr(document, "status", None) != "processed" for document in documents
    )
    required_fields_missing = any(
        field_name in missing_fields for field_name in REQUIRED_REVIEW_FIELDS
    )
    needs_review = (
        not documents
        or has_unprocessed_documents
        or not active_rules
        or bool(missing_documents)
        or required_fields_missing
        or bool(failed_mandatory_rules)
    )
    recommendation = (
        "needs_review"
        if needs_review
        else "approve"
        if overall >= threshold
        else "reject"
    )

    return {
        "score": overall,
        "status": "needs_review" if needs_review else "scored",
        "recommendation": recommendation,
        "threshold": threshold,
        "weights": weights,
        "categories": {
            "metadata_consistency": round(metadata_score),
            "document_completeness": round(document_score),
            "regulatory_compliance": round(regulatory_score),
            "document_similarity": round(document_similarity),
        },
        "field_scores": field_scores,
        "missing_fields": missing_fields,
        "missing_documents": missing_documents,
        "failed_mandatory_rules": failed_mandatory_rules,
        "warnings": [
            "TF-IDF indicates textual similarity; it does not prove document authenticity."
        ],
    }
