from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, utc_now
from app.schemas import ManagedUserOut, UserCreate, UserUpdate
from app.services.audit import append_audit
from app.services.security import (
    canonical_role,
    get_current_user,
    hash_password,
    require_role,
)

router = APIRouter(prefix="/users", tags=["user administration"])


@router.get("", response_model=list[ManagedUserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[User]:
    require_role(current_user, "admin")
    return list(db.scalars(select(User).order_by(User.created_at, User.username)))


@router.post("", response_model=ManagedUserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    require_role(current_user, "admin")
    user = User(
        username=payload.username.strip().casefold(),
        display_name=payload.display_name.strip(),
        role=canonical_role(payload.role),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.flush()
        append_audit(
            db,
            actor=current_user.username,
            action="user.created",
            entity_type="user",
            entity_id=user.id,
            details={"username": user.username, "role": user.role},
        )
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists.") from None
    return user


@router.patch("/{user_id}", response_model=ManagedUserOut)
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    require_role(current_user, "admin")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    updates = payload.model_dump(exclude_unset=True)
    if user.id == current_user.id and updates.get("is_active") is False:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account.")

    next_role = canonical_role(updates.get("role") or user.role)
    next_active = (
        updates["is_active"]
        if updates.get("is_active") is not None
        else user.is_active
    )
    if canonical_role(user.role) == "admin" and (
        next_role != "admin" or not next_active
    ):
        active_admins = sum(
            canonical_role(candidate.role) == "admin"
            for candidate in db.scalars(
                select(User).where(User.is_active.is_(True))
            )
        )
        if active_admins <= 1:
            raise HTTPException(
                status_code=409,
                detail="The last active administrator cannot be removed or deactivated.",
            )

    for field in ("display_name", "is_active"):
        if field in updates and updates[field] is not None:
            setattr(user, field, updates[field])
    if "role" in updates and updates["role"] is not None:
        user.role = next_role
    if updates.get("password"):
        user.password_hash = hash_password(updates["password"])

    append_audit(
        db,
        actor=current_user.username,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        details={
            "username": user.username,
            "changes": sorted(updates),
            "updated_at": utc_now().isoformat(),
        },
    )
    db.commit()
    db.refresh(user)
    return user
