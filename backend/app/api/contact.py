import logging

import resend
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.limiter import limiter
from app.database import get_db
from app.models.models import ContactMessage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contact", tags=["contact"])


class ContactRequest(BaseModel):
    name: str = Field(..., max_length=100)
    email: EmailStr
    subject: str = Field(..., max_length=200)
    message: str = Field(..., max_length=5000)


def _send_email(body: ContactRequest) -> None:
    """Send a contact form notification via Resend."""
    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured — skipping email notification")
        return

    resend.api_key = settings.RESEND_API_KEY

    html = f"""
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e">
      <div style="background:linear-gradient(135deg,#6366f4,#8b5cf6);padding:24px 32px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;color:#fff;font-size:20px">New message — FlowCard</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;background:#fff">
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:80px">From</td>
              <td style="padding:8px 0;font-weight:600">{body.name} &lt;{body.email}&gt;</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Subject</td>
              <td style="padding:8px 0;font-weight:600">{body.subject}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px">
        <p style="white-space:pre-wrap;line-height:1.7;color:#334155;margin:0">{body.message}</p>
        <div style="margin-top:28px;padding:16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#94a3b8">
          Reply to this email to respond directly to {body.name}.
        </div>
      </div>
    </div>
    """

    resend.Emails.send({
        "from": settings.RESEND_FROM_EMAIL,
        "to": [settings.CONTACT_RECIPIENT],
        "reply_to": body.email,
        "subject": f"[FlowCard Contact] {body.subject}",
        "html": html,
    })


@router.post("")
@limiter.limit("3/minute")
def send_message(request: Request, body: ContactRequest, db: Session = Depends(get_db)):
    # Always save to DB first
    msg = ContactMessage(
        name=body.name.strip(),
        email=body.email.strip(),
        subject=body.subject.strip(),
        message=body.message.strip(),
    )
    db.add(msg)
    db.commit()

    # Fire email notification — failure never blocks the response
    try:
        _send_email(body)
    except Exception as e:
        logger.error("Failed to send contact email: %s", e)

    return {"ok": True, "message": "Message received — we'll get back to you soon!"}
