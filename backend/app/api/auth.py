from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import User
from app.schemas import InstitutionRegistration, LoginRequest, TokenResponse
from app.services.audit import append_audit
from app.services.security import (
    DEMO_ROLE_PASSWORDS,
    authenticate_user,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.get("/demo-credentials", response_model=dict[str, str])
def demo_credentials(db: Session = Depends(get_db)) -> dict[str, str]:
    if not config.DEMO_MODE:
        return {}

    users = db.scalars(
        select(User).where(
            User.username.in_(DEMO_ROLE_PASSWORDS),
            User.is_active.is_(True),
        )
    )
    return {
        user.username: DEMO_ROLE_PASSWORDS[user.username]
        for user in users
        if verify_password(DEMO_ROLE_PASSWORDS[user.username], user.password_hash)
    }


@router.post(
    "/register/institution",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_institution(
    payload: InstitutionRegistration,
    db: Session = Depends(get_db),
) -> TokenResponse:
    user = User(
        username=payload.username.strip().casefold(),
        display_name=payload.display_name.strip(),
        role="institution",
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.flush()
        append_audit(
            db,
            actor=user.username,
            action="institution_account.registered",
            entity_type="user",
            entity_id=user.id,
            details={"role": user.role},
        )
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists.") from None

    return TokenResponse(
        access_token=create_access_token(user),
        user={"username": user.username, "display_name": user.display_name, "role": user.role},
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = authenticate_user(db, payload.username.strip().lower(), payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
        )
    return TokenResponse(
        access_token=create_access_token(user),
        user={"username": user.username, "display_name": user.display_name, "role": user.role},
    )


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict[str, str]:
    return {"username": user.username, "display_name": user.display_name, "role": user.role}
