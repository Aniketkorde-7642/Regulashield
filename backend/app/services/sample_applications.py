from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models import Application, User, utc_now
from app.services.audit import append_audit


SAMPLE_APPLICATIONS = (
    {
        "application_number": "DEMO-SAMPLE-APPROVED-2026",
        "institution_id": "DEMO-APPROVED-2026",
        "institution_name": "DEMO SAMPLE - Approved Outcome College",
        "status": "approved",
        "decision_note": (
            "SYNTHETIC DEMONSTRATION ONLY: This preset approved outcome is not an "
            "actual review or an official AICTE decision. No supporting evidence "
            "is attached to this sample."
        ),
    },
    {
        "application_number": "DEMO-SAMPLE-REJECTED-2026",
        "institution_id": "DEMO-REJECTED-2026",
        "institution_name": "DEMO SAMPLE - Rejected Outcome College",
        "status": "rejected",
        "decision_note": (
            "SYNTHETIC DEMONSTRATION ONLY: This preset rejected outcome is not an "
            "actual review or an official AICTE decision. No supporting evidence "
            "is attached to this sample."
        ),
    },
)


def seed_sample_applications(db: Session) -> None:
    if not config.SAMPLE_APPLICATIONS_ENABLED:
        return

    institution = db.scalar(select(User).where(User.username == "institution"))
    if institution is None or institution.role != "institution" or not institution.is_active:
        raise RuntimeError(
            "Cannot seed sample applications: the active institution role account is missing."
        )

    existing_by_number = {
        application.application_number: application
        for application in db.scalars(
            select(Application).where(
                Application.application_number.in_(
                    [sample["application_number"] for sample in SAMPLE_APPLICATIONS]
                )
            )
        )
    }
    for sample in SAMPLE_APPLICATIONS:
        existing = existing_by_number.get(sample["application_number"])
        if existing is not None and (
            existing.owner_username != institution.username
            or existing.status != sample["status"]
            or existing.decided_by != "demo sample"
        ):
            raise RuntimeError(
                "Cannot seed sample applications: a reserved demonstration application "
                "number is already used by a different record."
            )

    for sample in SAMPLE_APPLICATIONS:
        if sample["application_number"] in existing_by_number:
            continue
        application = Application(
            owner_username=institution.username,
            application_number=sample["application_number"],
            institution_id=sample["institution_id"],
            institution_name=sample["institution_name"],
            category="DEMO SAMPLE",
            academic_year="2026-27",
            declared_faculty=0,
            declared_student_count=0,
            declared_land_area=0,
            status=sample["status"],
            decision_note=sample["decision_note"],
            decided_by="demo sample",
            decided_at=utc_now(),
        )
        db.add(application)
        db.flush()
        append_audit(
            db,
            actor="system",
            action="application.demo_sample_seeded",
            entity_type="application",
            entity_id=application.id,
            details={
                "application_number": application.application_number,
                "status": application.status,
                "synthetic": True,
                "official_aicte_decision": False,
            },
        )
    db.commit()
