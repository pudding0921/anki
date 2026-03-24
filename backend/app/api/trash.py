from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_active_user
from app.database import get_db
from app.models.models import Card, Deck, Folder, User
from app.schemas.schemas import TrashResponse, TrashFolderOut, TrashDeckOut, TrashCardOut

router = APIRouter(prefix="/trash", tags=["trash"])

TRASH_DAYS = 30


def _days_remaining(deleted_at: datetime) -> int:
    now = datetime.now(timezone.utc)
    if deleted_at.tzinfo is None:
        deleted_at = deleted_at.replace(tzinfo=timezone.utc)
    expires = deleted_at + timedelta(days=TRASH_DAYS)
    return max(0, (expires - now).days)


def _purge_expired(db: Session, user_id: int):
    """Permanently delete items that have been in trash for more than 30 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=TRASH_DAYS)
    for card in (
        db.query(Card)
        .join(Deck)
        .filter(Deck.user_id == user_id, Card.deleted_at != None, Card.deleted_at < cutoff)
        .all()
    ):
        db.delete(card)
    for deck in (
        db.query(Deck)
        .filter(Deck.user_id == user_id, Deck.deleted_at != None, Deck.deleted_at < cutoff)
        .all()
    ):
        db.delete(deck)
    for folder in (
        db.query(Folder)
        .filter(Folder.user_id == user_id, Folder.deleted_at != None, Folder.deleted_at < cutoff)
        .all()
    ):
        db.delete(folder)
    db.commit()


@router.get("", response_model=TrashResponse)
def get_trash(
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    _purge_expired(db, current_user.id)
    folders = (
        db.query(Folder)
        .filter(Folder.user_id == current_user.id, Folder.deleted_at != None)
        .all()
    )
    decks = (
        db.query(Deck)
        .filter(Deck.user_id == current_user.id, Deck.deleted_at != None)
        .all()
    )
    # Only show individually-trashed cards (deck itself is not trashed)
    cards = (
        db.query(Card)
        .join(Deck)
        .filter(
            Deck.user_id == current_user.id,
            Card.deleted_at != None,
            Deck.deleted_at == None,
        )
        .all()
    )
    return TrashResponse(
        folders=[
            TrashFolderOut(
                id=f.id,
                name=f.name,
                deleted_at=f.deleted_at,
                days_remaining=_days_remaining(f.deleted_at),
            )
            for f in folders
        ],
        decks=[
            TrashDeckOut(
                id=d.id,
                name=d.name,
                description=d.description,
                card_count=len([c for c in d.cards if c.deleted_at is None]),
                deleted_at=d.deleted_at,
                days_remaining=_days_remaining(d.deleted_at),
            )
            for d in decks
        ],
        cards=[
            TrashCardOut(
                id=c.id,
                deck_id=c.deck_id,
                deck_name=c.deck.name,
                card_type=c.card_type,
                front=c.front,
                back=c.back,
                deleted_at=c.deleted_at,
                days_remaining=_days_remaining(c.deleted_at),
            )
            for c in cards
        ],
    )


@router.post("/restore/folder/{folder_id}")
def restore_folder(
    folder_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(
            Folder.id == folder_id,
            Folder.user_id == current_user.id,
            Folder.deleted_at != None,
        )
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not in trash")
    folder.deleted_at = None
    db.commit()
    return {"ok": True}


@router.post("/restore/deck/{deck_id}")
def restore_deck(
    deck_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(
            Deck.id == deck_id,
            Deck.user_id == current_user.id,
            Deck.deleted_at != None,
        )
        .first()
    )
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not in trash")
    deck.deleted_at = None
    db.commit()
    return {"ok": True}


@router.post("/restore/card/{card_id}")
def restore_card(
    card_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(
            Card.id == card_id,
            Deck.user_id == current_user.id,
            Card.deleted_at != None,
        )
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not in trash")
    card.deleted_at = None
    db.commit()
    return {"ok": True}


@router.delete("/folder/{folder_id}", status_code=204)
def delete_folder_forever(
    folder_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(
            Folder.id == folder_id,
            Folder.user_id == current_user.id,
            Folder.deleted_at != None,
        )
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not in trash")
    db.delete(folder)
    db.commit()


@router.delete("/deck/{deck_id}", status_code=204)
def delete_deck_forever(
    deck_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(
            Deck.id == deck_id,
            Deck.user_id == current_user.id,
            Deck.deleted_at != None,
        )
        .first()
    )
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not in trash")
    db.delete(deck)
    db.commit()


@router.delete("/card/{card_id}", status_code=204)
def delete_card_forever(
    card_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(
            Card.id == card_id,
            Deck.user_id == current_user.id,
            Card.deleted_at != None,
        )
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not in trash")
    db.delete(card)
    db.commit()


@router.delete("/empty", status_code=204)
def empty_trash(
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    for card in (
        db.query(Card)
        .join(Deck)
        .filter(Deck.user_id == current_user.id, Card.deleted_at != None)
        .all()
    ):
        db.delete(card)
    for deck in (
        db.query(Deck)
        .filter(Deck.user_id == current_user.id, Deck.deleted_at != None)
        .all()
    ):
        db.delete(deck)
    for folder in (
        db.query(Folder)
        .filter(Folder.user_id == current_user.id, Folder.deleted_at != None)
        .all()
    ):
        db.delete(folder)
    db.commit()
