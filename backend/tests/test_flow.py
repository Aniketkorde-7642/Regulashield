from __future__ import annotations

import shutil
from uuid import uuid4

import fitz
import pytest
from fastapi.testclient import TestClient

from app import config
from app.api import applications as applications_api
from app.db import SessionLocal
from app.models import Application, Document, User
from app.services.security import bootstrap_users, demo_role_passwords


def make_pdf(text: str) -> bytes:
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((60, 80), text)
    data = pdf.tobytes()
    pdf.close()
    return data


def make_scanned_pdf(text: str) -> bytes:
    source = fitz.open()
    source_page = source.new_page()
    source_page.insert_text((60, 80), text, fontsize=18)
    image = source_page.get_pixmap(matrix=fitz.Matrix(3, 3)).tobytes("png")
    source.close()

    scanned = fitz.open()
    scanned_page = scanned.new_page()
    scanned_page.insert_image(scanned_page.rect, stream=image)
    data = scanned.tobytes()
    scanned.close()
    return data


def create_application(client: TestClient, _headers: dict[str, str]) -> dict:
    admin_headers = login_headers(client, "admin", "test-admin-password")
    response = client.post(
        "/api/applications",
        headers=admin_headers,
        json={
            "application_number": "APP-2026-001",
            "institution_id": "INST-001",
            "institution_name": "North Valley College",
            "category": "EOA",
            "academic_year": "2026-27",
            "declared_faculty": 24,
            "declared_student_count": 600,
            "declared_land_area": 4.5,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def login_headers(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_authentication_is_required(client: TestClient):
    response = client.get("/api/applications")
    assert response.status_code == 401


def test_scrutiny_officer_cannot_create_new_application(
    client: TestClient, auth_headers: dict[str, str]
):
    response = client.post(
        "/api/applications",
        headers=auth_headers,
        json={
            "application_number": "OFFICER-APP-001",
            "institution_id": "OFFICER-001",
            "institution_name": "Officer Created College",
            "academic_year": "2026-27",
            "declared_faculty": 10,
        },
    )

    assert response.status_code == 403


def test_dashboard_and_health_are_served(client: TestClient):
    assert client.get("/health").json() == {"status": "ok"}
    dashboard = client.get("/")
    assert dashboard.status_code == 200
    assert "Regula Shield" in dashboard.text
    assert client.get("/static/app.js").status_code == 200


def test_role_demo_passwords_are_only_returned_for_demo_accounts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    assert client.get("/api/auth/demo-credentials").json() == {}

    demo_password = "test-only-demo-password"
    monkeypatch.setattr(config, "DEMO_ROLE_PASSWORD", demo_password)
    monkeypatch.setattr(config, "DEMO_MODE", True)
    with SessionLocal() as db:
        bootstrap_users(db)

    response = client.get("/api/auth/demo-credentials")

    assert response.status_code == 200
    assert response.json() == demo_role_passwords()
    assert set(response.json()) == {
        "admin",
        "officer",
        "regulatory",
        "compliance",
        "institution",
    }
    assert set(response.json().values()) == {demo_password}
    previous_passwords = {
        "admin": "test-admin-password",
        "officer": "test-officer-password",
        "regulatory": "test-regulatory-password",
        "compliance": "test-compliance-password",
        "institution": "test-institution-password",
    }
    for username, password in response.json().items():
        previous_login = client.post(
            "/api/auth/login",
            json={"username": username, "password": previous_passwords[username]},
        )
        assert previous_login.status_code == 401
        login = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login.status_code == 200, login.text
        profile = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer " + login.json()["access_token"]},
        )
        assert profile.status_code == 200
        assert profile.json()["username"] == username

    assert client.get("/api/auth/demo-credentials").json() == response.json()


def test_demo_bootstrap_requires_a_configured_role_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    monkeypatch.setattr(config, "DEMO_ROLE_PASSWORD", None)
    with SessionLocal() as db, pytest.raises(RuntimeError, match="DEMO_ROLE_PASSWORD"):
        bootstrap_users(db)


def test_bootstrap_password_reset_rotates_all_existing_roles(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(config, "RESET_BOOTSTRAP_PASSWORDS", True)
    passwords = {
        "admin": "rotated-test-admin-password",
        "officer": "rotated-test-officer-password",
        "regulatory": "rotated-test-regulatory-password",
        "institution": "rotated-test-institution-password",
        "compliance": "rotated-test-compliance-password",
    }
    for username, password in passwords.items():
        config_name = {
            "admin": "ADMIN_PASSWORD",
            "officer": "OFFICER_PASSWORD",
            "regulatory": "REGULATORY_PASSWORD",
            "institution": "INSTITUTION_PASSWORD",
            "compliance": "COMPLIANCE_ADMIN_PASSWORD",
        }[username]
        monkeypatch.setattr(config, config_name, password)

    with SessionLocal() as db:
        bootstrap_users(db)

    for username, password in passwords.items():
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 200, response.text


def test_bootstrap_can_reset_only_the_admin_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    new_admin_password = "rotated-test-admin-only-password"
    monkeypatch.setattr(config, "DEMO_MODE", False)
    monkeypatch.setattr(config, "RESET_ADMIN_PASSWORD", True)
    monkeypatch.setattr(config, "RESET_BOOTSTRAP_PASSWORDS", False)
    monkeypatch.setattr(config, "ADMIN_PASSWORD", new_admin_password)

    with SessionLocal() as db:
        bootstrap_users(db)

    admin_login = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": new_admin_password},
    )
    assert admin_login.status_code == 200
    previous_admin_login = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "test-admin-password"},
    )
    assert previous_admin_login.status_code == 401

    for username, password in (
        ("officer", "test-officer-password"),
        ("regulatory", "test-regulatory-password"),
        ("institution", "test-institution-password"),
        ("compliance", "test-compliance-password"),
    ):
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 200


def test_admin_password_reset_requires_configured_password(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config, "RESET_ADMIN_PASSWORD", True)
    monkeypatch.setattr(config, "ADMIN_PASSWORD", None)

    with SessionLocal() as db, pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        bootstrap_users(db)


def test_complete_intake_review_and_audit_flow(client: TestClient, auth_headers: dict[str, str]):
    application = create_application(client, auth_headers)
    pdf = make_pdf(
        "Institution Name: North Valley College\n"
        "Faculty Count: 24\n"
        "Student Count: 600\n"
        "Academic Year: 2026-27\n"
        "Affiliation Number: AICTE-2026-001\n"
    )
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("affiliation.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202, upload.text
    document = upload.json()

    review = client.get(f"/api/applications/{application['id']}/review", headers=auth_headers)
    assert review.status_code == 200, review.text
    assert review.json()["application"]["documents"][0]["status"] == "processed"
    fields = {field["field_name"]: field for field in review.json()["extractions"]}
    assert fields["institution_name"]["extracted_value"] == "North Valley College"
    assert fields["faculty_count"]["extracted_value"] == "24"
    assert fields["institution_name"]["label_match_score"] == 1.0
    assert fields["institution_name"]["expected_value"] == "North Valley College"
    assert fields["institution_name"]["metadata_match_score"] == 1.0
    assert fields["faculty_count"]["expected_value"] == "24"
    assert fields["faculty_count"]["metadata_match_score"] == 1.0
    assert review.json()["match_summary"]["score"] == 57
    assert review.json()["match_summary"]["recommendation"] == "approve"

    for field in fields.values():
        if field["review_action"] is None or field["requires_review"]:
            confirmed = client.post(
                f"/api/extractions/{field['id']}/review",
                headers=auth_headers,
                json={"action": "confirm"},
            )
            assert confirmed.status_code == 200, confirmed.text
            assert confirmed.json()["review_action"] == "confirm"

    decision = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve", "note": "Evidence reviewed."},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "approved"

    audit = client.get("/api/audit", headers=auth_headers)
    assert audit.status_code == 200, audit.text
    assert audit.json()["integrity_ok"] is True
    assert any(item["action"] == "application.approved" for item in audit.json()["entries"])


def test_officer_rejection_sets_final_application_status(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)

    response = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "reject", "note": "Required evidence did not match."},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "rejected"


def test_processed_document_can_be_reprocessed_with_updated_table_extraction(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    pdf = make_pdf(
        "Institution\nNorth Valley College\n"
        "Application number\nAPP-2026-001\n"
        "Institution ID\nINST-001\n"
        "Academic year\n2026-27\n"
        "Declared faculty\n24\n"
        "Declared students\n600\n"
    )
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("table.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202, upload.text
    document_id = upload.json()["id"]

    reprocess = client.post(
        f"/api/applications/{application['id']}/documents/{document_id}/retry",
        headers=auth_headers,
    )
    assert reprocess.status_code == 202, reprocess.text

    review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    fields = {field["field_name"]: field for field in review["extractions"]}
    assert fields["institution_name"]["extracted_value"] == "North Valley College"
    assert fields["institution_name"]["metadata_match_score"] == 1.0
    assert fields["student_count"]["extracted_value"] == "600"
    assert fields["student_count"]["metadata_match_score"] == 1.0


def test_metadata_mismatch_lowers_confidence_and_requires_field_review(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    pdf = make_pdf("Faculty Count: 99")
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "faculty_certificate"},
        files={"file": ("faculty.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202, upload.text

    review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    field = next(
        field for field in review["extractions"] if field["field_name"] == "faculty_count"
    )
    assert field["extracted_value"] == "99"
    assert field["expected_value"] == "24"
    assert field["metadata_match_score"] == 0.0
    assert field["confidence"] == 0.46
    assert field["requires_review"] is True


def test_duplicate_application_number_and_non_pdf_are_rejected(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    admin_headers = login_headers(client, "admin", "test-admin-password")
    duplicate = client.post(
        "/api/applications",
        headers=admin_headers,
        json={
            "application_number": "APP-2026-001",
            "institution_id": "INST-002",
            "institution_name": "Other College",
            "academic_year": "2026-27",
            "declared_faculty": 12,
        },
    )
    assert duplicate.status_code == 409

    invalid_upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "other"},
        files={"file": ("notes.pdf", b"not a PDF", "application/pdf")},
    )
    assert invalid_upload.status_code == 415

    malformed_pdf = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "other"},
        files={"file": ("malformed.pdf", b"%PDF-1.7\nnot a real PDF", "application/pdf")},
    )
    assert malformed_pdf.status_code == 422


def test_private_blob_document_registration_is_application_scoped(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
):
    application = create_application(client, auth_headers)
    storage_key = f"evidence/{application['id']}/{uuid4()}.pdf"
    monkeypatch.setattr(config, "DOCUMENT_STORAGE", "vercel_blob")
    monkeypatch.setattr(applications_api, "read_document_bytes", lambda _: make_pdf("Evidence"))
    monkeypatch.setattr(applications_api, "process_document", lambda _: None)

    registered = client.post(
        f"/api/applications/{application['id']}/documents/from-blob",
        headers=auth_headers,
        json={
            "storage_key": storage_key,
            "document_type": "other",
            "filename": "evidence.pdf",
        },
    )
    assert registered.status_code == 202, registered.text
    assert registered.json()["status"] == "uploaded"
    with SessionLocal() as db:
        document = db.get(Document, registered.json()["id"])
        assert document is not None
        assert document.storage_key == storage_key

    cross_application_key = f"evidence/{uuid4()}/{uuid4()}.pdf"
    rejected = client.post(
        f"/api/applications/{application['id']}/documents/from-blob",
        headers=auth_headers,
        json={
            "storage_key": cross_application_key,
            "document_type": "other",
            "filename": "evidence.pdf",
        },
    )
    assert rejected.status_code == 422


def test_private_blob_credentials_failure_is_reported_as_service_unavailable(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
):
    from vercel.blob import sync as blob
    from vercel.blob.errors import BlobCredentialsError

    application = create_application(client, auth_headers)
    storage_key = f"evidence/{application['id']}/{uuid4()}.pdf"
    monkeypatch.setattr(config, "DOCUMENT_STORAGE", "vercel_blob")

    def raise_missing_credentials(*args, **kwargs):
        raise BlobCredentialsError("Missing Blob credentials")

    monkeypatch.setattr(blob, "get_blob", raise_missing_credentials)
    response = client.post(
        f"/api/applications/{application['id']}/documents/from-blob",
        headers=auth_headers,
        json={
            "storage_key": storage_key,
            "document_type": "other",
            "filename": "evidence.pdf",
        },
    )

    assert response.status_code == 503
    assert "BLOB_READ_WRITE_TOKEN" in response.json()["detail"]


def test_approval_is_blocked_until_high_findings_are_resolved(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    pdf = make_pdf(
        "Institution Name: North Valley College\n"
        "Affiliation Number: AICTE-FAKE-001\n"
        "Academic Year: 2026-27\n"
    )
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("revoked.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202

    review = client.get(f"/api/applications/{application['id']}/review", headers=auth_headers).json()
    high_findings = [finding for finding in review["findings"] if finding["severity"] == "high"]
    assert high_findings
    denied = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert denied.status_code == 409

    for finding in high_findings:
        resolved = client.post(
            f"/api/findings/{finding['id']}/review",
            headers=auth_headers,
            json={"status": "resolved"},
        )
        assert resolved.status_code == 200
    for field in review["extractions"]:
        if field["review_action"] is None or field["requires_review"]:
            confirmed = client.post(
                f"/api/extractions/{field['id']}/review",
                headers=auth_headers,
                json={"action": "confirm"},
            )
            assert confirmed.status_code == 200

    approved = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve", "note": "Mock issuer finding reviewed."},
    )
    assert approved.status_code == 200


def test_approval_requires_core_evidence_fields(client: TestClient, auth_headers: dict[str, str]):
    application = create_application(client, auth_headers)
    pdf = make_pdf("Institution Name: North Valley College\nAcademic Year: 2026-27")
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "faculty_certificate"},
        files={"file": ("faculty.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202
    review = client.get(f"/api/applications/{application['id']}/review", headers=auth_headers).json()
    for field in review["extractions"]:
        if field["review_action"] is None or field["requires_review"]:
            confirmed = client.post(
                f"/api/extractions/{field['id']}/review",
                headers=auth_headers,
                json={"action": "confirm"},
            )
            assert confirmed.status_code == 200

    decision = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert decision.status_code == 409
    assert "affiliation_number" in decision.json()["detail"]["blockers"][0]
    overridden = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={
            "decision": "approve",
            "override_blockers": True,
            "note": "Officer explicitly overrode the missing evidence blocker.",
        },
    )
    assert overridden.status_code == 200, overridden.text
    assert overridden.json()["status"] == "approved"
    audit = client.get("/api/audit", headers=auth_headers).json()
    override_entry = next(
        entry
        for entry in audit["entries"]
        if entry["action"] == "application.approved"
        and entry["entity_id"] == application["id"]
    )
    assert override_entry["details"]["override_blockers"] is True
    assert any("affiliation_number" in blocker for blocker in override_entry["details"]["overridden_blockers"])


def test_blockers_and_dismissal_reason_allow_approval(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    missing_document = client.get(
        f"/api/applications/{application['id']}/blockers", headers=auth_headers
    )
    assert missing_document.status_code == 200
    assert "Upload at least one supporting PDF" in missing_document.json()["blockers"][0]
    assert client.get("/api/applications/missing/blockers", headers=auth_headers).status_code == 404

    pdf = make_pdf(
        "Institution Name: North Valley College\n"
        "Faculty Count: 24\n"
        "Student Count: 600\n"
        "Academic Year: 2026-27\n"
        "Affiliation Number: AICTE-FAKE-001\n"
    )
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("revoked.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202, upload.text

    review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    high_finding = next(
        finding for finding in review["findings"] if finding["severity"] == "high"
    )
    no_reason = client.post(
        f"/api/findings/{high_finding['id']}/review",
        headers=auth_headers,
        json={"status": "dismissed"},
    )
    assert no_reason.status_code == 422

    dismissed = client.post(
        f"/api/findings/{high_finding['id']}/review",
        headers=auth_headers,
        json={"status": "dismissed", "reason": "Evidence reviewed against issuer record."},
    )
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["details"]["registry"] == "synthetic demo registry"
    assert dismissed.json()["details"]["dismissal_reason"] == "Evidence reviewed against issuer record."

    for field in review["extractions"]:
        if field["review_action"] is None or field["requires_review"]:
            confirmed = client.post(
                f"/api/extractions/{field['id']}/review",
                headers=auth_headers,
                json={"action": "confirm"},
            )
            assert confirmed.status_code == 200, confirmed.text

    blockers = client.get(
        f"/api/applications/{application['id']}/blockers", headers=auth_headers
    )
    assert blockers.status_code == 200, blockers.text
    assert blockers.json()["blockers"] == []

    decision = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert decision.status_code == 200, decision.text
    audit = client.get("/api/audit", headers=auth_headers).json()
    dismissed_event = next(
        entry
        for entry in audit["entries"]
        if entry["action"] == "finding.dismissed"
        and entry["entity_id"] == high_finding["id"]
    )
    assert dismissed_event["details"]["reason"] == "Evidence reviewed against issuer record."


def test_scanned_pdf_ocr_results_are_processed_and_reviewable(
    client: TestClient, auth_headers: dict[str, str], monkeypatch
):
    from fitz import Page

    original_get_text = Page.get_text

    def fake_ocr(page, **kwargs):
        return page.get_textpage()

    def fake_get_text(page, *args, **kwargs):
        text = original_get_text(page, *args, **kwargs)
        if kwargs.get("textpage") is not None and page.get_image_info():
            return (
                f"{text}\nInstitution Name: Scanned Test College\n"
                "Academic Year: 2026-27\nAffiliation Number: OCR-TEST-001"
            )
        return text

    monkeypatch.setattr(Page, "get_textpage_ocr", fake_ocr)
    monkeypatch.setattr(Page, "get_text", fake_get_text)
    application = create_application(client, auth_headers)
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "scanned.pdf",
                make_scanned_pdf("Scanned original"),
                "application/pdf",
            )
        },
    )
    assert upload.status_code == 202, upload.text

    review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    document = review["application"]["documents"][0]
    assert document["status"] == "processed"
    assert review["application"]["findings"] == []
    fields = {field["field_name"]: field for field in review["extractions"]}
    assert fields["institution_name"]["extracted_value"] == "Scanned Test College"
    assert 0 < fields["institution_name"]["confidence"] < 0.55
    assert fields["institution_name"]["requires_review"] is True
    audit = client.get("/api/audit", headers=auth_headers).json()
    processing_event = next(
        entry for entry in audit["entries"] if entry["action"] == "document.processed"
    )
    assert processing_event["details"]["ocr_pages"] == 1
    assert processing_event["details"]["scanned_pages"] == 1


def test_scanned_pdf_with_no_ocr_text_gets_blocking_finding(
    client: TestClient, auth_headers: dict[str, str], monkeypatch
):
    from fitz import Page

    monkeypatch.setattr(Page, "get_textpage_ocr", lambda page, **kwargs: page.get_textpage())
    application = create_application(client, auth_headers)
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "blank-scan.pdf",
                make_scanned_pdf(""),
                "application/pdf",
            )
        },
    )
    assert upload.status_code == 202, upload.text

    review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    finding = next(
        finding
        for finding in review["findings"]
        if finding["rule_id"] == "extraction.scanned_pdf_no_ocr"
    )
    assert finding["severity"] == "high"
    assert finding["status"] == "open"
    assert review["application"]["documents"][0]["status"] == "processed"


def test_failed_ocr_can_be_retried_after_engine_is_fixed(
    client: TestClient, auth_headers: dict[str, str], monkeypatch
):
    from fitz import Page

    def missing_ocr(page, **kwargs):
        raise RuntimeError("Tesseract is not installed")

    monkeypatch.setattr(Page, "get_textpage_ocr", missing_ocr)
    application = create_application(client, auth_headers)
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "retry-scan.pdf",
                make_scanned_pdf("Scanned original"),
                "application/pdf",
            )
        },
    )
    assert upload.status_code == 202, upload.text
    document = upload.json()

    failed_review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    failed_document = failed_review["application"]["documents"][0]
    assert failed_document["status"] == "failed"
    assert "Install Tesseract OCR" in failed_document["processing_error"]
    assert failed_review["application"]["status"] == "review_required"

    original_get_text = Page.get_text

    def fake_ocr(page, **kwargs):
        return page.get_textpage()

    def fake_get_text(page, *args, **kwargs):
        text = original_get_text(page, *args, **kwargs)
        if kwargs.get("textpage") is not None and page.get_image_info():
            return (
                f"{text}\nInstitution Name: Retry Test College\n"
                "Academic Year: 2026-27\nAffiliation Number: OCR-RETRY-001"
            )
        return text

    monkeypatch.setattr(Page, "get_textpage_ocr", fake_ocr)
    monkeypatch.setattr(Page, "get_text", fake_get_text)
    retried = client.post(
        f"/api/applications/{application['id']}/documents/{document['id']}/retry",
        headers=auth_headers,
    )
    assert retried.status_code == 202, retried.text
    assert retried.json()["status"] == "uploaded"

    completed_review = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    ).json()
    fields = {field["field_name"]: field for field in completed_review["extractions"]}
    assert fields["institution_name"]["extracted_value"] == "Retry Test College"


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed")
def test_real_ocr_upload_review_and_approval(
    client: TestClient, auth_headers: dict[str, str]
):
    application = create_application(client, auth_headers)
    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=auth_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "real-scan.pdf",
                make_scanned_pdf(
                    "Institution Name: OCR Workflow College\n"
                    "Academic Year: 2026-27\n"
                    "Affiliation Number: OCR-E2E-001"
                ),
                "application/pdf",
            )
        },
    )
    assert upload.status_code == 202, upload.text

    review_response = client.get(
        f"/api/applications/{application['id']}/review", headers=auth_headers
    )
    assert review_response.status_code == 200, review_response.text
    review = review_response.json()
    assert review["application"]["documents"][0]["status"] == "processed"
    fields = {field["field_name"]: field for field in review["extractions"]}
    assert fields["institution_name"]["extracted_value"] == "OCR Workflow College"
    assert fields["academic_year"]["extracted_value"] == "2026-27"
    assert fields["affiliation_number"]["extracted_value"] == "OCR-E2E-001"
    assert all(field["requires_review"] for field in fields.values())
    assert all(
        0 < field["confidence"] <= 0.45
        for field in fields.values()
        if field["extracted_value"] is not None
    )

    for field in fields.values():
        confirmed = client.post(
            f"/api/extractions/{field['id']}/review",
            headers=auth_headers,
            json={"action": "confirm"},
        )
        assert confirmed.status_code == 200, confirmed.text

    blockers = client.get(
        f"/api/applications/{application['id']}/blockers", headers=auth_headers
    )
    assert blockers.status_code == 200
    assert blockers.json()["blockers"] == []

    decision = client.post(
        f"/api/applications/{application['id']}/decision",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "approved"


def test_bootstrap_provisions_all_four_roles(client: TestClient):
    credentials = {
        "admin": ("admin", "test-admin-password"),
        "officer": ("officer", "test-officer-password"),
        "regulatory": ("regulatory_officer", "test-regulatory-password"),
        "compliance": ("compliance_admin", "test-compliance-password"),
        "institution": ("institution", "test-institution-password"),
    }
    for username, (expected_role, password) in credentials.items():
        headers = login_headers(client, username, password)
        profile = client.get("/api/auth/me", headers=headers)
        assert profile.status_code == 200
        assert profile.json()["role"] == expected_role


def test_admin_user_management_and_role_permissions(client: TestClient):
    admin_headers = login_headers(client, "admin", "test-admin-password")
    officer_headers = login_headers(client, "officer", "test-officer-password")

    users = client.get("/api/users", headers=admin_headers)
    assert users.status_code == 200
    assert {user["role"] for user in users.json()} == {
        "admin",
        "officer",
        "regulatory_officer",
        "compliance_admin",
        "institution",
    }
    assert client.get("/api/dashboard", headers=admin_headers).json()["users"] == 5
    assert client.get("/api/dashboard", headers=officer_headers).json()["users"] == 0
    assert client.get("/api/users", headers=officer_headers).status_code == 403

    payload = {
        "username": "New-Institution",
        "display_name": "New Institution",
        "role": "institution",
        "password": "long-institution-password",
    }
    created = client.post("/api/users", headers=admin_headers, json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["username"] == "new-institution"
    assert "password" not in created.json()
    reset = client.patch(
        f"/api/users/{created.json()['id']}",
        headers=admin_headers,
        json={"password": "updated-institution-password"},
    )
    assert reset.status_code == 200, reset.text
    assert "password" not in reset.json()
    assert client.post(
        "/api/auth/login",
        json={"username": "new-institution", "password": "long-institution-password"},
    ).status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"username": "new-institution", "password": "updated-institution-password"},
    ).status_code == 200
    assert client.post(
        "/api/users",
        headers=admin_headers,
        json={**payload, "username": "NEW-INSTITUTION"},
    ).status_code == 409

    admin_id = next(user["id"] for user in users.json() if user["username"] == "admin")
    protected = client.patch(
        f"/api/users/{admin_id}",
        headers=admin_headers,
        json={"role": "officer"},
    )
    assert protected.status_code == 409
    assert "last active administrator" in protected.json()["detail"]
    self_deactivation = client.patch(
        f"/api/users/{admin_id}",
        headers=admin_headers,
        json={"is_active": False},
    )
    assert self_deactivation.status_code == 409


def test_institution_registration_creates_only_institution_role(client: TestClient):
    response = client.post(
        "/api/auth/register/institution",
        json={
            "username": "new-public-institution",
            "display_name": "Public Institution",
            "password": "a-long-public-password",
            "role": "admin",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["role"] == "institution"
    assert response.json()["user"]["username"] == "new-public-institution"
    assert client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {response.json()['access_token']}"},
    ).json()["role"] == "institution"
    assert client.post(
        "/api/auth/register/institution",
        json={
            "username": "new-public-institution",
            "display_name": "Duplicate Institution",
            "password": "another-long-password",
        },
    ).status_code == 409
    assert client.post(
        "/api/auth/register/institution",
        json={
            "username": "short-password",
            "display_name": "Short Password College",
            "password": "short",
        },
    ).status_code == 422


def test_institution_submission_requires_admin_decision_and_generates_report(
    client: TestClient,
):
    institution_headers = login_headers(client, "institution", "test-institution-password")
    officer_headers = login_headers(client, "officer", "test-officer-password")
    admin_headers = login_headers(client, "admin", "test-admin-password")
    created = client.post(
        "/api/applications",
        headers=institution_headers,
        json={
            "application_number": "INST-ADMIN-REVIEW-001",
            "institution_id": "INST-ADMIN-REVIEW",
            "institution_name": "Administrator Review College",
            "category": "EOA",
            "academic_year": "2026-27",
            "declared_faculty": 12,
            "declared_student_count": 300,
            "declared_land_area": 2.5,
        },
    )
    assert created.status_code == 201, created.text
    application_id = created.json()["id"]
    assert client.post(
        f"/api/applications/{application_id}/submit", headers=institution_headers
    ).status_code == 409

    uploaded = client.post(
        f"/api/applications/{application_id}/documents",
        headers=institution_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "admin-review.pdf",
                make_pdf("Institution: Administrator Review College"),
                "application/pdf",
            )
        },
    )
    assert uploaded.status_code == 202, uploaded.text
    application = client.get(
        f"/api/applications/{application_id}", headers=institution_headers
    ).json()
    assert application["documents"][0]["status"] == "processed"

    submitted = client.post(
        f"/api/applications/{application_id}/submit", headers=institution_headers
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "pending_admin_review"
    assert client.patch(
        f"/api/applications/{application_id}",
        headers=institution_headers,
        json={"institution_name": "Changed after submission"},
    ).status_code == 409
    assert client.post(
        f"/api/applications/{application_id}/documents",
        headers=institution_headers,
        data={"document_type": "other"},
        files={"file": ("late.pdf", make_pdf("Late evidence"), "application/pdf")},
    ).status_code == 409
    assert client.get("/api/applications", headers=admin_headers).json()[0]["status"] == "pending_admin_review"
    assert client.post(
        f"/api/applications/{application_id}/decision",
        headers=officer_headers,
        json={"decision": "reject", "note": "Officer cannot issue institutional decisions."},
    ).status_code == 403

    decision = client.post(
        f"/api/applications/{application_id}/decision",
        headers=admin_headers,
        json={"decision": "reject", "note": "Required evidence needs correction."},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["decided_by"] == "admin"
    report = client.get(
        f"/api/applications/{application_id}/decision-report",
        headers=institution_headers,
    )
    assert report.status_code == 200, report.text
    assert report.json()["status"] == "rejected"
    assert report.json()["decision_note"] == "Required evidence needs correction."
    assert report.json()["documents"][0]["filename"] == "admin-review.pdf"
    assert "score" in report.json()["match_summary"]
    assert client.get(
        f"/api/applications/{application_id}/decision-report", headers=officer_headers
    ).status_code == 403
    other_account = client.post(
        "/api/auth/register/institution",
        json={
            "username": "other-report-institution",
            "display_name": "Other Report Institution",
            "password": "another-long-password",
        },
    )
    other_headers = {
        "Authorization": f"Bearer {other_account.json()['access_token']}"
    }
    assert client.get(
        f"/api/applications/{application_id}/decision-report", headers=other_headers
    ).status_code == 404


def test_institution_dashboard_is_scoped_and_can_correct_owned_drafts(client: TestClient):
    officer_headers = login_headers(client, "officer", "test-officer-password")
    institution_headers = login_headers(client, "institution", "test-institution-password")
    own = client.post(
        "/api/applications",
        headers=institution_headers,
        json={
            "application_number": "INST-APP-2026-001",
            "institution_id": "INST-OWN",
            "institution_name": "Institution Owned College",
            "category": "EOA",
            "academic_year": "2026-27",
            "declared_faculty": 20,
            "declared_student_count": 400,
            "declared_land_area": 3.5,
        },
    )
    assert own.status_code == 201, own.text
    own_application = own.json()
    other_application = create_application(client, officer_headers)

    applications = client.get("/api/applications", headers=institution_headers)
    assert applications.status_code == 200
    assert [item["id"] for item in applications.json()] == [own_application["id"]]
    assert client.get("/api/dashboard", headers=institution_headers).json()["applications"] == 1
    assert client.get(
        f"/api/applications/{own_application['id']}", headers=institution_headers
    ).status_code == 200
    assert client.get(
        f"/api/applications/{other_application['id']}", headers=institution_headers
    ).status_code == 404
    corrected = client.patch(
        f"/api/applications/{own_application['id']}",
        headers=institution_headers,
        json={"institution_name": "Corrected College Name", "declared_faculty": 25},
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["institution_name"] == "Corrected College Name"
    assert corrected.json()["declared_faculty"] == 25
    assert corrected.json()["status"] == "draft"
    assert client.patch(
        f"/api/applications/{other_application['id']}",
        headers=institution_headers,
        json={"institution_name": "Not the owner"},
    ).status_code == 404
    assert client.patch(
        f"/api/applications/{own_application['id']}",
        headers=officer_headers,
        json={"institution_name": "Officer cannot edit"},
    ).status_code == 403
    assert client.patch(
        f"/api/applications/{own_application['id']}",
        headers=institution_headers,
        json={},
    ).status_code == 422
    assert client.post(
        f"/api/applications/{own_application['id']}/resubmissions",
        headers=institution_headers,
    ).status_code == 409
    assert client.get(
        f"/api/applications/{own_application['id']}/review",
        headers=institution_headers,
    ).status_code == 200
    assert client.get(
        f"/api/applications/{own_application['id']}/blockers",
        headers=institution_headers,
    ).status_code == 403
    assert client.get("/api/audit", headers=institution_headers).status_code == 403
    assert client.get("/api/users", headers=institution_headers).status_code == 403
    assert client.post(
        f"/api/applications/{own_application['id']}/decision",
        headers=institution_headers,
        json={"decision": "reject"},
    ).status_code == 403
    upload = client.post(
        f"/api/applications/{own_application['id']}/documents",
        headers=institution_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("own.pdf", make_pdf("Institution: Institution Owned College"), "application/pdf")},
    )
    assert upload.status_code == 202, upload.text
    with SessionLocal() as db:
        rejected_application = db.get(Application, own_application["id"])
        assert rejected_application is not None
        rejected_application.status = "rejected"
        db.commit()
    resubmission = client.post(
        f"/api/applications/{own_application['id']}/resubmissions",
        headers=institution_headers,
    )
    assert resubmission.status_code == 201, resubmission.text
    assert resubmission.json()["status"] == "draft"
    assert resubmission.json()["application_number"] == "INST-APP-2026-001-R1"
    assert resubmission.json()["document_count"] == 0
    own_ids = {
        item["id"]
        for item in client.get("/api/applications", headers=institution_headers).json()
    }
    assert own_application["id"] in own_ids
    assert resubmission.json()["id"] in own_ids


def test_regulatory_officer_can_review_but_not_submit_or_decide(client: TestClient):
    officer_headers = login_headers(client, "officer", "test-officer-password")
    regulatory_headers = login_headers(
        client, "regulatory", "test-regulatory-password"
    )
    application = create_application(client, officer_headers)

    upload = client.post(
        f"/api/applications/{application['id']}/documents",
        headers=officer_headers,
        data={"document_type": "affiliation_letter"},
        files={
            "file": (
                "issuer-check.pdf",
                make_pdf("Institution Name: North Valley College\nAffiliation Number: AICTE-FAKE-001"),
                "application/pdf",
            )
        },
    )
    assert upload.status_code == 202, upload.text
    review = client.get(
        f"/api/applications/{application['id']}/review",
        headers=regulatory_headers,
    ).json()
    high_finding = next(
        finding for finding in review["findings"] if finding["severity"] == "high"
    )
    resolved = client.post(
        f"/api/findings/{high_finding['id']}/review",
        headers=regulatory_headers,
        json={"status": "resolved"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"

    assert client.get("/api/applications", headers=regulatory_headers).status_code == 200
    assert client.get(
        f"/api/applications/{application['id']}/review",
        headers=regulatory_headers,
    ).status_code == 200
    assert client.get(
        f"/api/applications/{application['id']}/blockers",
        headers=regulatory_headers,
    ).status_code == 200
    assert client.get("/api/audit", headers=regulatory_headers).status_code == 200
    assert client.get("/api/users", headers=regulatory_headers).status_code == 403
    assert client.post(
        "/api/applications",
        headers=regulatory_headers,
        json={
            "application_number": "REG-APP-2026-001",
            "institution_id": "REG-001",
            "institution_name": "Regulatory Test College",
            "academic_year": "2026-27",
            "declared_faculty": 10,
        },
    ).status_code == 403
    assert client.post(
        f"/api/applications/{application['id']}/decision",
        headers=regulatory_headers,
        json={"decision": "reject"},
    ).status_code == 403


def test_compliance_admin_versions_rules_and_audits_amendments(client: TestClient):
    compliance_headers = login_headers(
        client, "compliance", "test-compliance-password"
    )
    admin_headers = login_headers(client, "admin", "test-admin-password")
    officer_headers = login_headers(client, "officer", "test-officer-password")

    current = client.get(
        "/api/compliance/rules?academic_year=2026-27",
        headers=compliance_headers,
    )
    assert current.status_code == 200, current.text
    assert len(current.json()) >= 2
    assert client.post(
        "/api/compliance/rules",
        headers=officer_headers,
        json={
            "rule_key": "faculty.minimum",
            "academic_year": "2026-27",
            "field": "declared_faculty",
            "operator": ">=",
            "threshold": 5,
            "severity": "high",
            "message": "Maintain at least five declared faculty members.",
            "clause_reference": "Section 4.2",
            "source_title": "Verified test handbook",
            "source_url": "https://example.org/handbook",
        },
    ).status_code == 403

    payload = {
        "rule_key": "faculty.minimum",
        "academic_year": "2026-27",
        "field": "declared_faculty",
        "operator": ">=",
        "threshold": 5,
        "severity": "high",
        "message": "Maintain at least five declared faculty members.",
        "clause_reference": "Section 4.2",
        "source_title": "Verified test handbook",
        "source_url": "https://example.org/handbook",
    }
    first = client.post("/api/compliance/rules", headers=compliance_headers, json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "draft"
    first_id = first.json()["id"]
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/submit",
        headers=compliance_headers,
    ).status_code == 409
    simulation = client.post(
        f"/api/compliance/rules/changes/{first_id}/simulate",
        headers=compliance_headers,
        json={
            "declared_faculty": 4,
            "declared_student_count": 100,
            "declared_land_area": 1,
        },
    )
    assert simulation.status_code == 200, simulation.text
    assert simulation.json()["passed"] is False
    assert simulation.json()["persisted"] is False
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/verify-source",
        headers=compliance_headers,
        json={"confirmed": True},
    ).status_code == 200
    edited = client.put(
        f"/api/compliance/rules/changes/{first_id}",
        headers=compliance_headers,
        json={**payload, "message": "Maintain at least five declared faculty members. Updated draft."},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["source_verified"] is False
    assert edited.json()["simulated_at"] is None
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/verify-source",
        headers=compliance_headers,
        json={"confirmed": True},
    ).status_code == 200
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/submit",
        headers=compliance_headers,
    ).status_code == 409
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/simulate",
        headers=compliance_headers,
        json={
            "declared_faculty": 4,
            "declared_student_count": 100,
            "declared_land_area": 1,
        },
    ).status_code == 200
    submitted_first = client.post(
        f"/api/compliance/rules/changes/{first_id}/submit",
        headers=compliance_headers,
    )
    assert submitted_first.status_code == 200, submitted_first.text
    assert submitted_first.json()["status"] == "pending"
    assert submitted_first.json()["simulation_result"]["passed"] is False
    approval_queue = client.get(
        "/api/compliance/rules/changes?status=pending",
        headers=admin_headers,
    )
    assert approval_queue.status_code == 200, approval_queue.text
    assert [change["id"] for change in approval_queue.json()] == [first_id]
    assert client.get(
        "/api/compliance/rules/changes?status=pending",
        headers=officer_headers,
    ).status_code == 403
    assert client.post(
        f"/api/compliance/rules/changes/{first_id}/review",
        headers=compliance_headers,
        json={"decision": "approve"},
    ).status_code == 403
    approved_first = client.post(
        f"/api/compliance/rules/changes/{first_id}/review",
        headers=admin_headers,
        json={"decision": "approve", "note": "Source and simulation reviewed."},
    )
    assert approved_first.status_code == 200, approved_first.text
    assert approved_first.json()["status"] == "approved"
    evaluated_application = client.post(
        "/api/applications",
        headers=admin_headers,
        json={
            "application_number": "GOV-APP-2026-001",
            "institution_id": "GOV-INST-001",
            "institution_name": "Governance Test College",
            "academic_year": "2026-27",
            "declared_faculty": 4,
            "declared_student_count": 100,
            "declared_land_area": 1,
        },
    )
    assert evaluated_application.status_code == 201, evaluated_application.text
    finding_upload = client.post(
        f"/api/applications/{evaluated_application.json()['id']}/documents",
        headers=admin_headers,
        data={"document_type": "faculty_certificate"},
        files={"file": ("faculty.pdf", make_pdf("Faculty Count: 4"), "application/pdf")},
    )
    assert finding_upload.status_code == 202, finding_upload.text
    evaluation_before = client.get(
        f"/api/applications/{evaluated_application.json()['id']}/review",
        headers=admin_headers,
    )
    assert evaluation_before.status_code == 200, evaluation_before.text
    original_finding = next(
        finding for finding in evaluation_before.json()["findings"]
        if finding["rule_id"] == "pipeline.faculty.minimum"
    )
    assert original_finding["details"]["rule_version"] == 1

    second = client.post(
        "/api/compliance/rules",
        headers=compliance_headers,
        json={**payload, "threshold": 8, "message": "Maintain at least eight faculty members."},
    )
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]
    assert client.put(
        f"/api/compliance/rules/changes/{second_id}",
        headers=compliance_headers,
        json={**payload, "threshold": 8, "message": "Maintain at least eight faculty members."},
    ).status_code == 200
    assert client.post(
        f"/api/compliance/rules/changes/{second_id}/simulate",
        headers=compliance_headers,
        json={
            "declared_faculty": 10,
            "declared_student_count": 100,
            "declared_land_area": 1,
        },
    ).status_code == 200
    assert client.post(
        f"/api/compliance/rules/changes/{second_id}/verify-source",
        headers=compliance_headers,
        json={"confirmed": True},
    ).status_code == 200
    assert client.post(
        f"/api/compliance/rules/changes/{second_id}/submit",
        headers=compliance_headers,
    ).status_code == 200
    approved_second = client.post(
        f"/api/compliance/rules/changes/{second_id}/review",
        headers=admin_headers,
        json={"decision": "approve"},
    )
    assert approved_second.status_code == 200, approved_second.text
    assert approved_second.json()["status"] == "approved"

    history = client.get(
        "/api/compliance/rules?academic_year=2026-27&include_history=true",
        headers=compliance_headers,
    )
    versions = [
        rule for rule in history.json() if rule["rule_key"] == "faculty.minimum"
    ]
    assert [rule["version"] for rule in versions] == [2, 1]
    assert [rule["is_active"] for rule in versions] == [True, False]
    assert versions[1]["threshold"] == 5
    evaluation_after = client.get(
        f"/api/applications/{evaluated_application.json()['id']}/review",
        headers=admin_headers,
    )
    stored_finding = next(
        finding for finding in evaluation_after.json()["findings"]
        if finding["rule_id"] == "pipeline.faculty.minimum"
    )
    assert stored_finding == original_finding

    institution_headers = login_headers(
        client, "institution", "test-institution-password"
    )
    preflight = client.post(
        "/api/applications/validate",
        headers=institution_headers,
        json={
            "application_number": "PREFLIGHT-2026-001",
            "institution_id": "INST-PREFLIGHT",
            "institution_name": "Preflight Test College",
            "category": "EOA",
            "academic_year": "2026-27",
            "declared_faculty": 3,
            "declared_student_count": 100,
            "declared_land_area": 1,
        },
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["ready"] is False
    assert any(issue["field"] == "declared_faculty" for issue in preflight.json()["issues"])
    assert len([issue for issue in preflight.json()["issues"] if issue["field"] == "supporting_documents"]) == 4

    audit = client.get("/api/audit", headers=compliance_headers)
    assert audit.status_code == 200, audit.text
    assert audit.json()["integrity_ok"] is True
    actions = [entry["action"] for entry in audit.json()["entries"]]
    assert actions.count("compliance_rule.approved") == 2
    assert actions.count("compliance_rule.source_verified") == 3
    assert actions.count("compliance_rule.simulated") == 3
    assert actions.count("compliance_rule.submitted") == 2


def test_scrutiny_queue_prioritizes_open_high_findings(client: TestClient):
    officer_headers = login_headers(client, "officer", "test-officer-password")
    high = create_application(client, officer_headers)
    baseline = client.post(
        "/api/applications",
        headers=login_headers(client, "admin", "test-admin-password"),
        json={
            "application_number": "APP-2026-002",
            "institution_id": "INST-002",
            "institution_name": "Second College",
            "category": "EOA",
            "academic_year": "2026-27",
            "declared_faculty": 20,
            "declared_student_count": 300,
            "declared_land_area": 2,
        },
    )
    assert baseline.status_code == 201, baseline.text
    pdf = make_pdf(
        "Institution Name: North Valley College\n"
        "Affiliation Number: AICTE-FAKE-001\n"
        "Academic Year: 2026-27"
    )
    upload = client.post(
        f"/api/applications/{high['id']}/documents",
        headers=officer_headers,
        data={"document_type": "affiliation_letter"},
        files={"file": ("revoked.pdf", pdf, "application/pdf")},
    )
    assert upload.status_code == 202, upload.text
    queue = client.get("/api/review/queue", headers=officer_headers)
    assert queue.status_code == 200, queue.text
    assert queue.json()[0]["id"] == high["id"]
    assert queue.json()[0]["high_findings"] > 0
    assert any(
        item["rule_id"] == "pipeline.issuer.mock_revocation"
        for item in queue.json()[0]["report"]
    )
