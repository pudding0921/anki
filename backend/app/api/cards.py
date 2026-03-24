import asyncio
import json
import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_active_user, get_current_user
from app.core.limiter import limiter
from app.database import get_db
from app.models.models import Card, Deck, OcclusionZone, User
from app.schemas.schemas import CardOut, GenerateCardsResponse, OcclusionCardCreate, OcclusionZoneCreate


class CardUpdateRequest(BaseModel):
    front: str = ""
    back: str = ""


class ZonesReplaceRequest(BaseModel):
    zones: List[OcclusionZoneCreate]
from app.services.llm import generate_flashcards
from app.services.ocr import extract_text
from app.services.ai_occlusion import zones_for_pdf_page, zones_for_image, diagram_cards_for_pdf_page
from app.services.storage import upload_file as storage_upload

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
@limiter.limit("10/hour")
async def generate_cards(
    request: Request,
    files: List[UploadFile] = File(...),
    card_count: int = Form(10),
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    all_text_parts: List[str] = []
    first_image_path: Optional[str] = None

    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
    for upload in files:
        content = await upload.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"File '{upload.filename}' exceeds the 50 MB limit")
        fname = upload.filename or "upload"
        ext = os.path.splitext(fname)[1].lower() or ".bin"

        saved_name = f"{uuid.uuid4()}{ext}"
        with open(os.path.join(user_dir, saved_name), "wb") as f:
            f.write(content)

        if first_image_path is None and ext != ".pdf":
            local_img_path = f"/uploads/{current_user.id}/{saved_name}"
            img_ct = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
            supabase_img_url = storage_upload(content, f"{current_user.id}/{saved_name}", img_ct)
            first_image_path = supabase_img_url or local_img_path

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
@limiter.limit("20/hour")
async def upload_pages(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_active_user),
):
    """Upload an image or PDF. Returns list of rendered page images."""
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds the 50 MB limit")
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
                img_abs = os.path.join(user_dir, img_name)
                pix.save(img_abs)
                local_path = f"/uploads/{current_user.id}/{img_name}"
                # Upload to persistent storage if configured
                with open(img_abs, "rb") as f:
                    img_bytes = f.read()
                supabase_url = storage_upload(img_bytes, f"{current_user.id}/{img_name}")
                pages.append({
                    "image_path": supabase_url or local_path,
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
        local_path = f"/uploads/{current_user.id}/{img_name}"
        content_type = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        supabase_url = storage_upload(content, f"{current_user.id}/{img_name}", content_type)
        pages.append({
            "image_path": supabase_url or local_path,
            "width": w,
            "height": h,
            "page": 1,
        })

    return {"pages": pages}


@router.post("/batch-occlusion")
@limiter.limit("10/hour")
async def batch_occlusion(
    request: Request,
    deck_name: str = Form(...),
    pages_json: str = Form(...),   # JSON: [{image_path, width, height, page, source_pdf?}]
    checklist_file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_active_user),
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

    def _process_page_sync(page: dict) -> dict:
        """Run all AI work for one page in a thread. Returns a result dict."""
        image_path = page["image_path"]
        img_w = int(page["width"])
        img_h = int(page["height"])
        page_num = page.get("page", 1)
        source_pdf = page.get("source_pdf")

        zones = []
        diagram_specs = []

        if source_pdf:
            abs_pdf = _resolve_upload_path(source_pdf)
            try:
                import fitz
                doc = fitz.open(abs_pdf)
                fitz_page = doc[page_num - 1]
                zones = zones_for_pdf_page(fitz_page, scale=2.0, checklist_text=checklist_text)
                try:
                    diagram_specs = diagram_cards_for_pdf_page(fitz_page)
                except Exception as e:
                    logger.warning(f"Diagram detection failed on page {page_num}: {e}")
                doc.close()
            except Exception as e:
                logger.warning(f"Could not open PDF {abs_pdf}: {e}")
                return {"page": page_num, "status": "error", "reason": "pdf not found",
                        "image_path": image_path, "img_w": img_w, "img_h": img_h,
                        "zones": [], "diagram_specs": []}
        else:
            # image_path may be a Supabase URL (https://...) or local path (/uploads/...)
            if image_path.startswith("http"):
                import requests as _requests
                try:
                    r = _requests.get(image_path, timeout=30)
                    r.raise_for_status()
                    image_bytes = r.content
                except Exception as e:
                    return {"page": page_num, "status": "error", "reason": f"could not fetch image: {e}",
                            "image_path": image_path, "img_w": img_w, "img_h": img_h,
                            "zones": [], "diagram_specs": []}
            else:
                abs_path = _resolve_upload_path(image_path)
                if not os.path.exists(abs_path):
                    return {"page": page_num, "status": "error", "reason": "file not found",
                            "image_path": image_path, "img_w": img_w, "img_h": img_h,
                            "zones": [], "diagram_specs": []}
                with open(abs_path, "rb") as f:
                    image_bytes = f.read()
            zones = zones_for_image(image_bytes, img_w, img_h, checklist_text=checklist_text)

        return {
            "page": page_num,
            "image_path": image_path,
            "img_w": img_w,
            "img_h": img_h,
            "zones": zones,
            "diagram_specs": diagram_specs,
        }

    # Run all pages in parallel — each page's LLM call is independent
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=min(len(pages), 8)) as executor:
        page_results = await asyncio.gather(
            *[loop.run_in_executor(executor, _process_page_sync, p) for p in pages]
        )

    # Write results to DB sequentially (SQLAlchemy session is not thread-safe)
    for pr in page_results:
        page_num = pr["page"]
        image_path = pr["image_path"]
        img_w = pr["img_w"]
        img_h = pr["img_h"]
        zones = pr["zones"]
        diagram_specs = pr["diagram_specs"]

        if pr.get("status") == "error":
            skipped += 1
            results.append({"page": page_num, "status": "error", "reason": pr.get("reason", "")})
            continue

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

        for spec in diagram_specs:
            diag_ext = spec["ext"] if spec["ext"] in ("png", "jpg", "jpeg") else "png"
            diag_name = f"{uuid.uuid4()}.{diag_ext}"
            with open(os.path.join(user_dir, diag_name), "wb") as f:
                f.write(spec["image_bytes"])
            local_diag_path = f"/uploads/{current_user.id}/{diag_name}"
            diag_ct = "image/jpeg" if diag_ext in ("jpg", "jpeg") else "image/png"
            supabase_diag_url = storage_upload(spec["image_bytes"], f"{current_user.id}/{diag_name}", diag_ct)
            diag_image_path = supabase_diag_url or local_diag_path
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

    db.commit()
    return {"created": created, "skipped": skipped, "deck_id": deck.id, "results": results}


@router.post("/occlusion", response_model=CardOut)
def create_occlusion_card(
    payload: OcclusionCardCreate,
    current_user: User = Depends(get_active_user),
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


@router.put("/{card_id}/zones", response_model=CardOut)
def replace_card_zones(
    card_id: int,
    payload: ZonesReplaceRequest,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """Replace all occlusion zones for a card with a new set."""
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == card_id, Deck.user_id == current_user.id, Card.deleted_at == None)
        .first()
    )
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    db.query(OcclusionZone).filter(OcclusionZone.card_id == card_id).delete()

    for z in payload.zones:
        db.add(OcclusionZone(
            card_id=card.id,
            label=z.label,
            x=z.x,
            y=z.y,
            width=z.width,
            height=z.height,
        ))

    db.commit()
    db.refresh(card)
    return card


@router.put("/{card_id}", response_model=CardOut)
def update_card(
    card_id: int,
    payload: CardUpdateRequest,
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == card_id, Deck.user_id == current_user.id, Card.deleted_at == None)
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
    current_user: User = Depends(get_active_user),
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
    current_user: User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    card = (
        db.query(Card)
        .join(Deck)
        .filter(Card.id == card_id, Deck.user_id == current_user.id, Card.deleted_at == None)
        .first()
    )
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    card.deleted_at = datetime.now(timezone.utc)
    db.commit()
