"""
AI occlusion zone generation.

For PDFs: PyMuPDF gives exact word positions → LLM picks key terms → zones created.
          Title is extracted first and hard-excluded from candidate terms.
          Formatting fallback (bold/large/caps, skipping title block) if LLM fails.
For images: Groq vision model → Tesseract OCR + LLM fallback.
For diagrams: embedded images extracted from PDF pages → vision model.
"""
import json
import logging
import re
from typing import Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────────────

KEY_TERMS_PROMPT = """You are an elite medical education specialist creating high-yield Anki flashcards. Your job is to identify the EXACT words and phrases a student must recall on an exam — nothing more, nothing less.

SLIDE TITLE — ABSOLUTE NO-FLY ZONE (never occlude any word from this): {title}

━━ NEVER occlude ━━
• ANY word from the slide title above (this is a hard rule)
• Slide numbers, page numbers, dates, years
• Professor names, author names, institution names
• Generic verbs and connectors: "is", "are", "can", "may", "include", "such as", "refers to", "defined as", "e.g.", "i.e."
• Articles and prepositions: "the", "a", "an", "of", "in", "by", "via", "with"
• Words under 4 characters unless they are a critical acronym

━━ ALWAYS occlude — high-yield targets ━━
• Drug names (generic names: e.g. "metformin", "atorvastatin", "amoxicillin")
• Specific mechanisms of action (e.g. "inhibits HMG-CoA reductase", "blocks Na+ channels")
• Pathophysiology terms (e.g. "insulin resistance", "oxidative phosphorylation")
• Disease names and diagnostic criteria (e.g. "Cushing syndrome", "HbA1c > 6.5%")
• Anatomical structures with clinical significance
• Lab values, thresholds, and units (e.g. "< 120 mmHg", "eGFR < 60")
• Named signs, syndromes, eponyms (e.g. "Virchow's triad", "Battle's sign")
• Specific percentages or statistics if clinically meaningful
• The single defining term in any definition or cause-effect statement

━━ Quantity ━━
• 2–5 terms maximum — quality over quantity
• For bullet-point slides: pick 1 high-yield term per bullet, skip bullets with no testable content
• If the slide has fewer than 3 genuinely testable terms, return only those — never pad
{checklist_section}
Slide body text (title already removed):
{body_text}

Return ONLY a valid JSON array of exact strings copied from the text — no markdown, no explanation:
["term1", "multi word phrase"]"""

CHECKLIST_SECTION = "\n━━ Study checklist — prioritize terms related to these topics ━━\n{checklist}\n"

VISION_PROMPT = (
    "You are an elite medical education specialist analyzing a study slide or diagram. "
    "Identify the 2–6 most high-yield terms a student MUST memorize for exams.\n\n"
    "HARD RULES:\n"
    "- SKIP the slide title/heading entirely — never occlude it\n"
    "- SKIP person names, institution names, generic verbs, filler phrases\n"
    "- PICK: drug names, anatomical labels, pathology terms, mechanism keywords, "
    "diagram annotations, defined vocabulary with exam relevance\n\n"
    "For each term, give its bounding box as a fraction (0.0–1.0) of image width/height. "
    "x,y = top-left corner; w,h = size of the box.\n"
    'Return ONLY valid JSON — no markdown:\n[{"label":"term","x":0.1,"y":0.2,"w":0.2,"h":0.04}]'
)

ANKIFLOW_VISION_PROMPT = """You are an elite Medical Education AI and Flashcard Specialist analyzing a study slide image.

### STEP 1 — IDENTIFY THE TITLE (ABSOLUTE NO-FLY ZONE)
Scan for the PRIMARY TOPIC: the largest, boldest, or most prominent text on the slide.
Store it as master_topic. You must NEVER place any occlusion box over any word in master_topic.
The student always needs to see the topic to answer the card correctly.

### STEP 2 — IDENTIFY HIGH-YIELD OCCLUSION TARGETS
Look for:
• Drug names and drug classes
• Mechanisms of action and pathophysiology terms
• Anatomical structure labels and diagram annotations
• Disease names, syndromes, diagnostic criteria
• Defined vocabulary terms that would appear on an exam
• Specific values, thresholds, or units with clinical significance
• Named signs, eponyms, or classification systems

Skip entirely:
• Any text that is part of the title / master_topic
• Person names, author names, institutional names
• Generic connecting words, articles, prepositions
• Decorative text, slide numbers, footnotes

### STEP 3 — OUTPUT (STRICT JSON ONLY — zero markdown, zero explanation)
One card per term. Bounding box uses [ymin, xmin, ymax, xmax] on a 0–1000 scale.
{
  "master_topic": "string",
  "cards": [
    {
      "type": "IMAGE_OCCLUSION",
      "occlusion_label": "exact term as it appears on the slide",
      "bounding_box": [ymin, xmin, ymax, xmax],
      "context_hint": "one-phrase description of surrounding context"
    }
  ]
}"""


# ── Title extraction ──────────────────────────────────────────────────────────

def _extract_title_info(page) -> tuple:
    """
    Extract the slide title using font-size detection (most reliable approach).
    Slide titles are always the largest text on the slide.

    Returns (title_str, title_word_set, title_max_y) where:
      - title_str: the raw title text
      - title_word_set: lowercase stripped words in the title (for filtering)
      - title_max_y: the bottom edge of the title block (PDF points)
        — used to skip title area in zone matching and formatting fallback
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return "", set(), 0.0

    all_spans = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if span["text"].strip():
                    all_spans.append(span)

    if not all_spans:
        return "", set(), 0.0

    max_size = max(s["size"] for s in all_spans)

    # Title = all spans whose font size is within 15% of the largest font
    title_spans = [s for s in all_spans if s["size"] >= max_size * 0.85]

    title_str = " ".join(s["text"].strip() for s in title_spans)
    title_word_set: Set[str] = {
        w.lower().strip(".,;:!?()'\"[]{}")
        for s in title_spans
        for w in s["text"].split()
        if len(w) > 1
    }
    title_max_y = max(s["bbox"][3] for s in title_spans) if title_spans else 0.0

    return title_str, title_word_set, title_max_y


def _term_overlaps_title(term: str, title_words: Set[str]) -> bool:
    """True if ALL words in the term are title words (would cover the title)."""
    if not title_words:
        return False
    term_words = {t.lower().strip(".,;:!?()'\"") for t in term.split() if len(t) > 1}
    return bool(term_words) and term_words.issubset(title_words)


# ── PDF processing (primary — most reliable) ──────────────────────────────────

def _ask_llm_for_key_terms(
    body_text: str,
    title: str,
    checklist_text: Optional[str] = None,
) -> List[str]:
    """Send slide body text (title stripped) to LLM, get back key terms."""
    from app.services.llm import _call_groq, _call_ollama

    checklist_section = (
        CHECKLIST_SECTION.format(checklist=checklist_text[:1500]) if checklist_text else ""
    )
    prompt = KEY_TERMS_PROMPT.format(
        title=title or "(no title detected)",
        body_text=body_text[:4000],
        checklist_section=checklist_section,
    )
    raw = _call_ollama(prompt) or _call_groq(prompt)
    if not raw:
        return []

    raw = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        return []
    try:
        terms = json.loads(match.group())
        return [t.strip() for t in terms if isinstance(t, str) and t.strip()]
    except Exception:
        return []


def _match_terms_to_pdf_words(
    words: list,
    key_terms: List[str],
    scale: float = 2.0,
    title_max_y: float = 0.0,
) -> List[Dict]:
    """Match LLM-selected key terms to PyMuPDF word bounding boxes.
    Skips words that are in the title area (y < title_max_y)."""
    zones = []
    used: set = set()

    # Filter out words that are in the title zone
    body_words = [w for w in words if w[1] >= title_max_y - 2]

    for term in key_terms:
        term_lower = term.lower()
        term_parts = term_lower.split()

        for i in range(len(body_words)):
            if i in used:
                continue
            word_text = body_words[i][4].lower()

            if len(term_parts) == 1:
                if term_parts[0] in word_text:
                    w = body_words[i]
                    zones.append({
                        "label": term,
                        "x": round(w[0] * scale, 1),
                        "y": round(w[1] * scale, 1),
                        "width": round((w[2] - w[0]) * scale, 1),
                        "height": round((w[3] - w[1]) * scale, 1),
                    })
                    used.add(i)
                    break
            else:
                seq = body_words[i: i + len(term_parts)]
                if len(seq) < len(term_parts):
                    continue
                seq_text = " ".join(w[4].lower() for w in seq)
                if term_lower in seq_text or seq_text in term_lower:
                    x = min(w[0] for w in seq) * scale
                    y = min(w[1] for w in seq) * scale
                    x1 = max(w[2] for w in seq) * scale
                    y1 = max(w[3] for w in seq) * scale
                    zones.append({
                        "label": term,
                        "x": round(x, 1),
                        "y": round(y, 1),
                        "width": round(x1 - x, 1),
                        "height": round(y1 - y, 1),
                    })
                    used.update(range(i, i + len(term_parts)))
                    break

    return [z for z in zones if z["width"] > 3 and z["height"] > 3]


def _formatting_fallback(
    page, scale: float = 2.0, title_max_y: float = 0.0
) -> List[Dict]:
    """
    No LLM needed — identify important text by formatting:
    bold text, larger-than-body font, ALL CAPS phrases.
    Skips the slide title (topmost block, determined by title_max_y).
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return []

    sizes = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if span["text"].strip():
                    sizes.append(span["size"])

    if not sizes:
        return []

    sizes.sort()
    median_size = sizes[len(sizes) // 2]
    max_size = sizes[-1]

    zones = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span["text"].strip()
                if not text or len(text) < 4:
                    continue

                bbox = span["bbox"]
                # Skip anything in the title area
                if bbox[1] < title_max_y + 2:
                    continue

                size = span["size"]
                flags = span.get("flags", 0)

                # Also skip max-size text (secondary title / section heading)
                if size >= max_size * 0.95:
                    continue

                is_bold = bool(flags & (1 << 4))
                is_larger = size > median_size * 1.1
                is_allcaps = text.isupper() and len(text) > 3

                if is_bold or is_larger or is_allcaps:
                    zones.append({
                        "label": text,
                        "x": round(bbox[0] * scale, 1),
                        "y": round(bbox[1] * scale, 1),
                        "width": round((bbox[2] - bbox[0]) * scale, 1),
                        "height": round((bbox[3] - bbox[1]) * scale, 1),
                    })

    # Deduplicate by label, cap at 6
    seen: set = set()
    deduped = []
    for z in zones:
        if z["label"] not in seen:
            seen.add(z["label"])
            deduped.append(z)

    return deduped[:6]


def zones_for_pdf_page(
    page, scale: float = 2.0, checklist_text: Optional[str] = None
) -> List[Dict]:
    """
    Generate occlusion zones for one PyMuPDF page object.
    1. Extract title explicitly — excluded from all zone candidates
    2. Ask LLM to pick key terms from the body text only
    3. Match terms to word bounding boxes, skipping title area
    4. Post-filter: remove any zone whose label words are all title words
    5. Fallback to formatting heuristics if LLM returns nothing
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)

    # ── Step 1: Extract title (font-size based — largest text = title) ─────────
    title_str, title_word_set, title_max_y = _extract_title_info(page)
    logger.info(f"Slide title detected: {repr(title_str)} | title_max_y={title_max_y:.1f}")

    # Body text = everything below the title line
    body_words = [w for w in words if w[1] >= title_max_y - 2]
    body_text = " ".join(w[4] for w in body_words if w[4].strip())

    zones: List[Dict] = []

    # ── Step 2 & 3: LLM → match to positions ─────────────────────────────────
    if body_text.strip():
        key_terms = _ask_llm_for_key_terms(body_text, title_str, checklist_text)

        # ── Step 4: hard post-filter — remove any term that is the title ──────
        key_terms = [t for t in key_terms if not _term_overlaps_title(t, title_word_set)]

        if key_terms:
            zones = _match_terms_to_pdf_words(words, key_terms, scale, title_max_y)

    # ── Step 5: formatting fallback ───────────────────────────────────────────
    if not zones:
        logger.info("LLM gave no zones — using formatting fallback")
        zones = _formatting_fallback(page, scale, title_max_y)

    return zones


# ── Vision model (shared by images and diagrams) ─────────────────────────────

def _call_vision_gemini(image_bytes: bytes, img_w: int, img_h: int) -> Optional[List[Dict]]:
    """Ask Gemini 1.5 Flash to identify key terms using the AnkiFlow Pro prompt.
    Returns zones in pixel coords of the source image."""
    from app.core.config import settings
    if not settings.GEMINI_API_KEY:
        return None

    try:
        import io
        import google.generativeai as genai
        from PIL import Image as PILImage

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")
        img = PILImage.open(io.BytesIO(image_bytes))

        response = model.generate_content([ANKIFLOW_VISION_PROMPT, img])
        raw = response.text or ""
        raw = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None

        data = json.loads(match.group())
        master_topic = data.get("master_topic", "")
        if master_topic:
            logger.info(f"Gemini master_topic: {repr(master_topic)}")

        zones = []
        for card in data.get("cards", []):
            if card.get("type") != "IMAGE_OCCLUSION":
                continue
            bb = card.get("bounding_box", [])
            if len(bb) != 4:
                continue
            ymin, xmin, ymax, xmax = bb
            x = (xmin / 1000) * img_w
            y = (ymin / 1000) * img_h
            w = ((xmax - xmin) / 1000) * img_w
            h = ((ymax - ymin) / 1000) * img_h
            if w > 5 and h > 5:
                zones.append({
                    "label": card.get("occlusion_label", "term"),
                    "x": round(x, 1),
                    "y": round(y, 1),
                    "width": round(w, 1),
                    "height": round(h, 1),
                })

        return zones or None

    except Exception as e:
        logger.warning(f"Gemini vision failed: {e}")
        return None


def _call_vision_groq(image_bytes: bytes) -> Optional[List[Dict]]:
    """Ask Groq vision model to identify key terms with bounding box percentages."""
    from app.core.config import settings
    if not settings.GROQ_API_KEY:
        return None

    try:
        import base64
        from groq import Groq

        b64 = base64.b64encode(image_bytes).decode()
        client = Groq(api_key=settings.GROQ_API_KEY)
        resp = client.chat.completions.create(
            model="llama-3.2-11b-vision-preview",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": VISION_PROMPT},
                ],
            }],
            temperature=0.2,
            max_tokens=1200,
        )
        raw = resp.choices[0].message.content or ""
        raw = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            return None
        zones = json.loads(match.group())
        return [z for z in zones if all(k in z for k in ("label", "x", "y", "w", "h"))] or None
    except Exception as e:
        logger.warning(f"Vision model failed: {e}")
        return None


# ── Image processing (for non-PDF uploads) ────────────────────────────────────

def zones_for_image(
    image_bytes: bytes, img_w: int, img_h: int, checklist_text: Optional[str] = None
) -> List[Dict]:
    """
    Generate occlusion zones for a plain image file.
    1. Try Groq vision model (percentage coords → pixels)
    2. Fallback: Tesseract OCR word boxes + LLM term selection
    """
    # Gemini 1.5 Flash (best quality) → Groq fallback
    gemini_zones = _call_vision_gemini(image_bytes, img_w, img_h)
    if gemini_zones:
        return gemini_zones

    pct_zones = _call_vision_groq(image_bytes)
    if pct_zones:
        zones = []
        for z in pct_zones:
            px_w = z["w"] * img_w
            px_h = z["h"] * img_h
            if px_w > 5 and px_h > 5:
                zones.append({
                    "label": z["label"],
                    "x": round(z["x"] * img_w, 1),
                    "y": round(z["y"] * img_h, 1),
                    "width": round(px_w, 1),
                    "height": round(px_h, 1),
                })
        if zones:
            return zones

    # Tesseract fallback
    logger.info("Vision model skipped — using Tesseract OCR fallback for image")
    try:
        import io
        import pytesseract
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        words = []
        for i, text in enumerate(data["text"]):
            if text.strip() and int(data["conf"][i]) > 30:
                words.append({
                    "text": text.strip(),
                    "x": data["left"][i],
                    "y": data["top"][i],
                    "x1": data["left"][i] + data["width"][i],
                    "y1": data["top"][i] + data["height"][i],
                })

        if not words:
            return []

        all_text = " ".join(w["text"] for w in words)
        # Use first line as rough title
        min_y = min(w["y"] for w in words)
        title_words_set = {
            w["text"].lower() for w in words if w["y"] <= min_y + 30
        }
        body_text = " ".join(w["text"] for w in words if w["y"] > min_y + 30)
        title_str = " ".join(w["text"] for w in words if w["y"] <= min_y + 30)

        key_terms = _ask_llm_for_key_terms(body_text or all_text, title_str, checklist_text)
        key_terms = [t for t in key_terms if not _term_overlaps_title(t, title_words_set)]

        zones = []
        used: set = set()
        for term in key_terms:
            term_lower = term.lower()
            for i, w in enumerate(words):
                if i in used:
                    continue
                if term_lower in w["text"].lower() and w["y"] > min_y + 30:
                    zones.append({
                        "label": term,
                        "x": float(w["x"]),
                        "y": float(w["y"]),
                        "width": float(w["x1"] - w["x"]),
                        "height": float(w["y1"] - w["y"]),
                    })
                    used.add(i)
                    break
        return [z for z in zones if z["width"] > 3 and z["height"] > 3]

    except Exception as e:
        logger.warning(f"Tesseract fallback failed: {e}")
        return []


# ── Diagram detection (embedded images in PDF pages) ──────────────────────────

def diagram_cards_for_pdf_page(page) -> List[Dict]:
    """
    Detect embedded images (diagrams, charts, figures) on a PDF page.
    For each significant diagram, run the vision model to find occlusion zones.

    Returns a list of dicts:
        { image_bytes, ext, width (px), height (px), zones: [{label,x,y,width,height}] }
    Coordinates in zones are in pixel units of the extracted image (not the page).
    """
    try:
        img_info_list = page.get_image_info(hashes=False)
    except Exception:
        return []

    results = []
    seen_xrefs: set = set()

    for img_info in img_info_list:
        xref = img_info.get("xref", 0)
        if not xref or xref in seen_xrefs:
            continue

        bbox = img_info.get("bbox")
        if not bbox:
            continue

        img_w_pts = bbox[2] - bbox[0]
        img_h_pts = bbox[3] - bbox[1]

        # Skip tiny images — icons, logos, decorative elements
        if img_w_pts < 80 or img_h_pts < 80:
            continue

        try:
            doc = page.parent
            extracted = doc.extract_image(xref)
        except Exception:
            continue

        if not extracted:
            continue

        seen_xrefs.add(xref)

        image_bytes = extracted.get("image", b"")
        ext = extracted.get("ext", "png")
        diag_w = extracted.get("width", 800)
        diag_h = extracted.get("height", 600)

        if not image_bytes or diag_w < 80 or diag_h < 80:
            continue

        # Normalize extension to png/jpg — Anki handles these reliably
        if ext not in ("png", "jpg", "jpeg"):
            try:
                import io
                from PIL import Image as PILImage
                img_obj = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
                buf = io.BytesIO()
                img_obj.save(buf, format="PNG")
                image_bytes = buf.getvalue()
                ext = "png"
            except Exception:
                continue

        # Try Gemini first, then Groq
        zones = _call_vision_gemini(image_bytes, diag_w, diag_h)
        if not zones:
            pct_zones = _call_vision_groq(image_bytes)
            if pct_zones:
                zones = []
                for z in pct_zones:
                    pw = z["w"] * diag_w
                    ph = z["h"] * diag_h
                    if pw < 5 or ph < 5:
                        continue
                    zones.append({
                        "label": z["label"],
                        "x": round(z["x"] * diag_w, 1),
                        "y": round(z["y"] * diag_h, 1),
                        "width": round(pw, 1),
                        "height": round(ph, 1),
                    })

        if not zones:
            logger.info(f"No vision zones for diagram (xref={xref}) — skipping")
            continue

        results.append({
                "image_bytes": image_bytes,
                "ext": ext,
                "width": diag_w,
                "height": diag_h,
                "zones": zones,
            })

    return results
