from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.database import get_db
from app.models.models import User

stripe.api_key = settings.STRIPE_SECRET_KEY

router = APIRouter(prefix="/stripe", tags=["stripe"])

PLANS = {
    "monthly":  {"price_id": settings.STRIPE_PRICE_MONTHLY,  "label": "Monthly – $4.99"},
    "biannual": {"price_id": settings.STRIPE_PRICE_BIANNUAL, "label": "6 Months – $19.99"},
}


class CheckoutRequest(BaseModel):
    plan: str  # "monthly" | "biannual"


@router.post("/create-checkout")
def create_checkout(
    body: CheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")

    plan = PLANS[body.plan]
    base = settings.FRONTEND_URL

    # Reuse or create Stripe customer
    customer_id = current_user.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(email=current_user.email)
        current_user.stripe_customer_id = customer.id
        db.commit()
        customer_id = customer.id

    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": plan["price_id"], "quantity": 1}],
        mode="subscription",
        success_url=f"{base}/dashboard?subscribed=1",
        cancel_url=f"{base}/#pricing",
        metadata={"user_id": str(current_user.id), "plan": body.plan},
    )

    return {"url": session.url}


@router.post("/create-checkout-guest")
def create_checkout_guest(body: CheckoutRequest):
    """Checkout without being logged in — Stripe will collect email."""
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")

    plan = PLANS[body.plan]
    base = settings.FRONTEND_URL

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{"price": plan["price_id"], "quantity": 1}],
        mode="subscription",
        success_url=f"{base}/register?subscribed=1&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base}/#pricing",
        metadata={"plan": body.plan},
    )

    return {"url": session.url}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook secret not configured")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except (stripe.error.SignatureVerificationError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "customer.subscription.updated":
        sub = event["data"]["object"]
        _update_user_subscription(db, sub)

    elif event["type"] == "customer.subscription.deleted":
        sub = event["data"]["object"]
        user = db.query(User).filter(User.stripe_customer_id == sub["customer"]).first()
        if user:
            user.subscription_status = "canceled"
            user.subscription_plan = None
            db.commit()

    elif event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        if session.get("subscription"):
            sub = stripe.Subscription.retrieve(session["subscription"])
            _update_user_subscription(db, sub)

    return {"ok": True}


def _update_user_subscription(db: Session, sub):
    user = db.query(User).filter(User.stripe_customer_id == sub["customer"]).first()
    if not user:
        return
    user.subscription_status = sub["status"]  # "active", "canceled", etc.
    plan_id = sub["items"]["data"][0]["price"]["id"] if sub["items"]["data"] else None
    if plan_id == settings.STRIPE_PRICE_MONTHLY:
        user.subscription_plan = "monthly"
    elif plan_id == settings.STRIPE_PRICE_BIANNUAL:
        user.subscription_plan = "biannual"
    end_ts = sub.get("current_period_end")
    if end_ts:
        user.subscription_end = datetime.fromtimestamp(end_ts, tz=timezone.utc)
    db.commit()


@router.get("/subscription")
def get_subscription(current_user: User = Depends(get_current_user)):
    return {
        "status": current_user.subscription_status,
        "plan": current_user.subscription_plan,
        "end": current_user.subscription_end,
    }


@router.post("/portal")
def customer_portal(current_user: User = Depends(get_current_user)):
    if not current_user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No active subscription")
    session = stripe.billing_portal.Session.create(
        customer=current_user.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/dashboard",
    )
    return {"url": session.url}


@router.post("/cancel")
def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Immediately cancel the active Stripe subscription and revoke account access."""
    if not current_user.stripe_customer_id or current_user.subscription_status != "active":
        raise HTTPException(status_code=400, detail="No active subscription to cancel")

    try:
        subscriptions = stripe.Subscription.list(
            customer=current_user.stripe_customer_id,
            status="active",
            limit=1,
        )
        if subscriptions.data:
            stripe.Subscription.cancel(subscriptions.data[0].id)
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=getattr(e, "user_message", str(e)))

    current_user.subscription_status = "canceled"
    current_user.subscription_plan = None
    db.commit()
    return {"ok": True}
