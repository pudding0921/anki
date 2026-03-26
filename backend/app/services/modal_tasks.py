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
    Render every page of a PDF at 2× scale and upload each image to Supabase.
    Also uploads the raw PDF so analyze_page can do text-position extraction.
    Returns a list of page info dicts.
    Runs in its own Modal container — never shares memory with Render.
    """
    sys.path.insert(0, "/")
    import fitz
    from app.services.storage import upload_file as _upload

    RENDER_SCALE = 2

    # Upload the original PDF so analyze_page can download it for text extraction
    pdf_key = f"{user_id}/{uuid.uuid4()}.pdf"
    source_pdf_url = _upload(pdf_bytes, pdf_key, "application/pdf") or ""

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        pdf_path = tmp.name

    doc = fitz.open(pdf_path)
    pages = []

    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE))
        img_bytes = pix.tobytes("png")
        w, h = pix.width, pix.height
        pix = None  # free before upload

        img_key = f"{user_id}/{uuid.uuid4()}.png"
        img_url = _upload(img_bytes, img_key, "image/png")
        img_bytes = None  # free after upload

        pages.append({
            "image_path": img_url,
            "width": w,
            "height": h,
            "page": i + 1,
            "source_pdf": source_pdf_url,
            "render_scale": RENDER_SCALE,
        })

    doc.close()
    os.unlink(pdf_path)

    return pages


# ── analyze_page ──────────────────────────────────────────────────────────────

@app.function(secrets=[_secret], timeout=120, memory=1024)
def analyze_page(page: dict, checklist_text: Optional[str] = None) -> dict:
    """
    Run AI occlusion analysis on one rendered slide.
    Tries PDF text-position extraction first, falls back to vision model.
    Uploads any extracted diagram images to Supabase.
    Returns result dict with zones and diagram_specs (image_path already uploaded).
    """
    sys.path.insert(0, "/")
    import fitz
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

    zones: list = []
    diagram_specs: list = []

    # ── Step 1: PDF text-position extraction (highest accuracy) ──────────────
    if source_pdf and source_pdf.startswith("http"):
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
                # Upload diagram images to Supabase (bytes can't be returned from Modal)
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

    # ── Step 2: Vision model fallback ────────────────────────────────────────
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
        "diagram_specs": diagram_specs,  # each has image_path (URL), not image_bytes
    }
