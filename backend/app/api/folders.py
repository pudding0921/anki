from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.deps import get_active_user
from app.database import get_db
from app.models.models import Deck, Folder, User
from app.schemas.schemas import FolderCreate, FolderOut

router = APIRouter(prefix="/folders", tags=["folders"])


class FolderRename(BaseModel):
    name: str


class MoveDeckRequest(BaseModel):
    folder_id: Optional[int] = None  # None = unfiled


@router.get("", response_model=List[FolderOut])
def list_folders(
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folders = (
        db.query(Folder)
        .filter(Folder.user_id == current_user.id, Folder.deleted_at == None)
        .order_by(Folder.created_at)
        .all()
    )
    # Fetch deck counts in one query instead of N lazy loads
    folder_ids = [f.id for f in folders]
    deck_counts: dict = {}
    if folder_ids:
        deck_counts = dict(
            db.query(Deck.folder_id, func.count(Deck.id))
            .filter(Deck.folder_id.in_(folder_ids), Deck.deleted_at == None)
            .group_by(Deck.folder_id)
            .all()
        )
    return [
        FolderOut(
            id=f.id,
            name=f.name,
            user_id=f.user_id,
            created_at=f.created_at,
            deck_count=deck_counts.get(f.id, 0),
        )
        for f in folders
    ]


@router.post("", response_model=FolderOut, status_code=201)
def create_folder(
    payload: FolderCreate,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folder = Folder(
        name=payload.name.strip() or "Untitled folder",
        user_id=current_user.id,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderOut(
        id=folder.id,
        name=folder.name,
        user_id=folder.user_id,
        created_at=folder.created_at,
        deck_count=0,
    )


@router.put("/{folder_id}", response_model=FolderOut)
def rename_folder(
    folder_id: int,
    payload: FolderRename,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.user_id == current_user.id, Folder.deleted_at == None)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder.name = payload.name.strip() or folder.name
    db.commit()
    deck_count = (
        db.query(func.count(Deck.id))
        .filter(Deck.folder_id == folder_id, Deck.deleted_at == None)
        .scalar()
    ) or 0
    return FolderOut(
        id=folder.id,
        name=folder.name,
        user_id=folder.user_id,
        created_at=folder.created_at,
        deck_count=deck_count,
    )


@router.delete("/{folder_id}", status_code=204)
def delete_folder(
    folder_id: int,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    folder = (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.user_id == current_user.id, Folder.deleted_at == None)
        .first()
    )
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Move decks to unfiled before soft-deleting the folder
    db.query(Deck).filter(Deck.folder_id == folder_id, Deck.deleted_at == None).update({"folder_id": None})
    folder.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.put("/decks/{deck_id}/move", status_code=200)
def move_deck(
    deck_id: int,
    payload: MoveDeckRequest,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(Deck.id == deck_id, Deck.user_id == current_user.id)
        .first()
    )
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    if payload.folder_id is not None:
        folder = (
            db.query(Folder)
            .filter(Folder.id == payload.folder_id, Folder.user_id == current_user.id, Folder.deleted_at == None)
            .first()
        )
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
    deck.folder_id = payload.folder_id
    db.commit()
    return {"ok": True}
