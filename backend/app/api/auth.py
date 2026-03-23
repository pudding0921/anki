import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.models import User
from app.schemas.schemas import Token, UserLogin, UserOut, UserRegister

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
def register(payload: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    db.add(user)
    db.flush()
    if payload.stripe_session_id:
        _link_stripe_session(user, payload.stripe_session_id)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
