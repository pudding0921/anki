import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import get_db
from app.models.models import InviteCode, User

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(x_admin_secret: str = Header(...)):
    if not settings.ADMIN_SECRET or x_admin_secret != settings.ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


class GrantAccessRequest(BaseModel):
    email: str


# ── Grant / revoke access ──────────────────────────────────────────────────

@router.post("/grant-access")
def grant_access(
    body: GrantAccessRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin),
):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.subscription_status = "active"
    user.subscription_plan = "gifted"
    db.commit()
    return {"ok": True, "email": user.email, "status": user.subscription_status}


@router.post("/revoke-access")
def revoke_access(
    body: GrantAccessRequest,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin),
):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.subscription_status = "canceled"
    user.subscription_plan = None
    db.commit()
    return {"ok": True, "email": user.email, "status": user.subscription_status}


# ── Invite codes ───────────────────────────────────────────────────────────

@router.post("/invite-codes")
def create_invite_code(
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin),
):
    code = secrets.token_urlsafe(12)
    invite = InviteCode(code=code)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {"code": invite.code, "created_at": invite.created_at}


@router.get("/invite-codes")
def list_invite_codes(
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin),
):
    codes = db.query(InviteCode).order_by(InviteCode.created_at.desc()).all()
    return [
        {
            "code": c.code,
            "is_active": c.is_active,
            "used_by_email": c.used_by_email,
            "used_at": c.used_at,
            "created_at": c.created_at,
        }
        for c in codes
    ]


@router.delete("/invite-codes/{code}")
def revoke_invite_code(
    code: str,
    db: Session = Depends(get_db),
    _: None = Depends(_require_admin),
):
    invite = db.query(InviteCode).filter(InviteCode.code == code).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Code not found")
    invite.is_active = False
    db.commit()
    return {"ok": True}
