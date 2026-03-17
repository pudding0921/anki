import json
import logging
import os
import uuid
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.database import get_db
from app.models.models import Card, Deck, OcclusionZone, User
from app.schemas.schemas import CardOut, GenerateCardsResponse, OcclusionCardCreate


class CardUpdateRequest(BaseModel):
    front: str = ""
    back: str = ""
from app.services.llm import generate_flashcards
from app.services.ocr import extract_text
from app.services.ai_occlusion import zones_for_pdf_page, zones_for_image, diagram_cards_for_pdf_page

router = APIRouter(prefix="/cards", tags=["cards"])

# Resolve the backend root from this file's location — never depends on CWD.
# cards.py lives at backend/app/api/cards.py → parent × 3 = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ABS_UPLOAD_DIR = str(_BACKEND_DIR / settings.UPLOAD_DIR)


def _resolve_upload_path(image_path: str) -> str:
    """Convert /uploads/user_id/file.png → absolute filesystem path."""
    # image_path is like "/uploads/1/abc.png"
    return str(_BACKEND_DIR / image_path.lstrip("/"))


@router.post("/generate", response_model=GenerateCardsResponse)
async def generate_cards(
    files: List[UploadFile] = File(...),
    card_count: int = Form(10),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    all_text_parts: List[str] = []
    first_image_path: Optional[str] = None

    for upload in files:
        content = await upload.read()
        fname = upload.filename or "upload"
        ext = os.path.splitext(fname)[1].lower() or ".bin"

        saved_name = f"{uuid.uuid4()}{ext}"
        with open(os.path.join(user_dir, saved_name), "wb") as f:
            f.write(content)

        if first_image_path is None and ext != ".pdf":
            first_image_path = f"/uploads/{current_user.id}/{saved_name}"

        text = extract_text(content, fname)
        if text:
            all_text_parts.append(f"--- {fname} ---\n{text}")

    combined_text = "\n\n".join(all_text_parts)
    cards = generate_flashcards(combined_text, card_count)

    if not cards:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service unavailable. Check that GROQ_API_KEY is set in backend/.env",
        )

    return GenerateCardsResponse(cards=cards, ocr_text=combined_text, image_path=first_image_path)


@router.post("/upload-pages")
async def upload_pages(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload an image or PDF. Returns list of rendered page images."""
    content = await file.read()
    fname = file.filename or "upload"
    ext = os.path.splitext(fname)[1].lower()

    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    pages = []

    if ext == ".pdf":
        try:
            import fitz
            # Save original PDF so batch-occlusion can re-open it for word extraction
            pdf_name = f"{uuid.uuid4()}.pdf"
            pdf_abs = os.path.join(user_dir, pdf_name)
            with open(pdf_abs, "wb") as f:
                f.write(content)
            source_pdf_url = f"/uploads/{current_user.id}/{pdf_name}"

            doc = fitz.open(pdf_abs)
            mat = fitz.Matrix(2, 2)
            for i, page in enumerate(doc):
                pix = page.get_pixmap(matrix=mat)
                img_name = f"{uuid.uuid4()}.png"
                pix.save(os.path.join(user_dir, img_name))
                pages.append({
                    "image_path": f"/uploads/{current_user.id}/{img_name}",
                    "width": pix.width,
                    "height": pix.height,
                    "page": i + 1,
                    "source_pdf": source_pdf_url,
                })
            doc.close()
        except ImportError:
            raise HTTPException(status_code=500, detail="PyMuPDF not installed")
    else:
        img_name = f"{uuid.uuid4()}{ext or '.jpg'}"
        with open(os.path.join(user_dir, img_name), "wb") as f:
            f.write(content)
        try:
            from PIL import Image as PILImage
            import io
            img = PILImage.open(io.BytesIO(content))
            w, h = img.size
        except Exception:
            w, h = 800, 600
        pages.append({
            "image_path": f"/uploads/{current_user.id}/{img_name}",
            "width": w,
            "height": h,
            "page": 1,
        })

    return {"pages": pages}


@router.post("/batch-occlusion")
async def batch_occlusion(
    deck_name: str = Form(...),
    pages_json: str = Form(...),   # JSON: [{image_path, width, height, page, source_pdf?}]
    checklist_file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    AI-powered batch occlusion card creation.
    For every page passed in, the AI analyzes the slide and creates a card automatically.
    No manual drawing required.
    """
    try:
        pages = json.loads(pages_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid pages_json")

    # Extract checklist text if provided
    checklist_text = None
    if checklist_file and checklist_file.filename:
        try:
            checklist_bytes = await checklist_file.read()
            checklist_text = extract_text(checklist_bytes, checklist_file.filename or "checklist.pdf")
            logger.info(f"Checklist loaded: {len(checklist_text or '')} chars")
        except Exception as e:
            logger.warning(f"Could not read checklist: {e}")

    # Find or create deck
    deck = (
        db.query(Deck)
        .filter(Deck.name == deck_name, Deck.user_id == current_user.id)
        .first()
    )
    if not deck:
        deck = Deck(name=deck_name, user_id=current_user.id)
        db.add(deck)
        db.flush()

    created = 0
    skipped = 0
    results = []

    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    # Cache open PDF documents to avoid re-opening per page
    pdf_docs: dict = {}

    for page in pages:
        image_path = page["image_path"]
        img_w = int(page["width"])
        img_h = int(page["height"])
        page_num = page.get("page", 1)
        source_pdf = page.get("source_pdf")
        fitz_page = None

        if source_pdf:
            # PDF path: use PyMuPDF word extraction directly (most reliable)
            abs_pdf = _resolve_upload_path(source_pdf)
            if abs_pdf not in pdf_docs:
                try:
                    import fitz
                    pdf_docs[abs_pdf] = fitz.open(abs_pdf)
                except Exception as e:
                    logger.warning(f"Could not open PDF {abs_pdf}: {e}")
                    pdf_docs[abs_pdf] = None
            doc = pdf_docs.get(abs_pdf)
            if doc is None:
                skipped += 1
                results.append({"page": page_num, "status": "error", "reason": "pdf not found"})
                continue
            fitz_page = doc[page_num - 1]  # 0-indexed
            zones = zones_for_pdf_page(fitz_page, scale=2.0, checklist_text=checklist_text)
        else:
            # Plain image upload
            abs_path = _resolve_upload_path(image_path)
            if not os.path.exists(abs_path):
                skipped += 1
                results.append({"page": page_num, "status": "error", "reason": "file not found"})
                continue
            with open(abs_path, "rb") as f:
                image_bytes = f.read()
            zones = zones_for_image(image_bytes, img_w, img_h, checklist_text=checklist_text)

        page_result: dict = {"page": page_num, "status": "skipped", "zones": 0, "diagrams": 0}

        if zones:
            card = Card(
                deck_id=deck.id,
                card_type="occlusion",
                front="",
                back="",
                image_path=image_path,
                image_width=img_w,
                image_height=img_h,
            )
            db.add(card)
            db.flush()

            for z in zones:
                db.add(OcclusionZone(
                    card_id=card.id,
                    label=z["label"],
                    x=z["x"],
                    y=z["y"],
                    width=z["width"],
                    height=z["height"],
                ))

            created += 1
            page_result["status"] = "created"
            page_result["zones"] = len(zones)
        else:
            skipped += 1
            page_result["reason"] = "no text zones found"

        # ── Diagram cards ── detect embedded images on PDF pages and create
        # a separate occlusion card for each significant diagram found.
        if fitz_page is not None:
            try:
                diagram_specs = diagram_cards_for_pdf_page(fitz_page)
            except Exception as e:
                logger.warning(f"Diagram detection failed on page {page_num}: {e}")
                diagram_specs = []

            for spec in diagram_specs:
                diag_ext = spec["ext"] if spec["ext"] in ("png", "jpg", "jpeg") else "png"
                diag_name = f"{uuid.uuid4()}.{diag_ext}"
                diag_abs = os.path.join(user_dir, diag_name)

                with open(diag_abs, "wb") as f:
                    f.write(spec["image_bytes"])

                diag_image_path = f"/uploads/{current_user.id}/{diag_name}"

                diag_card = Card(
                    deck_id=deck.id,
                    card_type="occlusion",
                    front="",
                    back="",
                    image_path=diag_image_path,
                    image_width=spec["width"],
                    image_height=spec["height"],
                )
                db.add(diag_card)
                db.flush()

                for z in spec["zones"]:
                    db.add(OcclusionZone(
                        card_id=diag_card.id,
                        label=z["label"],
                        x=z["x"],
                        y=z["y"],
                        width=z["width"],
                        height=z["height"],
                    ))

                created += 1
                page_result["diagrams"] = page_result.get("diagrams", 0) + 1
                if page_result["status"] == "skipped":
                    page_result["status"] = "created"

        results.append(page_result)

    # Close any open PDF documents
    for doc in pdf_docs.values():
        if doc is not None:
            doc.close()

    db.commit()
    return {"created": created, "skipped": skipped, "deck_id": deck.id, "results": results}


@router.post("/occlusion", response_model=CardOut)
def create_occlusion_card(
    payload: OcclusionCardCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deck = (
        db.query(Deck)
        .filter(Deck.name == payload.deck_name, Deck.user_id == current_user.id)
        .first()
    )
    if not deck:
        deck = Deck(name=payload.deck_name, user_id=current_user.id)
        db.add(deck)
        db.flush()

    card = Card(
        deck_id=deck.id,
        card_type="occlusion",
        front="",
        back="",
        image_path=payload.image_path,
        image_width=payload.image_width,
        image_height=payload.image_height,
    )
    db.add(card)
    db.flush()

    for zone in payload.zones:
        db.add(OcclusionZone(
            card_id=card.id,
            label=zone.label,
            x=zone.x,
            y=zone.y,
            width=zone.width,
            height=zone.height,
        ))

    db.commit()
    db.refresh(card)
    return card


@router.put("/{card_id}", response_model=CardOut)
def update_card(
    card_id: int,
    payload: CardUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == card_id, Deck.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    card.front = payload.front
    card.back = payload.back
    db.commit()
    db.refresh(card)
    return card


@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(
    zone_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    zone = (
        db.query(OcclusionZone)
        .join(Card)
        .join(Deck)
        .filter(OcclusionZone.id == zone_id, Deck.user_id == current_user.id)
        .first()
    )
    if not zone:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    db.delete(zone)
    db.commit()


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == card_id, Deck.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    db.delete(card)
    db.commit()
