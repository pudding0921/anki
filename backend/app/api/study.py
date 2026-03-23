from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Card, Deck, Review
from app.schemas.schemas import ReviewCreate, ReviewOut
from app.core.deps import get_current_user
from app.services.sm2 import apply_sm2

router = APIRouter(prefix="/api/study", tags=["study"])


@router.get("/due/{deck_id}")
def get_due_cards(
    deck_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    deck = db.query(Deck).filter(Deck.id == deck_id, Deck.user_id == current_user.id, Deck.deleted_at == None).first()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    now = datetime.now(timezone.utc)
    due_cards = (
        db.query(Card)
        .filter(Card.deck_id == deck_id, Card.sm2_due_date <= now, Card.deleted_at == None)
        .all()
    )
    return due_cards


@router.post("/review", response_model=ReviewOut)
def submit_review(
    payload: ReviewCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == payload.card_id, Deck.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    if payload.quality not in (0, 3, 4, 5):
        raise HTTPException(status_code=400, detail="quality must be 0, 3, 4, or 5")

    card = apply_sm2(card, payload.quality)

    review = Review(
        card_id=card.id,
        user_id=current_user.id,
        quality=payload.quality,
    )
    db.add(review)
    db.commit()
    db.refresh(card)

    return ReviewOut(card_id=card.id, next_due=card.sm2_due_date, interval=card.sm2_interval)
