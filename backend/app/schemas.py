from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class InstitutionRegistration(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("username", "display_name")
    @classmethod
    def strip_registration_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be blank.")
        return value


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(min_length=2, max_length=160)
    role: str = Field(
        pattern=r"^(admin|officer|regulatory_officer|compliance_admin|institution)$"
    )
    password: str = Field(min_length=12, max_length=256)

    @field_validator("username", "display_name")
    @classmethod
    def strip_user_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be blank.")
        return value


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=160)
    role: str | None = Field(
        default=None,
        pattern=r"^(admin|officer|regulatory_officer|compliance_admin|institution)$",
    )
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=256)

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Display name must not be blank.")
        return value


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, str]


class ApplicationCreate(BaseModel):
    application_number: str = Field(min_length=1, max_length=64)
    institution_id: str = Field(min_length=1, max_length=64)
    institution_name: str = Field(min_length=2, max_length=256)
    category: str = Field(default="EOA", min_length=1, max_length=32)
    academic_year: str = Field(pattern=r"^\d{4}-\d{2}$")
    declared_faculty: int = Field(ge=0, le=100000)
    declared_student_count: int = Field(default=0, ge=0, le=10000000)
    declared_land_area: float = Field(default=0.0, ge=0, le=100000000)

    @field_validator("application_number", "institution_id", "institution_name", "category")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be blank.")
        return value


class InstitutionApplicationUpdate(BaseModel):
    institution_id: str | None = Field(default=None, min_length=1, max_length=64)
    institution_name: str | None = Field(default=None, min_length=2, max_length=256)
    category: str | None = Field(default=None, min_length=1, max_length=32)
    academic_year: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    declared_faculty: int | None = Field(default=None, ge=0, le=100000)
    declared_student_count: int | None = Field(default=None, ge=0, le=10000000)
    declared_land_area: float | None = Field(default=None, ge=0, le=100000000)

    @field_validator("institution_id", "institution_name", "category")
    @classmethod
    def strip_application_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Value must not be blank.")
        return value


class StoredDocumentCreate(BaseModel):
    storage_key: str = Field(
        pattern=r"^evidence/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.pdf$",
        max_length=128,
    )
    filename: str = Field(min_length=1, max_length=255)
    document_type: str = Field(
        pattern=r"^(affiliation_letter|faculty_certificate|land_record|fire_safety|other)$"
    )

    @field_validator("filename")
    @classmethod
    def strip_filename(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Filename must not be blank.")
        return value


class ComplianceRuleCreate(BaseModel):
    rule_key: str = Field(min_length=3, max_length=120, pattern=r"^[a-zA-Z0-9_.-]+$")
    academic_year: str = Field(default="all", pattern=r"^(all|\d{4}-\d{2})$")
    field: str = Field(pattern=r"^(declared_faculty|declared_student_count|declared_land_area)$")
    operator: str = Field(pattern=r"^(>=|<=|==|>|<)$")
    threshold: float = Field(ge=0, le=100000000)
    severity: str = Field(pattern=r"^(low|medium|high)$")
    message: str = Field(min_length=8, max_length=2000)
    clause_reference: str | None = Field(default=None, max_length=160)
    source_title: str = Field(min_length=3, max_length=256)
    source_url: str | None = Field(default=None, max_length=1000)

    @field_validator("rule_key", "message", "source_title")
    @classmethod
    def strip_rule_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be blank.")
        return value


class ComplianceRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    rule_key: str
    version: int
    academic_year: str
    field: str
    operator: str
    threshold: float
    severity: str
    message: str
    clause_reference: str | None
    source_title: str
    source_url: str | None
    is_active: bool
    created_by: str
    created_at: datetime


class RuleChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    payload: ComplianceRuleCreate
    status: str
    source_verified: bool
    source_verified_by: str | None
    source_verified_at: datetime | None
    simulated_at: datetime | None
    simulation_result: dict[str, Any] | None
    created_by: str
    created_at: datetime
    submitted_at: datetime | None
    reviewed_by: str | None
    reviewed_at: datetime | None
    review_note: str | None
    published_rule_id: str | None


class SourceVerificationRequest(BaseModel):
    confirmed: bool


class RuleChangeReviewRequest(BaseModel):
    decision: str = Field(pattern=r"^(approve|reject)$")
    note: str | None = Field(default=None, max_length=2000)


class RuleSimulationRequest(BaseModel):
    declared_faculty: int = Field(ge=0, le=100000)
    declared_student_count: int = Field(ge=0, le=10000000)
    declared_land_area: float = Field(ge=0, le=100000000)


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    application_number: str
    institution_id: str
    institution_name: str
    category: str
    academic_year: str
    declared_faculty: int
    declared_student_count: int
    declared_land_area: float
    status: str
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class ManagedUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    application_id: str
    filename: str
    document_type: str
    file_hash: str
    page_count: int
    status: str
    processing_error: str | None
    created_at: datetime


class ExtractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    field_name: str
    extracted_value: str | None
    normalized_value: str | None
    confidence: float
    raw_ocr_text: str | None
    requires_review: bool
    reviewed_value: str | None
    review_action: str | None
    label_match_score: float = 0.0
    expected_value: str | None = None
    metadata_match_score: float | None = None


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str | None
    rule_id: str
    category: str
    severity: str
    message: str
    expected: str | None
    actual: str | None
    status: str
    details: dict[str, Any]
    created_at: datetime


class ApplicationDetail(ApplicationOut):
    owner_username: str | None
    decision_note: str | None
    decided_by: str | None
    decided_at: datetime | None
    documents: list[DocumentOut]
    findings: list[FindingOut]


class ApplicationDecisionReport(BaseModel):
    application_number: str
    institution_id: str
    institution_name: str
    category: str
    academic_year: str
    status: str
    decision_note: str | None
    decided_by: str
    decided_at: datetime
    match_summary: dict[str, Any]
    documents: list[DocumentOut]
    findings: list[FindingOut]


class FieldReviewRequest(BaseModel):
    action: str = Field(pattern=r"^(confirm|correct|flag)$")
    corrected_value: str | None = Field(default=None, max_length=2000)


class FindingReviewRequest(BaseModel):
    status: str = Field(pattern=r"^(resolved|dismissed|open)$")
    reason: str | None = Field(default=None, max_length=2000)


class DecisionRequest(BaseModel):
    decision: str = Field(pattern=r"^(approve|reject)$")
    note: str | None = Field(default=None, max_length=2000)
    override_blockers: bool = False


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    actor: str
    action: str
    entity_type: str
    entity_id: str
    details: dict[str, Any]
    previous_hash: str
    entry_hash: str
    created_at: datetime
