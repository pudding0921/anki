"""Thin wrapper around Resend for transactional emails."""
import logging

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, html: str) -> bool:
    """Send a transactional email via Resend. Returns True on success."""
    from app.core.config import settings
    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — email not sent to %s", to)
        return False
    try:
        import resend as _resend
        _resend.api_key = settings.RESEND_API_KEY
        _resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


def send_verification_email(to: str, token: str, frontend_url: str) -> bool:
    link = f"{frontend_url}/verify-email?token={token}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Verify your FlowCard email</h2>
      <p>Click the link below to verify your email address. This link expires in 48 hours.</p>
      <p><a href="{link}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Verify Email</a></p>
      <p style="color:#888;font-size:12px">If you didn't create a FlowCard account, you can safely ignore this email.</p>
    </div>"""
    return send_email(to, "Verify your FlowCard email", html)


def send_password_reset_email(to: str, token: str, frontend_url: str) -> bool:
    link = f"{frontend_url}/reset-password?token={token}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Reset your FlowCard password</h2>
      <p>Click the link below to set a new password. This link expires in 1 hour.</p>
      <p><a href="{link}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Reset Password</a></p>
      <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
    </div>"""
    return send_email(to, "Reset your FlowCard password", html)
