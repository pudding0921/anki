import asyncio
import json
import logging
import os
import time as _time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

# In-memory job store for background batch-occlusion jobs.
# Single-instance Render deployment — in-memory is sufficient.
_batch_jobs: dict = {}  # job_id -> {status, done, total, results, ...}

def _cleanup_old_jobs() -> None:
    now = _time.time()
    for jid in [k for k, v in _batch_jobs.items() if v.get("expires_at", 0) < now]:
        del _batch_jobs[jid]

# Hard cap on simultaneous heavy jobs (PDF render + AI).
# Each job can use ~50-100 MB; Render Starter = 512 MB total.
# At 4 concurrent jobs we stay safely under the limit.
_PROCESSING_SEMAPHORE: asyncio.Semaphore | None = None

def _get_semaphore() -> asyncio.Semaphore:
    global _PROCESSING_SEMAPHORE
    if _PROCESSING_SEMAPHORE is None:
        _PROCESSING_SEMAPHORE = asyncio.Semaphore(4)
    return _PROCESSING_SEMAPHORE

MAX_PDF_PAGES = 200  # soft cap — semaphore protects memory, this just prevents absurd uploads

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
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
    """Upload an image or PDF. Streams NDJSON page-by-page to keep the connection alive."""
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds the 50 MB limit")
    fname = file.filename or "upload"
    ext = os.path.splitext(fname)[1].lower()

    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    # ── Single image: fast path, no streaming needed ──────────────────────────
    if ext != ".pdf":
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
        page = {"image_path": supabase_url or local_path, "width": w, "height": h, "page": 1}
        return {"pages": [page]}

    # ── PDF: check page cap ───────────────────────────────────────────────────
    try:
        import fitz as _fitz_check
    except ImportError:
        raise HTTPException(status_code=500, detail="PyMuPDF not installed")

    pdf_name = f"{uuid.uuid4()}.pdf"
    pdf_abs = os.path.join(user_dir, pdf_name)
    with open(pdf_abs, "wb") as f:
        f.write(content)

    _doc_check = _fitz_check.open(pdf_abs)
    page_count = len(_doc_check)
    _doc_check.close()

    if page_count > MAX_PDF_PAGES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF has {page_count} pages — maximum is {MAX_PDF_PAGES} pages per upload."
        )

    # ── Modal path: offload rendering to serverless containers ───────────────
    if os.environ.get("MODAL_TOKEN_ID"):
        try:
            from app.services.modal_tasks import render_pdf_pages
            loop = asyncio.get_event_loop()
            pages = await loop.run_in_executor(
                None, render_pdf_pages.remote, content, current_user.id
            )
            del content

            async def stream_modal_pages():
                yield json.dumps({"type": "total", "total": len(pages)}) + "\n"
                for p in pages:
                    yield json.dumps({"type": "page", **p}) + "\n"
                yield json.dumps({"type": "done", "pages": pages}) + "\n"

            return StreamingResponse(
                stream_modal_pages(),
                media_type="application/x-ndjson",
                headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
            )
        except Exception as exc:
            logger.warning(f"Modal render_pdf_pages failed, falling back to local: {exc}")

    # ── Local fallback: render one page at a time ─────────────────────────────
    del content  # free raw PDF bytes — already saved to disk above
    source_pdf_url = f"/uploads/{current_user.id}/{pdf_name}"
    _RENDER_SCALE = 2

    async def stream_pages():
        sem = _get_semaphore()
        async with sem:
            import fitz as _fitz
            loop = asyncio.get_event_loop()
            pages = []
            yield json.dumps({"type": "total", "total": page_count}) + "\n"

            for page_index in range(page_count):
                def _render_one(idx: int) -> dict:
                    _doc = _fitz.open(pdf_abs)
                    pix = _doc[idx].get_pixmap(matrix=_fitz.Matrix(_RENDER_SCALE, _RENDER_SCALE))
                    img_name = f"{uuid.uuid4()}.png"
                    img_abs_path = os.path.join(user_dir, img_name)
                    pix.save(img_abs_path)
                    w, h = pix.width, pix.height
                    pix = None
                    _doc.close()
                    with open(img_abs_path, "rb") as fh:
                        img_bytes = fh.read()
                    supabase_url = storage_upload(img_bytes, f"{current_user.id}/{img_name}")
                    img_bytes = None
                    return {
                        "image_path": supabase_url or f"/uploads/{current_user.id}/{img_name}",
                        "width": w, "height": h, "page": idx + 1,
                        "source_pdf": source_pdf_url, "render_scale": _RENDER_SCALE,
                    }

                page_data = await loop.run_in_executor(None, _render_one, page_index)
                pages.append(page_data)
                yield json.dumps({"type": "page", **page_data}) + "\n"

            yield json.dumps({"type": "done", "pages": pages}) + "\n"

    return StreamingResponse(
        stream_pages(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


async def _run_batch_occlusion_job(
    job_id: str,
    pages: list,
    deck_name: str,
    user_dir: str,
    checklist_text: Optional[str],
    user_id: int,
) -> None:
    """Background task: processes all pages and writes cards to DB independently of the HTTP request."""
    if os.environ.get("MODAL_TOKEN_ID"):
        # Modal does all heavy work in isolated containers — Render just coordinates, no memory pressure
        await _run_batch_occlusion_job_inner(job_id, pages, deck_name, user_dir, checklist_text, user_id)
    else:
        # Local fallback: semaphore caps RAM usage (each job ~50-100 MB on Render's 512 MB)
        async with _get_semaphore():
            await _run_batch_occlusion_job_inner(job_id, pages, deck_name, user_dir, checklist_text, user_id)


async def _run_batch_occlusion_job_inner(
    job_id: str, pages: list, deck_name: str, user_dir: str,
    checklist_text: Optional[str], user_id: int,
) -> None:
    from app.database import SessionLocal

    # ── Step 1: get/create deck — short-lived session, released immediately.
    # We cannot hold a DB connection open across the long Modal processing wait
    # (5-10 min) because Supabase's pooler drops idle connections after ~5 min,
    # causing psycopg2.OperationalError when we finally try to INSERT cards.
    db = SessionLocal()
    try:
        deck = db.query(Deck).filter(Deck.name == deck_name, Deck.user_id == user_id).first()
        if not deck:
            deck = Deck(name=deck_name, user_id=user_id)
            db.add(deck)
            db.commit()
            db.refresh(deck)
        deck_id = deck.id
    finally:
        db.close()  # release BEFORE the long AI processing wait

    created = 0
    skipped = 0
    results: list = []

    # Placeholder so the rest of the function can reference db; it will be
    # reassigned to a fresh session before any writes happen.
    db = None
    try:

        def _process_page_sync(page: dict) -> dict:
            import requests as _requests
            image_path = page["image_path"]
            img_w = int(page["width"])
            img_h = int(page["height"])
            page_num = page.get("page", 1)
            source_pdf = page.get("source_pdf")
            render_scale = float(page.get("render_scale", 2.0))

            zones: list = []
            diagram_specs: list = []

            if source_pdf:
                abs_pdf = _resolve_upload_path(source_pdf)
                try:
                    import fitz
                    doc = fitz.open(abs_pdf)
                    fitz_page = doc[page_num - 1]
                    zones = zones_for_pdf_page(fitz_page, scale=render_scale, checklist_text=checklist_text)
                    try:
                        diagram_specs = diagram_cards_for_pdf_page(fitz_page)
                    except Exception as e:
                        logger.warning(f"Diagram detection failed on page {page_num}: {e}")
                    doc.close()
                except Exception as e:
                    logger.warning(f"PDF processing failed for page {page_num}: {e}")

            if not zones:
                image_bytes: Optional[bytes] = None
                if image_path.startswith("http"):
                    try:
                        r = _requests.get(image_path, timeout=30)
                        r.raise_for_status()
                        image_bytes = r.content
                    except Exception as e:
                        logger.warning(f"Could not fetch image for page {page_num}: {e}")
                else:
                    abs_path = _resolve_upload_path(image_path)
                    if os.path.exists(abs_path):
                        with open(abs_path, "rb") as f:
                            image_bytes = f.read()
                    else:
                        logger.warning(f"Image not found for page {page_num}: {abs_path}")

                if image_bytes:
                    zones = zones_for_image(image_bytes, img_w, img_h, checklist_text=checklist_text)
                elif not source_pdf:
                    reason = "could not fetch image" if image_path.startswith("http") else "file not found"
                    return {"page": page_num, "status": "error", "reason": reason,
                            "image_path": image_path, "img_w": img_w, "img_h": img_h,
                            "zones": [], "diagram_specs": []}

            return {"page": page_num, "image_path": image_path, "img_w": img_w,
                    "img_h": img_h, "zones": zones, "diagram_specs": diagram_specs}

        # ── Modal path ────────────────────────────────────────────────────────
        if os.environ.get("MODAL_TOKEN_ID"):
            try:
                from app.services.modal_tasks import analyze_page as _modal_analyze
                pages_with_uid = [{**p, "_user_id": user_id} for p in pages]

                # Pages whose text zones were pre-extracted in render_pdf_pages can be
                # written to DB directly — no analyze_page call needed.
                # Exception: if checklist_text is set, zones must be re-extracted with
                # the checklist filter, so all pages go through analyze_page.
                if checklist_text:
                    pages_direct: list = []
                    pages_for_vision = pages_with_uid
                else:
                    pages_direct = [p for p in pages_with_uid if p.get("pre_zones")]
                    pages_for_vision = [p for p in pages_with_uid if not p.get("pre_zones")]

                # ── Helper: write one page result to DB (needs active db session + deck_id) ──
        def _write_page(db_session, p_num, img_path, iw, ih, zones, diag_specs):
                    nonlocal created, skipped
                    page_result: dict = {"page": p_num, "status": "skipped", "zones": 0, "diagrams": 0}
                    if zones:
                        card = Card(deck_id=deck_id, card_type="occlusion", front="", back="",
                                    image_path=img_path, image_width=iw, image_height=ih)
                        db_session.add(card)
                        db_session.flush()
                        for z in zones:
                            db_session.add(OcclusionZone(card_id=card.id, label=z["label"],
                                                 x=z["x"], y=z["y"], width=z["width"], height=z["height"]))
                        created += 1
                        page_result["status"] = "created"
                        page_result["zones"] = len(zones)
                    else:
                        skipped += 1
                        page_result["reason"] = "no text zones found"
                    for spec in diag_specs:
                        diag_card = Card(deck_id=deck_id, card_type="occlusion", front="", back="",
                                         image_path=spec["image_path"],
                                         image_width=spec["width"], image_height=spec["height"])
                        db_session.add(diag_card)
                        db_session.flush()
                        for z in spec["zones"]:
                            db_session.add(OcclusionZone(card_id=diag_card.id, label=z["label"],
                                                 x=z["x"], y=z["y"], width=z["width"], height=z["height"]))
                        created += 1
                        page_result["diagrams"] = page_result.get("diagrams", 0) + 1
                        if page_result["status"] == "skipped":
                            page_result["status"] = "created"
                    return page_result

                # Only call analyze_page for image slides or checklist re-extraction
                if pages_for_vision:
                    loop = asyncio.get_event_loop()
                    inputs = [(p, checklist_text) for p in pages_for_vision]

                    def _run_starmap():
                        out = []
                        for pr in _modal_analyze.starmap(inputs):
                            out.append(pr)
                            _batch_jobs[job_id]["done"] = len(results) + len(out)
                        return out

                    vision_results = await loop.run_in_executor(None, _run_starmap)
                else:
                    vision_results = []

                # ── Open a FRESH session now that all AI work is done ─────────
                db = SessionLocal()
                try:
                    # Write pre-analyzed pages directly
                    for p in pages_direct:
                        pr = _write_page(db, p["page"], p["image_path"], int(p["width"]), int(p["height"]),
                                         p["pre_zones"], [])
                        results.append(pr)
                        _batch_jobs[job_id]["done"] = len(results)

                    # Write vision-model results
                    for pr in vision_results:
                        page_result = _write_page(
                            db, pr["page"], pr["image_path"], pr["img_w"], pr["img_h"],
                            pr["zones"], pr["diagram_specs"],
                        )
                        results.append(page_result)
                        _batch_jobs[job_id]["done"] = len(results)

                    db.commit()
                finally:
                    db.close()
                    db = None

                _batch_jobs[job_id].update({
                    "status": "done", "created": created, "skipped": skipped,
                    "deck_id": deck_id, "results": results,
                })
                logger.info(
                    f"Job {job_id} (Modal): done — {created} created, {skipped} skipped "
                    f"({len(pages_direct)} direct, {len(pages_for_vision)} via analyze_page)"
                )
                return
            except Exception as exc:
                logger.warning(f"Modal analyze failed for job {job_id}, falling back to local: {exc}")

        # ── Local fallback — open fresh session, process pages with 3 workers ─
        loop = asyncio.get_event_loop()
        local_results = []
        with ThreadPoolExecutor(max_workers=min(len(pages), 3)) as executor:
            futures = [loop.run_in_executor(executor, _process_page_sync, p) for p in pages]
            for fut in asyncio.as_completed(futures):
                local_results.append(await fut)
                _batch_jobs[job_id]["done"] = len(local_results)

        db = SessionLocal()
        try:
            for pr in local_results:
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
                    card = Card(deck_id=deck_id, card_type="occlusion", front="", back="",
                                image_path=image_path, image_width=img_w, image_height=img_h)
                    db.add(card)
                    db.flush()
                    for z in zones:
                        db.add(OcclusionZone(card_id=card.id, label=z["label"],
                                             x=z["x"], y=z["y"], width=z["width"], height=z["height"]))
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
                    local_diag_path = f"/uploads/{user_id}/{diag_name}"
                    diag_ct = "image/jpeg" if diag_ext in ("jpg", "jpeg") else "image/png"
                    supabase_diag_url = storage_upload(spec["image_bytes"], f"{user_id}/{diag_name}", diag_ct)
                    diag_card = Card(deck_id=deck_id, card_type="occlusion", front="", back="",
                                     image_path=supabase_diag_url or local_diag_path,
                                     image_width=spec["width"], image_height=spec["height"])
                    db.add(diag_card)
                    db.flush()
                    for z in spec["zones"]:
                        db.add(OcclusionZone(card_id=diag_card.id, label=z["label"],
                                             x=z["x"], y=z["y"], width=z["width"], height=z["height"]))
                    created += 1
                    page_result["diagrams"] = page_result.get("diagrams", 0) + 1
                    if page_result["status"] == "skipped":
                        page_result["status"] = "created"

                results.append(page_result)

            db.commit()
            _batch_jobs[job_id].update({
                "status": "done", "created": created, "skipped": skipped,
                "deck_id": deck_id, "results": results,
            })
            logger.info(f"Job {job_id}: done — {created} created, {skipped} skipped")
        finally:
            db.close()
            db = None

    except Exception as exc:
        logger.error(f"Job {job_id} failed: {exc}")
        _batch_jobs[job_id]["status"] = "error"
        _batch_jobs[job_id]["error"] = str(exc)
    finally:
        if db is not None:
            db.close()


@router.post("/batch-occlusion")
@limiter.limit("10/hour")
async def batch_occlusion(
    request: Request,
    deck_name: str = Form(...),
    pages_json: str = Form(...),
    checklist_file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_active_user),
):
    """Start a background AI occlusion job. Returns job_id immediately; poll /batch-occlusion/status/{job_id}."""
    try:
        pages = json.loads(pages_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid pages_json")

    checklist_text = None
    if checklist_file and checklist_file.filename:
        try:
            checklist_bytes = await checklist_file.read()
            checklist_text = extract_text(checklist_bytes, checklist_file.filename or "checklist.pdf")
        except Exception as e:
            logger.warning(f"Could not read checklist: {e}")

    user_dir = os.path.join(_ABS_UPLOAD_DIR, str(current_user.id))
    os.makedirs(user_dir, exist_ok=True)

    job_id = uuid.uuid4().hex
    _batch_jobs[job_id] = {
        "status": "processing",
        "done": 0,
        "total": len(pages),
        "expires_at": _time.time() + 7200,  # 2-hour TTL
    }
    _cleanup_old_jobs()

    task = asyncio.create_task(_run_batch_occlusion_job(
        job_id=job_id, pages=pages, deck_name=deck_name,
        user_dir=user_dir, checklist_text=checklist_text, user_id=current_user.id,
    ))
    _batch_jobs[job_id]["_task"] = task  # prevent GC

    return {"job_id": job_id, "total": len(pages)}


@router.get("/batch-occlusion/status/{job_id}")
async def batch_occlusion_status(
    job_id: str,
    current_user: User = Depends(get_active_user),
):
    """Poll for the status of a background batch-occlusion job."""
    job = _batch_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return {k: v for k, v in job.items() if not k.startswith("_")}


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
