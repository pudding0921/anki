from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter()


@router.get("/ping")
def ping():
    """Lightweight keep-alive endpoint — no DB, always 200.
    Use this for UptimeRobot / uptime monitors so a transient DB
    hiccup never causes the monitor to pause and Render to spin down."""
    return {"status": "ok"}


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ok", "service": "flowcard-backend"}
