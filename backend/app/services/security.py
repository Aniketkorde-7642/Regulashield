from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import User


bearer_scheme = HTTPBearer(auto_error=False)
_ITERATIONS = 310_000
ROLE_ALIASES = {
    "system_administrator": "admin",
    "administrator": "admin",
    "aicte_scrutiny_officer": "officer",
    "scrutiny_officer": "officer",
    "verification_officer": "regulatory_officer",
    "regulatory": "regulatory_officer",
    "institution_login": "institution",
    "regulatory_compliance_administrator": "compliance_admin",
    "compliance_administrator": "compliance_admin",
}
DEMO_ROLE_PASSWORDS = {
    "admin": "DemoAdmin!2026",
    "officer": "DemoOfficer!2026",
    "regulatory": "DemoRegulatory!2026",
    "compliance": "DemoCompliance!2026",
    "institution": "DemoInstitution!2026",
}


def canonical_role(role: str) -> str:
    normalized = role.strip().casefold().replace(" ", "_")
    return ROLE_ALIASES.get(normalized, normalized)


def has_role(user: User, *allowed_roles: str) -> bool:
    return canonical_role(user.role) in {canonical_role(role) for role in allowed_roles}


def require_role(user: User, *allowed_roles: str) -> None:
    if not has_role(user, *allowed_roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account does not have permission to perform this action.",
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        iterations_text, salt_hex, digest_hex = stored_hash.split("$", 2)
        iterations = int(iterations_text)
        if iterations < 100_000 or iterations > 2_000_000:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return hmac.compare_digest(actual, expected)


def bootstrap_users(db: Session) -> None:
    seeds = (
        ("admin", "System Administrator", "admin", config.ADMIN_PASSWORD),
        ("officer", "AICTE Scrutiny Officer", "officer", config.OFFICER_PASSWORD),
        (
            "regulatory",
            "Regulatory / Verification Officer",
            "regulatory_officer",
            config.REGULATORY_PASSWORD,
        ),
        (
            "institution",
            "Institution Applicant",
            "institution",
            config.INSTITUTION_PASSWORD,
        ),
        (
            "compliance",
            "Regulatory / Compliance Administrator",
            "compliance_admin",
            config.COMPLIANCE_ADMIN_PASSWORD,
        ),
    )
    for username, display_name, role, configured_password in seeds:
        existing = db.scalar(select(User).where(User.username == username))
        if existing:
            continue
        password = (
            DEMO_ROLE_PASSWORDS[username]
            if config.DEMO_MODE
            else configured_password or secrets.token_urlsafe(15)
        )
        db.add(
            User(
                username=username,
                display_name=display_name,
                role=role,
                password_hash=hash_password(password),
            )
        )
        if not configured_password and not config.DEMO_MODE and os.getenv("VERCEL") != "1":
            print(f"[regula-shield] First-run {username} password: {password}")
    db.commit()


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=config.TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="A valid bearer token is required.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        payload = jwt.decode(credentials.credentials, config.SECRET_KEY, algorithms=["HS256"])
        username = payload.get("sub")
        if not isinstance(username, str) or not username:
            raise unauthorized
    except jwt.PyJWTError:
        raise unauthorized from None
    user = db.scalar(select(User).where(User.username == username, User.is_active.is_(True)))
    if user is None:
        raise unauthorized
    return user
