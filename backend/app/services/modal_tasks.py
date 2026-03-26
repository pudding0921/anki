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
    Render every page of a PDF at 2x scale, upload each image to Supabase,
    and pre-extract text zones using PDF text positions (fast, CPU-only).

    Uploads run in parallel via a thread pool — one thread per page plus one
    for the source PDF — so total upload time is O(1) instead of O(n).
    Rendering is CPU-bound and runs sequentially; each page's upload is
    submitted immediately after rendering so uploads overlap with rendering.
    """
    sys.path.insert(0, "/")
    import fitz
    from concurrent.futures import ThreadPoolExecutor
    from app.services.storage import upload_file as _upload
    from app.services.ai_occlusion import zones_for_pdf_page as _zones_fn

    RENDER_SCALE = 2

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        pdf_path = tmp.name

    doc = fitz.open(pdf_path)
    # Cap workers: PDF upload + up to 12 page uploads at once
    max_workers = min(len(doc) + 1, 13)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        # Start the source-PDF upload immediately in the background
        pdf_key = f"{user_id}/{uuid.uuid4()}.pdf"
        pdf_future = pool.submit(_upload, pdf_bytes, pdf_key, "application/pdf")

        # Render each page, submit its upload immediately, release the bytes
        page_meta = []
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE))
            img_bytes = pix.tobytes("png")
            w, h = pix.width, pix.height
            pix = None

            img_key = f"{user_id}/{uuid.uuid4()}.png"
            upload_future = pool.submit(_upload, img_bytes, img_key, "image/png")
            img_bytes = None  # release — pool holds the only remaining ref

            try:
                pre_zones = _zones_fn(page, scale=RENDER_SCALE)
            except Exception as e:
                logger.warning(f"Zone pre-extraction failed p{i+1}: {e}")
                pre_zones = None

            page_meta.append((i, upload_future, w, h, pre_zones))

        source_pdf_url = pdf_future.result() or ""
        # Collect upload URLs in submission order (futures resolve as uploads finish)
        pages = []
        for i, upload_future, w, h, pre_zones in page_meta:
            img_url = upload_future.result()
            pages.append({
                "image_path": img_url,
                "width": w,
                "height": h,
                "page": i + 1,
                "source_pdf": source_pdf_url,
                "render_scale": RENDER_SCALE,
                "pre_zones": pre_zones,
            })

    doc.close()
    os.unlink(pdf_path)

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
        diagram_cards_for_pdf_page,
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
    diagram_specs: list = []

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
            try:
                raw_diagrams = diagram_cards_for_pdf_page(fitz_page)
                for spec in raw_diagrams:
                    ext = spec.get("ext", "png")
                    if ext not in ("png", "jpg", "jpeg"):
                        ext = "png"
                    ct = "image/jpeg" if ext in ("jpg", "jpeg") else "image/png"
                    diag_key = f"{user_id}/{uuid.uuid4()}.{ext}"
                    diag_url = _upload(spec["image_bytes"], diag_key, ct)
                    if diag_url:
                        diagram_specs.append({
                            "image_path": diag_url,
                            "width": spec["width"],
                            "height": spec["height"],
                            "zones": spec["zones"],
                        })
            except Exception as e:
                logger.warning(f"Diagram detection failed p{page_num}: {e}")
            doc.close()
            os.unlink(pdf_path)
        except Exception as e:
            logger.warning(f"PDF analysis failed p{page_num}: {e}")

    # Vision model fallback — only runs for image slides (zones still empty)
    if not zones and image_path and image_path.startswith("http"):
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
        "diagram_specs": diagram_specs,
    }
