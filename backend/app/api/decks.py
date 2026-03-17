from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.models import Card, Deck, User
from app.schemas.schemas import DeckCreate, DeckOut, DeckWithCards

router = APIRouter(prefix="/decks", tags=["decks"])


@router.post("", response_model=DeckOut, status_code=status.HTTP_201_CREATED)
def create_deck(
    payload: DeckCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deck = Deck(
        name=payload.name or "Untitled deck",
        description=payload.description or "",
        user_id=current_user.id,
    )
    db.add(deck)
    db.flush()  # assign deck.id before inserting cards

    for card_data in payload.cards:
        db.add(Card(
            deck_id=deck.id,
            card_type="text",
            front=card_data.question,
            back=card_data.answer,
        ))

    db.commit()
    db.refresh(deck)
    return DeckOut(
        id=deck.id,
        name=deck.name,
        description=deck.description,
        user_id=deck.user_id,
        created_at=deck.created_at,
        card_count=len(deck.cards),
    )


@router.get("", response_model=List[DeckOut])
def list_decks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    decks = (
        db.query(Deck)
        .filter(Deck.user_id == current_user.id)
        .order_by(Deck.created_at.desc())
        .all()
    )
    return [
        DeckOut(
            id=d.id,
            name=d.name,
            description=d.description,
            user_id=d.user_id,
            created_at=d.created_at,
            card_count=len(d.cards),
        )
        for d in decks
    ]


@router.get("/{deck_id}", response_model=DeckWithCards)
def get_deck(
    deck_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(Deck.id == deck_id, Deck.user_id == current_user.id)
        .first()
    )
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")
    return deck


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deck(
    deck_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(Deck.id == deck_id, Deck.user_id == current_user.id)
        .first()
    )
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")
    db.delete(deck)
    db.commit()
