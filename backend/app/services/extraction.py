from __future__ import annotations

import re
import unicodedata
from collections import Counter
from math import log, sqrt


FIELD_PATTERNS: dict[str, str] = {
    "institution_name": r"^\s*(?:Institution|College|University|Institute)(?:\s+Name)?\s*[:\-]\s*([^\r\n]{2,160})",
    "institution_id": r"^\s*(?:Institution|College|University|Institute)\s+(?:ID|Code|Number|No\.?)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/]{1,})",
    "application_number": r"^\s*Application\s+(?:Number|No\.?|ID)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/]{1,})",
    "faculty_count": r"^\s*(?:Faculty|Teaching\s+Staff)(?:\s+(?:Count|Strength))?\s*[:\-]\s*(\d[\d,]{0,9})\b",
    "student_count": r"^\s*(?:Student|Enrollment|Enrolment)(?:\s+(?:Count|Strength))?\s*[:\-]\s*(\d[\d,]{0,9})\b",
    "academic_year": r"^\s*Academic\s+(?:Year|Session)\s*[:\-]\s*(\d{4}\s*[-–—/�]\s*\d{2,4})\b",
    "affiliation_number": r"^\s*Affiliation(?:\s+(?:No\.?|Number))?\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/]{2,})",
    "land_area": r"^\s*(?:Land|Campus)\s+Area\s*[:\-]\s*([\d,.]+\s*(?:sq\.?\s*m(?:eters?)?|sqft|acres?|hectares?)?)",
    "issue_date": r"^\s*(?:Issue\s*Date|Issued\s*On|Date\s+of\s+Issue)\s*[:\-]\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}|[0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})",
    "expiry_date": r"^\s*(?:Expiry\s*Date|Expiration\s*Date|Valid\s+Until|Valid\s+Up\s+To)\s*[:\-]\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}|[0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})",
    "application_category": r"^\s*(?:Application\s+)?(?:Category|Type\s+of\s+Application)\s*[:\-]\s*([A-Z][A-Z0-9 _/-]{1,31})",
    "certificate_number": r"^\s*(?:Certificate|Registration|Permit)\s+(?:No\.?|Number|ID)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/]{2,})",
}

FIELD_LABELS: dict[str, tuple[str, ...]] = {
    "institution_name": (
        "institution",
        "institution name",
        "name of institution",
        "college name",
        "name of college",
        "university name",
        "name of university",
        "institute name",
    ),
    "institution_id": (
        "institution id",
        "institution identifier",
        "institution code",
        "college code",
        "university code",
        "institute code",
    ),
    "application_number": (
        "application number",
        "application no",
        "application id",
        "application reference number",
    ),
    "faculty_count": (
        "declared faculty",
        "declared faculty count",
        "faculty count",
        "total faculty",
        "total faculty count",
        "faculty members",
        "total faculty members",
        "total no of faculty",
        "total number of faculty",
        "number of faculty members",
        "no of faculty",
        "number of faculty",
        "faculty strength",
        "teaching staff",
        "total teaching staff",
        "number of teachers",
    ),
    "student_count": (
        "declared students",
        "declared student count",
        "student count",
        "total students",
        "total student count",
        "students strength",
        "total strength of students",
        "total number of students",
        "no of students",
        "number of students",
        "student strength",
        "enrollment",
        "enrolment",
    ),
    "academic_year": ("academic year", "academic session", "session"),
    "affiliation_number": (
        "affiliation number",
        "affiliation no",
        "affiliation id",
        "affiliation code",
    ),
    "land_area": (
        "land area",
        "declared land area",
        "campus area",
        "site area",
        "area of campus",
        "area of campus acres",
        "campus area acres",
        "total area",
    ),
    "issue_date": ("issue date", "issued on", "date of issue"),
    "expiry_date": ("expiry date", "expiration date", "valid until", "valid up to"),
    "application_category": (
        "application category",
        "category",
        "application type",
        "type of application",
    ),
    "certificate_number": (
        "certificate number",
        "certificate no",
        "registration number",
        "permit number",
    ),
}

DOCUMENT_FIELD_SCHEMAS: dict[str, tuple[str, ...]] = {
    "affiliation_letter": (
        "institution_name",
        "institution_id",
        "application_number",
        "academic_year",
        "affiliation_number",
        "application_category",
        "issue_date",
        "expiry_date",
        "certificate_number",
    ),
    "faculty_certificate": (
        "institution_name",
        "institution_id",
        "academic_year",
        "faculty_count",
        "issue_date",
        "expiry_date",
        "certificate_number",
    ),
    "land_record": (
        "institution_name",
        "institution_id",
        "land_area",
        "issue_date",
        "expiry_date",
        "certificate_number",
    ),
    "fire_safety": (
        "institution_name",
        "institution_id",
        "issue_date",
        "expiry_date",
        "certificate_number",
    ),
    "other": tuple(FIELD_PATTERNS),
}

METADATA_MATCH_FIELDS = (
    "institution_name",
    "institution_id",
    "application_number",
    "academic_year",
    "faculty_count",
    "student_count",
    "land_area",
)
MATCH_RECOMMENDATION_THRESHOLD = 50

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)
_LABEL_VALUE_PATTERN = re.compile(
    r"^\s*(.{2,80}?)(?:\s*[:=|：]\s*|\s+[-–—]\s+|\t+|\s{2,})(.*?)\s*$"
)
_LABEL_STOPWORDS = frozenset({"a", "and", "of", "the"})


def _label_tokens(label: str) -> list[str]:
    return [
        token
        for token in _TOKEN_PATTERN.findall(label.casefold())
        if token not in _LABEL_STOPWORDS
    ]


_ALIAS_DOCUMENTS = [
    _label_tokens(alias)
    for aliases in FIELD_LABELS.values()
    for alias in aliases
]
_ALIAS_DOCUMENT_FREQUENCY = Counter(
    token for document in _ALIAS_DOCUMENTS for token in set(document)
)


def normalize_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = unicodedata.normalize("NFKC", value)
    normalized = " ".join(normalized.casefold().split())
    return normalized or None


def _tfidf_vector(tokens: list[str], document_count: int, document_frequency: Counter[str]) -> dict[str, float]:
    counts = Counter(tokens)
    return {
        token: (count / len(tokens))
        * (log((document_count + 1) / (document_frequency[token] + 1)) + 1)
        for token, count in counts.items()
    } if tokens else {}


def _cosine_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    left_norm = sqrt(sum(value * value for value in left.values()))
    right_norm = sqrt(sum(value * value for value in right.values()))
    if not left_norm or not right_norm:
        return 0.0
    return sum(value * right.get(token, 0.0) for token, value in left.items()) / (
        left_norm * right_norm
    )


def _normalized_label(label: str) -> str:
    return " ".join(_label_tokens(label))


def field_label_match_score(label: str, field_name: str) -> float:
    """Return the best TF-IDF cosine similarity between a label and known field aliases."""
    aliases = FIELD_LABELS.get(field_name, ())
    if not aliases:
        return 0.0
    label_tokens = _label_tokens(label)
    label_normalized = " ".join(label_tokens)
    label_vector = _tfidf_vector(
        label_tokens, len(_ALIAS_DOCUMENTS), _ALIAS_DOCUMENT_FREQUENCY
    )
    return max(
        (
            1.0
            if label_normalized == _normalized_label(alias)
            else _cosine_similarity(
                label_vector,
                _tfidf_vector(
                    _TOKEN_PATTERN.findall(alias.casefold()),
                    len(_ALIAS_DOCUMENTS),
                    _ALIAS_DOCUMENT_FREQUENCY,
                ),
            )
            for alias in aliases
        ),
        default=0.0,
    )


def _resolve_field_label(label: str) -> tuple[str, float] | None:
    normalized = _normalized_label(label)
    exact_matches = [
        field_name
        for field_name, aliases in FIELD_LABELS.items()
        if any(normalized == _normalized_label(alias) for alias in aliases)
    ]
    if len(exact_matches) == 1:
        return exact_matches[0], 1.0
    if exact_matches:
        return None

    ranked = sorted(
        (
            (field_name, field_label_match_score(label, field_name))
            for field_name in FIELD_LABELS
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    if len(ranked) < 2 or ranked[0][1] < 0.72 or ranked[0][1] - ranked[1][1] < 0.12:
        return None
    return ranked[0]


def _valid_candidate_value(field_name: str, value: str) -> str | None:
    value = value.strip().replace("\ufffd", "-")
    if field_name == "academic_year":
        value = value.replace("\u2013", "-").replace("\u2014", "-")
    if not value:
        return None
    patterns = {
        "institution_name": r"^[^\r\n]{2,160}$",
        "institution_id": r"^[A-Z0-9][A-Z0-9\-/]{1,}$",
        "application_number": r"^[A-Z0-9][A-Z0-9\-/]{1,}$",
        "faculty_count": r"^\d[\d,]{0,9}$",
        "student_count": r"^\d[\d,]{0,9}$",
        "academic_year": r"^\d{4}\s*[-–—/]\s*\d{2,4}$",
        "affiliation_number": r"^[A-Z0-9][A-Z0-9\-/]{2,}$",
        "land_area": r"^[\d,.]+\s*(?:sq\.?\s*m(?:eters?)?|sqft|acres?|hectares?)?$",
        "issue_date": r"^(?:[0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}|[0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})$",
        "expiry_date": r"^(?:[0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}|[0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})$",
        "application_category": r"^[A-Z][A-Z0-9 _/-]{1,31}$",
        "certificate_number": r"^[A-Z0-9][A-Z0-9\-/]{2,}$",
    }
    if not re.fullmatch(patterns[field_name], value, flags=re.IGNORECASE):
        return None
    return value


def value_match_score(
    extracted_value: str | None,
    expected_value: str | None,
    *,
    field_name: str | None = None,
) -> float | None:
    if not extracted_value or not expected_value:
        return None
    extracted_normalized = normalize_value(extracted_value)
    expected_normalized = normalize_value(expected_value)
    if extracted_normalized is None or expected_normalized is None:
        return None
    year_pattern = re.compile(r"^(\d{4})\s*[-/–—]\s*(\d{2,4})$")
    extracted_year = year_pattern.fullmatch(extracted_normalized)
    expected_year = year_pattern.fullmatch(expected_normalized)
    if extracted_year:
        end_year = extracted_year.group(2)
        extracted_normalized = f"{extracted_year.group(1)}-{end_year[-2:]}"
    if expected_year:
        end_year = expected_year.group(2)
        expected_normalized = f"{expected_year.group(1)}-{end_year[-2:]}"
    extracted_measurement = re.fullmatch(
        r"(\d[\d,]*(?:\.\d+)?)(?:\s+[a-z.]+)?", extracted_normalized
    )
    if extracted_measurement and re.fullmatch(
        r"\d[\d,]*(?:\.\d+)?", expected_normalized
    ):
        extracted_number = float(extracted_measurement.group(1).replace(",", ""))
        expected_number = float(expected_normalized.replace(",", ""))
        if extracted_number == expected_number:
            return 1.0
    if extracted_normalized == expected_normalized:
        return 1.0
    if field_name is not None and field_name != "institution_name":
        return 0.0
    extracted_tokens = _TOKEN_PATTERN.findall(extracted_normalized or "")
    expected_tokens = _TOKEN_PATTERN.findall(expected_normalized or "")
    documents = [extracted_tokens, expected_tokens]
    frequencies = Counter(token for document in documents for token in set(document))
    left = _tfidf_vector(extracted_tokens, len(documents), frequencies)
    right = _tfidf_vector(expected_tokens, len(documents), frequencies)
    return _cosine_similarity(left, right)


def expected_application_value(field_name: str, application: object) -> str | None:
    application_fields = {
        "institution_name": "institution_name",
        "institution_id": "institution_id",
        "application_number": "application_number",
        "academic_year": "academic_year",
        "application_category": "category",
        "faculty_count": "declared_faculty",
        "student_count": "declared_student_count",
        "land_area": "declared_land_area",
    }
    attribute = application_fields.get(field_name)
    value = getattr(application, attribute, None) if attribute else None
    return str(value) if value is not None else None


def overall_metadata_match_score(
    application: object, extractions: list[object]
) -> dict[str, int | str]:
    scores: list[float] = []
    for field_name in METADATA_MATCH_FIELDS:
        expected_value = expected_application_value(field_name, application)
        candidates = [
            getattr(extraction, "reviewed_value", None)
            or getattr(extraction, "extracted_value", None)
            for extraction in extractions
            if getattr(extraction, "field_name", None) == field_name
        ]
        candidate_scores = [
            value_match_score(
                candidate,
                expected_value,
                field_name=field_name,
            )
            or 0.0
            for candidate in candidates
        ]
        scores.append(sum(candidate_scores) / len(candidate_scores) if candidate_scores else 0.0)

    unrounded_score = sum(scores) / len(METADATA_MATCH_FIELDS) * 100
    score_percent = int(unrounded_score)
    return {
        "score": score_percent,
        "matched_fields": sum(score >= 0.75 for score in scores),
        "total_fields": len(METADATA_MATCH_FIELDS),
        "threshold": MATCH_RECOMMENDATION_THRESHOLD,
        "recommendation": (
            "approve" if score_percent > MATCH_RECOMMENDATION_THRESHOLD else "reject"
        ),
    }


def extraction_label_match_score(raw_text: str | None, field_name: str) -> float:
    if not raw_text:
        return 0.0
    label_value = _LABEL_VALUE_PATTERN.match(raw_text)
    if label_value:
        return field_label_match_score(label_value.group(1), field_name)
    label, separator, _ = raw_text.partition("\n")
    if separator:
        resolved = _resolve_field_label(label)
        return resolved[1] if resolved and resolved[0] == field_name else 0.0
    return 0.0


def extract_fields(
    raw_text: str,
    confidence_threshold: float,
    *,
    ocr_used: bool = False,
    page_texts: tuple[str, ...] | None = None,
) -> list[dict[str, object]]:
    pages = page_texts or (raw_text,)
    fields_by_name: dict[str, dict[str, object]] = {}
    for page_number, page_text in enumerate(pages, start=1):
        for field in _extract_page_fields(
            page_text,
            confidence_threshold,
            ocr_used=ocr_used,
            source_page=page_number if page_texts else None,
        ):
            if field["extracted_value"] is None:
                fields_by_name.setdefault(str(field["field_name"]), field)
            elif (
                str(field["field_name"]) not in fields_by_name
                or field["confidence"]
                > fields_by_name[str(field["field_name"])]["confidence"]
            ):
                fields_by_name[str(field["field_name"])] = field
    return list(fields_by_name.values())


def _extract_page_fields(
    raw_text: str,
    confidence_threshold: float,
    *,
    ocr_used: bool,
    source_page: int | None,
) -> list[dict[str, object]]:
    candidates: dict[str, tuple[float, str, str]] = {}
    lines = [line.strip() for line in raw_text.splitlines()]

    def add_candidate(field_name: str, score: float, value: str, source: str) -> None:
        valid_value = _valid_candidate_value(field_name, value)
        if valid_value and (
            field_name not in candidates or score > candidates[field_name][0]
        ):
            candidates[field_name] = (score, valid_value, source.strip())

    for index, line in enumerate(lines):
        if not line:
            continue
        label_value = _LABEL_VALUE_PATTERN.match(line)
        if label_value:
            label, value = label_value.groups()
            resolved = _resolve_field_label(label)
            if resolved:
                field_name, score = resolved
                if value.strip():
                    add_candidate(field_name, score, value, line)
                else:
                    value_index = index + 1
                    while value_index < len(lines) and not lines[value_index]:
                        value_index += 1
                    if (
                        value_index < len(lines)
                        and not _resolve_field_label(lines[value_index])
                        and not _LABEL_VALUE_PATTERN.match(lines[value_index])
                    ):
                        add_candidate(
                            field_name,
                            score,
                            lines[value_index],
                            f"{line}\n{lines[value_index]}",
                        )
            continue

        resolved = _resolve_field_label(line)
        if not resolved:
            continue
        field_name, score = resolved
        value_index = index + 1
        while value_index < len(lines) and not lines[value_index]:
            value_index += 1
        if value_index >= len(lines) or _resolve_field_label(lines[value_index]):
            continue
        value = lines[value_index]
        value_label = _LABEL_VALUE_PATTERN.match(value)
        if value_label and _resolve_field_label(value_label.group(1)):
            continue
        add_candidate(field_name, score, value, f"{line}\n{value}")

    fields: list[dict[str, object]] = []
    for field_name, pattern in FIELD_PATTERNS.items():
        match = re.search(pattern, raw_text, flags=re.IGNORECASE | re.MULTILINE)
        label_score = 0.0
        source_text = None
        if match:
            regex_source = match.group(0).strip()
            label_value = _LABEL_VALUE_PATTERN.match(regex_source)
            if label_value:
                resolved = _resolve_field_label(label_value.group(1))
                if resolved and resolved[0] == field_name:
                    label_score = resolved[1]
                    source_text = regex_source
                    add_candidate(
                        field_name,
                        label_score,
                        match.group(1),
                        regex_source,
                    )
        candidate = candidates.get(field_name)
        value = candidate[1] if candidate else None
        if candidate:
            label_score, _, source_text = candidate
        confidence = (0.45 if ocr_used else 0.92) * label_score if value else 0.0
        fields.append(
            {
                "field_name": field_name,
                "extracted_value": value,
                "normalized_value": normalize_value(value),
                "confidence": confidence,
                "raw_ocr_text": source_text,
                "source_page": source_page if value else None,
                "label_match_score": label_score,
                "requires_review": ocr_used or confidence < confidence_threshold or value is None,
            }
        )
    return fields
