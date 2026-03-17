import os
import tempfile
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Card, Deck
from app.core.deps import get_current_user
from app.services.anki_export import export_deck_to_apkg

router = APIRouter(prefix="/api/decks", tags=["export"])

# Resolve the backend root directory regardless of CWD at startup
# export.py lives at backend/app/api/export.py → parent.parent.parent = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


@router.get("/{deck_id}/export")
def export_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    cards = db.query(Card).filter(Card.deck_id == deck_id).all()
    if not cards:
        raise HTTPException(status_code=400, detail="Deck has no cards to export")

    tmp = tempfile.NamedTemporaryFile(suffix=".apkg", delete=False)
    tmp.close()

    export_deck_to_apkg(deck.name, cards, tmp.name, upload_root=str(_BACKEND_DIR))

    safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in deck.name)
    filename = f"{safe_name}.apkg"

    return FileResponse(
        path=tmp.name,
        media_type="application/octet-stream",
        filename=filename,
        background=BackgroundTask(os.unlink, tmp.name),
    )
