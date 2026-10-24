from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(24), default="officer")
    password_hash: Mapped[str] = mapped_column(String(256))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ComplianceRule(Base):
    __tablename__ = "compliance_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    rule_key: Mapped[str] = mapped_column(String(120), index=True)
    version: Mapped[int] = mapped_column(Integer)
    academic_year: Mapped[str] = mapped_column(String(16), default="all", index=True)
    field: Mapped[str] = mapped_column(String(80))
    operator: Mapped[str] = mapped_column(String(4))
    threshold: Mapped[float] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(Text)
    clause_reference: Mapped[str | None] = mapped_column(String(160), nullable=True)
    source_title: Mapped[str] = mapped_column(String(256), default="Unspecified source")
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RuleChange(Base):
    __tablename__ = "rule_changes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    source_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    source_verified_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    simulated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    simulation_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_rule_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_username: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    application_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    institution_id: Mapped[str] = mapped_column(String(64), index=True)
    institution_name: Mapped[str] = mapped_column(String(256))
    category: Mapped[str] = mapped_column(String(32), default="EOA")
    academic_year: Mapped[str] = mapped_column(String(16))
    declared_faculty: Mapped[int] = mapped_column(Integer)
    declared_student_count: Mapped[int] = mapped_column(Integer, default=0)
    declared_land_area: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    documents: Mapped[list[Document]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    findings: Mapped[list[Finding]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )

    @property
    def document_count(self) -> int:
        return len(self.documents)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id: Mapped[str] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    document_type: Mapped[str] = mapped_column(String(64))
    content_type: Mapped[str] = mapped_column(String(128), default="application/pdf")
    storage_key: Mapped[str] = mapped_column(String(128), unique=True)
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    page_count: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="uploaded", index=True)
    processing_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    application: Mapped[Application] = relationship(back_populates="documents")
    extractions: Mapped[list[FieldExtraction]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class FieldExtraction(Base):
    __tablename__ = "field_extractions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    field_name: Mapped[str] = mapped_column(String(80), index=True)
    extracted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    raw_ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_review: Mapped[bool] = mapped_column(Boolean, default=True)
    reviewed_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_action: Mapped[str | None] = mapped_column(String(24), nullable=True)

    document: Mapped[Document] = relationship(back_populates="extractions")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    rule_id: Mapped[str] = mapped_column(String(120), index=True)
    category: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    message: Mapped[str] = mapped_column(Text)
    expected: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    resolved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    application: Mapped[Application] = relationship(back_populates="findings")


class AuditEntry(Base):
    __tablename__ = "audit_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor: Mapped[str] = mapped_column(String(80), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    previous_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
