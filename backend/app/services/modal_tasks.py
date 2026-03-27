"""
Modal serverless functions for heavy PDF + AI work.

Deploy once from the backend/ directory:
    modal deploy app/services/modal_tasks.py

Render calls these functions via MODAL_TOKEN_ID / MODAL_TOKEN_SECRET env vars.
Each function runs in its own isolated container — no shared memory with Render.
"""
import logging
import os
import sys
import tempfile
import uuid
from typing import Optional

import modal

logger = logging.getLogger(__name__)

# ── Container image ───────────────────────────────────────────────────────────
# Built once and cached by Modal. Rebuilt only when this definition changes.
# Run `modal deploy app/services/modal_tasks.py` from backend/ directory.
_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("tesseract-ocr", "tesseract-ocr-eng", "libgl1", "libglib2.0-0")
    .pip_install(
        "PyMuPDF==1.26.5",
        "Pillow>=10.4.0",
        "requests>=2.32.0",
        "groq==1.0.0",
        "google-generativeai>=0.8.0",
        "pytesseract==0.3.13",
        "pydantic-settings>=2.5.0",
        "pydantic[email]>=2.9.0",
        "python-dotenv==1.0.1",
    )
    # Copy the entire app source so containers can import from app.*
    .add_local_dir("app", remote_path="/app")
)

app = modal.App("flowcard", image=_image)

# Modal secret — set via `modal secret create flowcard-secrets KEY=val ...`
# Required keys: SUPABASE_URL, SUPABASE_SERVICE_KEY, GROQ_API_KEY
# Optional:      GEMINI_API_KEY, SUPABASE_BUCKET
_secret = modal.Secret.from_name("flowcard-secrets")


# ── render_pdf_pages ──────────────────────────────────────────────────────────

@app.function(secrets=[_secret], timeout=600, memory=2048)
def render_pdf_pages(pdf_bytes: bytes, user_id: int) -> list:
    """
    Render every page of a PDF at 2x scale and upload each image to Supabase.
    Optionally pre-extracts text zones via LLM (Phase 2) to skip analyze_page later.

    Two fully isolated phases so a Zone/LLM failure can NEVER prevent images from uploading:
      Phase 1 — render + upload (critical, always completes)
      Phase 2 — LLM zone extraction (optional, any failure leaves pre_zones=None)
    """
    sys.path.insert(0, "/")
    import fitz
    from concurrent.futures import ThreadPoolExecutor
    from app.services.storage import upload_file as _upload

    RENDER_SCALE = 2

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        pdf_path = tmp.name

    doc = fitz.open(pdf_path)
    n_pages = len(doc)

    # ── Phase 1: Render all pages + upload to Supabase ────────────────────────
    # AI imports are intentionally deferred to Phase 2 so an ImportError or any
    # other AI failure here cannot prevent the images from being uploaded.
    upload_workers = min(n_pages + 1, 20)

    with ThreadPoolExecutor(max_workers=upload_workers) as upload_pool:
        pdf_key = f"{user_id}/{uuid.uuid4()}.pdf"
        pdf_future = upload_pool.submit(_upload, pdf_bytes, pdf_key, "application/pdf")

        # (page_index, width, height, upload_future, raw_text_data_or_None)
        renders: list = []

        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE))
            img_bytes = pix.tobytes("png")
            w, h = pix.width, pix.height
            pix = None

            img_key = f"{user_id}/{uuid.uuid4()}.png"
            upload_future = upload_pool.submit(_upload, img_bytes, img_key, "image/png")
            img_bytes = None  # upload_pool holds the only remaining ref

            # Extract plain-Python text data while still holding the page object
            # (needs page; ~1ms CPU — no LLM involved here).
            text_data = None
            try:
                from app.services.ai_occlusion import _extract_page_text_data
                text_data = _extract_page_text_data(page)
            except Exception as e:
                logger.warning(f"Text extraction failed p{i+1}: {e}")

            renders.append((i, w, h, upload_future, text_data))

        source_pdf_url = pdf_future.result() or ""
        # Resolve all upload futures — storage.upload_file never raises, returns None on error
        renders_done = [
            (i, w, h, upload_fut.result(), text_data)
            for i, w, h, upload_fut, text_data in renders
        ]

    doc.close()
    os.unlink(pdf_path)

    # Build output pages with pre_zones=None — Phase 2 fills them in if it succeeds
    pages = [
        {
            "image_path": img_url,
            "width": w,
            "height": h,
            "page": i + 1,
            "source_pdf": source_pdf_url,
            "render_scale": RENDER_SCALE,
            "pre_zones": None,
        }
        for i, w, h, img_url, _ in renders_done
    ]

    # ── Phase 2: LLM zone extraction (completely optional) ───────────────────
    # Capped at 10 parallel Groq calls to stay under rate limits.
    # Any failure here is fully isolated — pages[] is already valid from Phase 1.
    try:
        from app.services.ai_occlusion import _zones_from_text_data

        def _run_zones(args):
            idx, text_data = args
            if text_data is None:
                return idx, None
            words, title_str, title_word_set, title_max_y, body_text, blocks = text_data
            try:
                return idx, _zones_from_text_data(
                    words, title_str, title_word_set, title_max_y,
                    body_text, blocks, RENDER_SCALE, None,
                )
            except Exception as e:
                logger.warning(f"Zone LLM failed p{idx+1}: {e}")
                return idx, None

        llm_inputs = [(i, td) for i, w, h, img_url, td in renders_done]
        # 4 parallel LLM workers: fast enough for 50-slide PDFs, avoids burst
        # rate-limit spikes when multiple users upload simultaneously.
        llm_workers = min(n_pages, 4)
        with ThreadPoolExecutor(max_workers=llm_workers) as llm_pool:
            for idx, pre_zones in llm_pool.map(_run_zones, llm_inputs):
                pages[idx]["pre_zones"] = pre_zones

    except Exception as e:
        logger.warning(f"Zone extraction phase failed entirely (p1 results still valid): {e}")
        # pre_zones stays None for all pages — analyze_page handles them in the batch job

    return pages


# ── analyze_page ──────────────────────────────────────────────────────────────

@app.function(secrets=[_secret], timeout=120, memory=1024)
def analyze_page(page: dict, checklist_text: Optional[str] = None) -> dict:
    """
    Run AI occlusion analysis on one rendered slide.

    If pre_zones is set (from render_pdf_pages), skips PDF re-download entirely
    and only runs the vision model if pre_zones is empty (image-heavy slide).
    Falls back to full PDF extraction if pre_zones is None (extraction failed).
    """
    sys.path.insert(0, "/")
    import requests as _req
    from app.services.ai_occlusion import (
        zones_for_pdf_page,
        zones_for_image,
    )
    from app.services.storage import upload_file as _upload

    image_path = page["image_path"]
    img_w = int(page["width"])
    img_h = int(page["height"])
    page_num = page.get("page", 1)
    source_pdf = page.get("source_pdf", "")
    render_scale = float(page.get("render_scale", 2.0))
    user_id = page.get("_user_id", "unknown")
    pre_zones = page.get("pre_zones")  # list or None

    zones: list = []

    if pre_zones is not None:
        # Text zones already extracted during rendering — no PDF download needed.
        # pre_zones may be empty [] for image-heavy slides; vision fallback handles those.
        zones = pre_zones
    elif source_pdf and source_pdf.startswith("http"):
        # pre_zones extraction failed — fall back to full PDF extraction
        import fitz
        try:
            resp = _req.get(source_pdf, timeout=30)
            resp.raise_for_status()
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(resp.content)
                pdf_path = tmp.name
            doc = fitz.open(pdf_path)
            fitz_page = doc[page_num - 1]
            zones = zones_for_pdf_page(fitz_page, scale=render_scale, checklist_text=checklist_text)
            doc.close()
            os.unlink(pdf_path)
        except Exception as e:
            logger.warning(f"PDF analysis failed p{page_num}: {e}")

    # Vision model fallback — only runs when pre_zones was None (Phase 2 failed entirely).
    # If pre_zones was [] (section divider / intentionally empty), trust it and skip vision.
    if pre_zones is None and not zones and image_path and image_path.startswith("http"):
        try:
            resp = _req.get(image_path, timeout=30)
            resp.raise_for_status()
            zones = zones_for_image(resp.content, img_w, img_h, checklist_text=checklist_text)
        except Exception as e:
            logger.warning(f"Vision fallback failed p{page_num}: {e}")

    return {
        "page": page_num,
        "image_path": image_path,
        "img_w": img_w,
        "img_h": img_h,
        "zones": zones,
        "diagram_specs": [],
    }
