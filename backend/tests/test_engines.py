import shutil
from types import SimpleNamespace

import fitz
import pytest

from app.db import normalize_database_url
from app.services.extraction import (
    extract_fields,
    field_label_match_score,
    normalize_value,
    overall_metadata_match_score,
    value_match_score,
)
from app.services.validation import cross_document_findings, extract_pdf_document


def test_postgres_urls_use_the_psycopg_sqlalchemy_driver():
    assert normalize_database_url("postgres://user:pass@db/app") == (
        "postgresql+psycopg://user:pass@db/app"
    )
    assert normalize_database_url("postgresql://user:pass@db/app") == (
        "postgresql+psycopg://user:pass@db/app"
    )


def make_scanned_pdf(text: str = "") -> bytes:
    source = fitz.open()
    page = source.new_page()
    if text:
        page.insert_text((60, 80), text, fontsize=18)
    image = page.get_pixmap(matrix=fitz.Matrix(3, 3)).tobytes("png")
    source.close()

    scanned = fitz.open()
    scanned_page = scanned.new_page()
    scanned_page.insert_image(scanned_page.rect, stream=image)
    data = scanned.tobytes()
    scanned.close()
    return data


def test_extracts_fields_and_marks_missing_values_for_review():
    text = "Institution Name: North Valley College\nFaculty Count: 42\nAcademic Year: 2026-27"
    fields = {field["field_name"]: field for field in extract_fields(text, 0.75)}

    assert fields["institution_name"]["extracted_value"] == "North Valley College"
    assert fields["faculty_count"]["extracted_value"] == "42"
    assert fields["institution_name"]["requires_review"] is False
    assert fields["expiry_date"]["extracted_value"] is None
    assert fields["expiry_date"]["requires_review"] is True


def test_normalize_value_collapses_whitespace_and_case():
    assert normalize_value("  North  Valley\tCollege ") == "north valley college"
    assert normalize_value("  ") is None


def test_tfidf_label_matching_extracts_common_document_label_variants():
    fields = {
        field["field_name"]: field
        for field in extract_fields(
            "Name of Institution: North Valley College\n"
            "Institution Code: INST-01\n"
            "Application Number: APP-01\n"
            "Number of Students: 1,234\n"
            "Session: 2026/2027",
            0.75,
        )
    }

    assert fields["institution_name"]["extracted_value"] == "North Valley College"
    assert fields["institution_id"]["extracted_value"] == "INST-01"
    assert fields["application_number"]["extracted_value"] == "APP-01"
    assert fields["student_count"]["extracted_value"] == "1,234"
    assert fields["academic_year"]["extracted_value"] == "2026/2027"
    assert fields["institution_name"]["label_match_score"] == 1.0
    assert field_label_match_score("Name of Institute", "institution_name") > 0.45


def test_extracts_ocr_labels_with_tabs_synonyms_and_filler_words():
    for institution_label in (
        "Name of the Institution\tNorth Valley College",
        "Name of the Institution:\nNorth Valley College",
    ):
        fields = {
            field["field_name"]: field
            for field in extract_fields(
                f"{institution_label}\n"
                "Total No. of Faculty: 24\n"
                "Total Strength of Students: 600\n"
                "Area of Campus (Acres): 4.5",
                0.75,
            )
        }

        assert fields["institution_name"]["extracted_value"] == "North Valley College"
        assert fields["faculty_count"]["extracted_value"] == "24"
        assert fields["student_count"]["extracted_value"] == "600"
        assert fields["land_area"]["extracted_value"] == "4.5"


def test_extracts_key_value_tables_without_mislabeling_reference_numbers_or_dates():
    fields = {
        field["field_name"]: field
        for field in extract_fields(
            "SAMPLE AFFILIATION LETTER\n"
            "Reference No.: APP-2026-003\n"
            "Date: 23 October 2026\n"
            "Institution\nCOEP\n"
            "Application number\nAPP-2026-003\n"
            "Institution ID\nINST-003\n"
            "Academic year\n2026–27\n"
            "Declared faculty\n10\n"
            "Declared students\n120\n"
            "Land area\n20 acres",
            0.75,
        )
    }

    assert fields["institution_name"]["extracted_value"] == "COEP"
    assert fields["application_number"]["extracted_value"] == "APP-2026-003"
    assert fields["institution_id"]["extracted_value"] == "INST-003"
    assert fields["academic_year"]["extracted_value"] == "2026-27"
    assert fields["faculty_count"]["extracted_value"] == "10"
    assert fields["student_count"]["extracted_value"] == "120"
    assert fields["land_area"]["extracted_value"] == "20 acres"
    assert fields["affiliation_number"]["extracted_value"] is None
    assert fields["issue_date"]["extracted_value"] is None
    assert fields["expiry_date"]["extracted_value"] is None


def test_metadata_similarity_scores_exact_values_and_academic_year_formats():
    assert value_match_score("1,234", "1234") == 1.0
    assert value_match_score("2026/2027", "2026-27") == 1.0
    assert value_match_score("20 acres", "20.0") == 1.0
    assert value_match_score("North Valley College", "North Valley Institute") > 0
    assert value_match_score("600", "900") == 0.0
    assert value_match_score(None, "600") is None


def test_overall_match_score_uses_fifty_percent_recommendation_threshold():
    application = SimpleNamespace(
        institution_name="North Valley College",
        institution_id="INST-001",
        application_number="APP-001",
        academic_year="2026-27",
        declared_faculty=24,
        declared_student_count=600,
        declared_land_area=4.5,
    )
    fields = [
        SimpleNamespace(field_name=field_name, extracted_value=value, reviewed_value=None)
        for field_name, value in (
            ("institution_name", "North Valley College"),
            ("institution_id", "INST-001"),
            ("application_number", "APP-001"),
            ("academic_year", "2026-27"),
            ("faculty_count", "24"),
            ("student_count", "600"),
            ("land_area", "4.5"),
        )
    ]

    perfect = overall_metadata_match_score(application, fields)
    assert perfect == {
        "score": 100,
        "matched_fields": 7,
        "total_fields": 7,
        "threshold": 50,
        "recommendation": "approve",
    }
    below_threshold = overall_metadata_match_score(application, fields[:3])
    assert below_threshold["score"] == 42
    assert below_threshold["recommendation"] == "reject"

    above_threshold = overall_metadata_match_score(application, fields[:4])
    assert above_threshold["score"] == 57
    assert above_threshold["recommendation"] == "approve"

    exact_threshold = overall_metadata_match_score(
        application,
        [
            SimpleNamespace(
                field_name="institution_name",
                extracted_value="North Valley Institute",
                reviewed_value=None,
            ),
            *fields[1:4],
        ],
    )
    assert exact_threshold["score"] == 50
    assert exact_threshold["recommendation"] == "reject"


def test_overall_match_score_uses_tfidf_for_names_and_exact_matches_for_ids():
    application = SimpleNamespace(
        institution_name="North Valley College",
        institution_id="INST-001",
        application_number="APP-001",
        academic_year="2026-27",
        declared_faculty=24,
        declared_student_count=600,
        declared_land_area=4.5,
    )
    fields = [
        SimpleNamespace(field_name=field_name, extracted_value=value, reviewed_value=None)
        for field_name, value in (
            ("institution_name", "North Valley Institute"),
            ("institution_id", "INST-001"),
            ("application_number", "APP-001"),
            ("academic_year", "2026/2027"),
            ("faculty_count", "24"),
            ("student_count", "600"),
            ("land_area", "4.500"),
        )
    ]

    summary = overall_metadata_match_score(application, fields)

    assert summary["score"] == 92
    assert summary["matched_fields"] == 6
    assert summary["recommendation"] == "approve"


def test_metadata_tfidf_does_not_give_partial_credit_for_mismatched_identifiers():
    assert value_match_score(
        "APP-2026-002",
        "APP-2026-001",
        field_name="application_number",
    ) == 0.0
    assert value_match_score(
        "North Valley Institute",
        "North Valley College",
        field_name="institution_name",
    ) > 0.0


def test_overall_match_score_never_rounds_a_nonperfect_match_up_to_100():
    application = SimpleNamespace(
        institution_name="North Valley College",
        institution_id="INST-001",
        application_number="APP-001",
        academic_year="2026-27",
        declared_faculty=24,
        declared_student_count=600,
        declared_land_area=4.5,
    )
    fields = [
        SimpleNamespace(field_name=field_name, extracted_value=value, reviewed_value=None)
        for field_name, value in (
            ("institution_name", "North Valley College"),
            ("institution_id", "INST-001"),
            ("application_number", "APP-001"),
            ("academic_year", "2026-27"),
            ("faculty_count", "24"),
            ("student_count", "600"),
            ("land_area", "4.5"),
        )
    ]
    fields.extend(
        SimpleNamespace(
            field_name="institution_name",
            extracted_value="North Valley College",
            reviewed_value=None,
        )
        for _ in range(99)
    )
    fields.append(
        SimpleNamespace(
            field_name="institution_name",
            extracted_value="North Valley Institute",
            reviewed_value=None,
        )
    )

    summary = overall_metadata_match_score(application, fields)

    assert summary["score"] == 99
    assert summary["matched_fields"] == 7


def test_missing_duplicate_extraction_counts_as_a_nonmatch():
    application = SimpleNamespace(
        institution_name="North Valley College",
        institution_id="INST-001",
        application_number="APP-001",
        academic_year="2026-27",
        declared_faculty=24,
        declared_student_count=600,
        declared_land_area=4.5,
    )
    fields = [
        SimpleNamespace(field_name=field_name, extracted_value=value, reviewed_value=None)
        for field_name, value in (
            ("institution_name", "North Valley College"),
            ("institution_id", "INST-001"),
            ("application_number", "APP-001"),
            ("academic_year", "2026-27"),
            ("faculty_count", "24"),
            ("student_count", "600"),
            ("land_area", "4.5"),
            ("institution_name", None),
        )
    ]

    summary = overall_metadata_match_score(application, fields)

    assert summary["score"] == 92
    assert summary["matched_fields"] == 6


def test_scanned_pdf_uses_ocr_and_marks_values_for_manual_review(monkeypatch):
    original_get_text = fitz.Page.get_text
    ocr_calls: list[dict[str, object]] = []

    def fake_ocr(page, **kwargs):
        ocr_calls.append(kwargs)
        return page.get_textpage()

    def fake_get_text(page, *args, **kwargs):
        text = original_get_text(page, *args, **kwargs)
        if kwargs.get("textpage") is not None and page.get_image_info():
            return (
                f"{text}\nName of Institution: Scanned Test College\n"
                "Academic Session: 2026-27\nAffiliation Number: OCR-TEST-001"
            )
        return text

    monkeypatch.setattr(fitz.Page, "get_textpage_ocr", fake_ocr)
    monkeypatch.setattr(fitz.Page, "get_text", fake_get_text)

    result = extract_pdf_document(make_scanned_pdf())
    fields = {
        field["field_name"]: field
        for field in extract_fields(result.raw_text, 0.75, ocr_used=result.ocr_pages > 0)
    }

    assert result.page_count == 1
    assert result.scanned_pages == 1
    assert result.ocr_pages == 1
    assert result.ocr_used_pages == 1
    assert result.unreadable_scanned_pages == 0
    assert fields["institution_name"]["extracted_value"] == "Scanned Test College"
    assert fields["institution_name"]["label_match_score"] == 1.0
    assert fields["institution_name"]["confidence"] == 0.45
    assert fields["institution_name"]["requires_review"] is True
    assert ocr_calls == [{"language": "eng", "dpi": 300, "full": False, "tessdata": None}]


def test_scanned_pdf_without_recognized_text_is_reported(monkeypatch):
    monkeypatch.setattr(fitz.Page, "get_textpage_ocr", lambda page, **kwargs: page.get_textpage())

    result = extract_pdf_document(make_scanned_pdf())

    assert result.raw_text == ""
    assert result.scanned_pages == 1
    assert result.ocr_used_pages == 0
    assert result.unreadable_scanned_pages == 1


def test_vector_only_page_without_native_text_is_sent_through_ocr(monkeypatch):
    document = fitz.open()
    page = document.new_page()
    page.draw_rect(fitz.Rect(30, 30, 570, 780), color=(0, 0, 0))
    pdf_bytes = document.tobytes()
    document.close()

    original_get_text = fitz.Page.get_text
    ocr_calls: list[dict[str, object]] = []

    def fake_ocr(page, **kwargs):
        ocr_calls.append(kwargs)
        return page.get_textpage()

    def fake_get_text(page, *args, **kwargs):
        text = original_get_text(page, *args, **kwargs)
        if kwargs.get("textpage") is not None and page.get_drawings():
            return f"{text}\nInstitution Name: Vector Scan College"
        return text

    monkeypatch.setattr(fitz.Page, "get_textpage_ocr", fake_ocr)
    monkeypatch.setattr(fitz.Page, "get_text", fake_get_text)

    result = extract_pdf_document(pdf_bytes)

    assert result.raw_text == "Institution Name: Vector Scan College"
    assert result.scanned_pages == 1
    assert result.ocr_used_pages == 1
    assert len(ocr_calls) == 1


def test_missing_tesseract_returns_actionable_error(monkeypatch):
    def missing_tesseract(page, **kwargs):
        raise RuntimeError("No tessdata specified and Tesseract is not installed")

    monkeypatch.setattr(fitz.Page, "get_textpage_ocr", missing_tesseract)

    try:
        extract_pdf_document(make_scanned_pdf())
    except RuntimeError as exc:
        assert "Install Tesseract OCR" in str(exc)
    else:
        raise AssertionError("OCR without Tesseract must fail with setup guidance.")


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed")
def test_installed_tesseract_reads_an_image_only_pdf():
    result = extract_pdf_document(
        make_scanned_pdf(
            "Institution Name: OCR Test College\n"
            "Academic Year: 2026-27\n"
            "Affiliation Number: OCR-REAL-001"
        )
    )
    fields = {
        field["field_name"]: field
        for field in extract_fields(result.raw_text, 0.75, ocr_used=result.ocr_used_pages > 0)
    }

    assert result.scanned_pages == 1
    assert result.ocr_used_pages == 1
    assert fields["institution_name"]["extracted_value"] == "OCR Test College"
    assert fields["academic_year"]["extracted_value"] == "2026-27"
    assert fields["affiliation_number"]["extracted_value"] == "OCR-REAL-001"


def test_cross_document_mismatch_is_evidence_linked():
    class Extraction:
        def __init__(self, field_name, value):
            self.field_name = field_name
            self.extracted_value = value
            self.reviewed_value = None

    class Document:
        def __init__(self, document_id, name, count):
            self.id = document_id
            self.extractions = [
                Extraction("institution_name", name),
                Extraction("faculty_count", count),
            ]

    findings = cross_document_findings(
        [Document("doc-a", "North College", "20"), Document("doc-b", "South College", "30")]
    )
    assert {finding["rule_id"] for finding in findings} == {
        "pipeline.cross_document.institution_name",
        "pipeline.cross_document.faculty_count",
    }
    assert all(finding["severity"] in {"medium", "high"} for finding in findings)
