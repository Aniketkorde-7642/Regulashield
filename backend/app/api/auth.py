from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.models import InstitutionAccountRequest, User, utc_now
from app.schemas import (
    InstitutionAccountRequestDecision,
    InstitutionAccountRequestOut,
    InstitutionRegistration,
    InstitutionRegistrationOut,
    LoginRequest,
    TokenResponse,
)
from app.services.audit import append_audit
from app.services.security import (
    authenticate_user,
    create_access_token,
    demo_role_passwords,
    get_current_user,
    hash_password,
    require_role,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.get("/demo-credentials", response_model=dict[str, str])
def demo_credentials(db: Session = Depends(get_db)) -> dict[str, str]:
    credentials = demo_role_passwords()
    if not config.DEMO_MODE or not credentials:
        return {}

    users = db.scalars(
        select(User).where(
            User.username.in_(credentials),
            User.is_active.is_(True),
        )
    )
    return {
        user.username: credentials[user.username]
        for user in users
        if verify_password(credentials[user.username], user.password_hash)
    }


@router.post(
    "/register/institution",
    response_model=InstitutionRegistrationOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def register_institution(
    payload: InstitutionRegistration,
    db: Session = Depends(get_db),
) -> InstitutionRegistrationOut:
    username = payload.username.strip().casefold()
    if db.scalar(select(User.id).where(User.username == username)) or db.scalar(
        select(InstitutionAccountRequest.id).where(
            InstitutionAccountRequest.username == username,
            InstitutionAccountRequest.status == "pending",
        )
    ):
        raise HTTPException(status_code=409, detail="Username already exists or has a pending request.")
    account_request = InstitutionAccountRequest(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(account_request)
    try:
        db.flush()
        append_audit(
            db,
            actor=username,
            action="institution_account.requested",
            entity_type="institution_account_request",
            entity_id=account_request.id,
            details={"username": username},
        )
        db.commit()
        db.refresh(account_request)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already has an account request.") from None

    return InstitutionRegistrationOut(
        status="pending",
        message="Your institution account request was sent to the System Administrator for approval.",
    )


@router.get(
    "/institution-requests",
    response_model=list[InstitutionAccountRequestOut],
)
def list_institution_account_requests(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InstitutionAccountRequest]:
    require_role(user, "admin")
    return list(
        db.scalars(
            select(InstitutionAccountRequest)
            .where(InstitutionAccountRequest.status == "pending")
            .order_by(InstitutionAccountRequest.created_at, InstitutionAccountRequest.username)
        )
    )


@router.post(
    "/institution-requests/{request_id}/decision",
    response_model=InstitutionAccountRequestOut,
)
def decide_institution_account_request(
    request_id: str,
    payload: InstitutionAccountRequestDecision,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InstitutionAccountRequest:
    require_role(user, "admin")
    account_request = db.get(InstitutionAccountRequest, request_id)
    if account_request is None:
        raise HTTPException(status_code=404, detail="Institution account request not found.")
    if account_request.status != "pending":
        raise HTTPException(status_code=409, detail="This institution account request was already reviewed.")

    if payload.decision == "approve":
        if db.scalar(select(User.id).where(User.username == account_request.username)):
            raise HTTPException(
                status_code=409,
                detail="An account with this username already exists.",
            )
        if not account_request.password_hash:
            raise HTTPException(
                status_code=409,
                detail="This account request has no valid credential to approve.",
            )
        db.add(
            User(
                username=account_request.username,
                display_name=account_request.display_name,
                role="institution",
                password_hash=account_request.password_hash,
            )
        )
        account_request.password_hash = None
        account_request.status = "approved"
        action = "institution_account.approved"
    else:
        account_request.password_hash = None
        account_request.status = "rejected"
        action = "institution_account.rejected"

    account_request.review_note = payload.note
    account_request.reviewed_by = user.username
    account_request.reviewed_at = utc_now()
    append_audit(
        db,
        actor=user.username,
        action=action,
        entity_type="institution_account_request",
        entity_id=account_request.id,
        details={
            "username": account_request.username,
            "decision": payload.decision,
            "note": payload.note,
        },
    )
    try:
        db.commit()
        db.refresh(account_request)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create the institution account.") from None
    return account_request


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
