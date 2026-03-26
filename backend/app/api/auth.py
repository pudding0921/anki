import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.limiter import limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.models import InviteCode, User
from app.schemas.schemas import ChangeEmailRequest, ChangePasswordRequest, Token, UserLogin, UserOut, UserRegister

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _link_stripe_session(user: User, session_id: str) -> None:
    """After a guest Stripe checkout, link the subscription to the new account."""
    if not settings.STRIPE_SECRET_KEY:
        return
    try:
        import stripe as stripe_lib
        stripe_lib.api_key = settings.STRIPE_SECRET_KEY
        checkout = stripe_lib.checkout.Session.retrieve(
            session_id, expand=["subscription"]
        )
        if checkout.customer:
            user.stripe_customer_id = checkout.customer
        sub = checkout.subscription
        if sub:
            user.subscription_status = sub.status
            plan_id = sub.items.data[0].price.id if sub.items.data else None
            if plan_id == settings.STRIPE_PRICE_MONTHLY:
                user.subscription_plan = "monthly"
            elif plan_id == settings.STRIPE_PRICE_BIANNUAL:
                user.subscription_plan = "biannual"
            end_ts = sub.get("current_period_end")
            if end_ts:
                user.subscription_end = datetime.fromtimestamp(end_ts, tz=timezone.utc)
    except Exception as e:
        logger.warning("Could not link Stripe session %s during registration: %s", session_id, e)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, payload: UserRegister, db: Session = Depends(get_db)):
    if len(payload.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    # Validate invite code if provided
    invite = None
    if payload.invite_code:
        invite = db.query(InviteCode).filter(
            InviteCode.code == payload.invite_code,
            InviteCode.is_active == True,
            InviteCode.used_by_email == None,
        ).first()
        if not invite:
            raise HTTPException(status_code=400, detail="Invalid or already used invite code")

    # Run bcrypt in a thread so it doesn't block the event loop (~500ms on 0.5 vCPU)
    loop = asyncio.get_running_loop()
    hashed = await loop.run_in_executor(None, hash_password, payload.password)
    user = User(email=payload.email, hashed_password=hashed)
    db.add(user)
    db.flush()

    if invite:
        user.subscription_status = "active"
        user.subscription_plan = "gifted"
        invite.used_by_email = payload.email
        invite.used_at = datetime.now(timezone.utc)
        invite.is_active = False
    elif payload.stripe_session_id:
        _link_stripe_session(user, payload.stripe_session_id)

    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
async def login(request: Request, payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    # Run bcrypt in a thread so it doesn't block the event loop
    loop = asyncio.get_running_loop()
    valid = await loop.run_in_executor(None, verify_password, payload.password, user.hashed_password)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/email", response_model=UserOut)
async def change_email(payload: ChangeEmailRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loop = asyncio.get_running_loop()
    valid = await loop.run_in_executor(None, verify_password, payload.current_password, current_user.hashed_password)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if db.query(User).filter(User.email == payload.new_email, User.id != current_user.id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")
    current_user.email = payload.new_email
    db.commit()
    db.refresh(current_user)
    return current_user


@router.put("/password")
async def change_password(payload: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    loop = asyncio.get_running_loop()
    valid = await loop.run_in_executor(None, verify_password, payload.current_password, current_user.hashed_password)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")
    hashed = await loop.run_in_executor(None, hash_password, payload.new_password)
    current_user.hashed_password = hashed
    db.commit()
    return {"ok": True}
