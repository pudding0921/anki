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

KEY_TERMS_PROMPT = """You are building Anki IMAGE-OCCLUSION flashcards. Your job is to find every keyword, key phrase, or vocabulary term per bullet that a student must memorise. You will return each as a short string. Nothing else.

NEVER OCCLUDE THE SLIDE TITLE: {title}

══════════════════════════════════════════════════════
  THE FILL-IN-THE-BLANK TEST  (apply this to every term before returning it)
══════════════════════════════════════════════════════
Replace your chosen term with a blank in the original sentence.
Ask yourself: does the remaining text form a readable question that has exactly ONE missing answer?

  PASS ✓  "A ________ is a C++ construct that groups variables together."
           → you returned "struct" — student knows what to recall
  FAIL ✗  "________________________________________" (nothing left)
           → you returned the entire bullet — student sees nothing

If the remaining text is empty, meaningless, or less than 4 words, your term is TOO LONG. Shorten it.

══════════════════════════════════════════════════════
  ABSOLUTE HARD RULES
══════════════════════════════════════════════════════
R1. MAXIMUM 4 WORDS per term. Shorter is better, but multi-word key phrases are allowed.
R2. Your term MUST NOT be a full sentence or clause. Do NOT return terms containing ALL of:
      subject + verb + object together (that is a sentence, not a term).
      Avoid pure filler starts: "the a an that which does do not to of in and or but"
R3. Never return the slide title or any individual word from it.
R4. A specific verb that IS the vocabulary word is fine (e.g. "inhibits", "phosphorylates", "synthesizes"). Do NOT return generic verbs ("is", "uses", "creates", "includes").
R5. Return ONE term per key concept in each bullet. Aim for 3–8 terms total — cover ALL important vocabulary, not just one per bullet.
R6. NEVER return example variable names, parameter names, or constant names used as mere illustrations in code (e.g. MONDAY, TUESDAY, x, arr, i, Node, Day, myVar). These are placeholders — focus on the keyword, syntax element, or concept instead.

══════════════════════════════════════════════════════
  PATTERN GUIDE — how to handle every bullet type
══════════════════════════════════════════════════════

PATTERN 1 — "Term: full definition after the colon"
  Bullet:   "Structure: C++ construct that allows multiple variables to be grouped together"
  ✓ Return: "struct"           ← the term before the colon (or its canonical name)
  ✗ Never:  "C++ construct that allows multiple variables to be grouped together"
  ✗ Never:  "C++ construct"
  ✗ Never:  "grouped together"

PATTERN 2 — "Subject verb/does KEYWORD or has KEYWORD"
  Bullet:   "struct declaration does not allocate memory or create variables"
  ✓ Return: "memory"           ← the key noun that is the answer
  ✗ Never:  "struct declaration does not allocate memory or create variables"
  ✗ Never:  "does not allocate"
  ✗ Never:  "allocate memory"

PATTERN 3 — "To do X, use Y as Z"
  Bullet:   "To define variables, use structure tag as type name"
  ✓ Return: "structure tag"    ← the specific technique/term being taught
  ✗ Never:  "To define variables, use structure tag as type name"
  ✗ Never:  "use structure tag as type name"
  ✗ Never:  "type name"        (too vague)

PATTERN 4 — Code examples with enum / constant / variable names
  Bullet:   "enum Day {{ MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY }};"
  ✓ Return: "enum"             ← the language keyword being taught
  ✗ Never:  "MONDAY", "TUESDAY", "WEDNESDAY", "Day", etc.
  WHY: In CS/programming slides, the specific names used in examples (MONDAY, x, arr, Node)
       are just illustrative placeholders — a student does NOT need to recall them.
       Always hide the KEYWORD or SYNTAX ELEMENT, never the example names.

PATTERN 5 — "Items are called CONCEPT"
  Bullet:   "The identifiers MONDAY, TUESDAY are enumerators that represent values"
  ✓ Return: "enumerators"      ← the concept name being defined
  ✗ Never:  "MONDAY", "TUESDAY", "identifiers MONDAY"
  WHY: The example identifiers (MONDAY etc.) are not the answer — "enumerators" is.

PATTERN 6 — Medical / science "drug/gene MECHANISM"
  Bullet:   "metformin inhibits hepatic glucose production"
  ✓ Return: "metformin"        ← the specific agent
  ✗ Never:  "inhibits hepatic glucose production"
  ✗ Never:  "metformin inhibits"

PATTERN 7 — Threshold / value
  Bullet:   "HbA1c > 6.5% confirms a diagnosis of diabetes"
  ✓ Return: "HbA1c > 6.5%"    ← the specific value (this is short enough)
  ✗ Never:  "confirms a diagnosis of diabetes"

PATTERN 8 — Generic heading with no testable answer
  Bullet:   "General Format:"  or  "Example:"  or  "Note:"
  ✓ Return: nothing — skip this bullet entirely, it has no answer to hide

══════════════════════════════════════════════════════
  QUICK SELF-CHECK before returning each term
══════════════════════════════════════════════════════
  □ Is it 1–2 words?                                   must be YES
  □ Does it contain any word from the banned list R2?  must be NO
  □ If I blank it out, does a readable question remain? must be YES
  □ Is it specific and testable (not vague like "format" or "type")? must be YES
{checklist_section}
════ SLIDE BODY TEXT (title already removed) ════
{body_text}

Return ONLY a valid JSON array of short strings. No markdown, no explanation, no extra text:
["term1", "term2"]"""

CHECKLIST_SECTION = "\n━━ Study checklist — prioritize terms related to these topics ━━\n{checklist}\n"

VISION_PROMPT = (
    "You are building Anki image-occlusion flashcards from a slide image. "
    "Find 1–10 keywords and key phrases to hide. Cover ALL important vocabulary, terms, values, "
    "diagram labels, and named concepts. Even 1 box is better than none.\n\n"

    "PRIORITY — ALWAYS box these if present:\n"
    "  • Labels on anatomical diagrams, charts, or figures (e.g. 'aorta', 'mitral valve', 'axon')\n"
    "  • Text connected to a diagram by arrows or callout lines\n"
    "  • Numerical values, thresholds, percentages (e.g. 'HbA1c > 6.5%', '120/80 mmHg')\n"
    "  • Drug names, gene names, protein names, pathogen names\n"
    "  • Anatomical structure names, cell types, tissue types\n"
    "  • Medical/scientific terms that students must memorise\n\n"

    "FILL-IN-THE-BLANK TEST (for text bullets only):\n"
    "  Replace your chosen term with a blank. Does the rest of the sentence still form a readable question? "
    "If yes → good pick. If the sentence becomes empty → your box is too large.\n\n"

    "HARD RULES:\n"
    "  • 1–4 words per box — single words preferred, key phrases up to 4 words allowed\n"
    "  • NEVER cover the slide title / heading (largest text)\n"
    "  • NEVER cover a full sentence\n"
    "  • NEVER cover generic filler words (is, are, the, a, an, etc.)\n\n"

    "EXAMPLES:\n"
    "  Diagram label 'Left Ventricle' near heart → box over 'Left Ventricle'\n"
    "  Arrow pointing to structure labelled 'Purkinje fibers' → box 'Purkinje fibers'\n"
    "  Bullet 'metformin inhibits hepatic glucose production' → box 'metformin'\n"
    "  Bullet 'HbA1c > 6.5% confirms diabetes' → box 'HbA1c > 6.5%'\n"
    "  Bullet 'photosynthesis occurs in chloroplast' → box 'photosynthesis' AND 'chloroplast'\n\n"

    "Bounding box: fraction of image (0.0–1.0). x,y = top-left. w,h = size. "
    "Box must be TIGHT around the term only — not the whole line.\n"
    'Return ONLY valid JSON, no markdown:\n[{"label":"term","x":0.1,"y":0.2,"w":0.05,"h":0.03}]'
)

ANKIFLOW_VISION_PROMPT = """You are building Anki image-occlusion flashcards from a study slide image.
This slide may contain text bullets, anatomical diagrams, medical images, charts, or figures.

═══════════════════════════════════════════
STEP 1 — IDENTIFY THE TITLE (NEVER BOX THIS)
═══════════════════════════════════════════
The title is the largest or boldest text at the top. Record it as master_topic.
Do NOT place any occlusion box on the title or any word in it.

═══════════════════════════════════════════
STEP 2 — FIND EVERYTHING TO BOX (1–10 items)
═══════════════════════════════════════════
Box 1–10 terms. Even 1 zone is valuable. DO NOT return empty cards — find SOMETHING.

── PRIORITY 1: Diagram and Image Labels (always box these first) ──
If the slide contains any diagram, figure, anatomical image, chart, or photo:
  • Box EVERY visible label that names a structure, component, or part
  • Box ALL text connected to the image by arrows, lines, or callouts
  • Box text positioned next to or around the image that identifies parts
  • Box every anatomical structure name (e.g. "aorta", "mitral valve", "hippocampus")
  • Box every cell/tissue type label (e.g. "hepatocyte", "Purkinje fiber", "goblet cell")
  • Box every pathological finding name (e.g. "Mallory bodies", "Reed-Sternberg cells")
  • Box every numbered or lettered label that identifies diagram components
  CRITICAL: If there is a diagram, you MUST find at least 1 label. Look harder.

── PRIORITY 2: Medical/Science Key Terms ──
  • Drug names, drug classes, mechanisms of action
  • Gene names, protein names, enzyme names, receptor names
  • Disease names, syndrome names, pathogen names
  • Numerical thresholds and values (e.g. "HbA1c > 6.5%", "120/80 mmHg", "CD4 < 200")
  • Pathway names, process names

── PRIORITY 3: Text Bullet Keywords ──
  For each bullet point, apply the fill-in-the-blank test:
  Replace your chosen word with a blank — does a readable question remain?
    YES → box it.   NO (sentence becomes empty) → pick a shorter term.

EXAMPLES:
  Heart diagram with arrows → box "left ventricle", "aortic valve", "chordae tendineae"
  Brain diagram with labels → box "hippocampus", "amygdala", "corpus callosum"
  Pathology image with caption "Reed-Sternberg cells" → box "Reed-Sternberg cells"
  Bullet "metformin inhibits hepatic glucose production" → box "metformin"
  Bullet "HbA1c > 6.5% confirms diabetes" → box "HbA1c > 6.5%"
  Bullet "photosynthesis occurs in the chloroplast" → box "photosynthesis" AND "chloroplast"

NEVER box:
  • The slide title / main heading
  • Full sentences or clauses (more than 4 words that form a complete thought)
  • Pure filler: is, are, was, the, a, an, that, which, and, or, but
  • Code example variable/constant names used as mere illustrations (MONDAY, x, arr, i)

═══════════════════════════════════════════
STEP 3 — OUTPUT (strict JSON, no markdown)
═══════════════════════════════════════════
Bounding box: [ymin, xmin, ymax, xmax] on 0–1000 scale.
Box must be TIGHT around the keyword/label only.

{
  "master_topic": "slide title here",
  "cards": [
    {
      "type": "IMAGE_OCCLUSION",
      "occlusion_label": "exact term or label",
      "bounding_box": [ymin, xmin, ymax, xmax],
      "context_hint": "what this labels or means"
    }
  ]
}"""


DIAGRAM_VISION_PROMPT = """You are analyzing a medical or scientific diagram, figure, or image to build Anki image-occlusion flashcards.

YOUR ONLY JOB: Find every text label visible in or around this image and box it.

WHAT TO BOX — find ALL of these:
  1. Labels that name anatomical structures (e.g. "aorta", "left atrium", "Bowman's capsule")
  2. Text at the end of arrows or callout lines pointing to parts of the diagram
  3. Numbered or lettered labels that identify components (e.g. "1", "A" near a structure)
  4. Layer names, region names, zone names in the diagram
  5. Cell types, tissue types, organelle names
  6. Any pathological finding name or disease feature label
  7. Drug target names, receptor labels, enzyme names
  8. Any other text that identifies or names a visible structure

IMPORTANT:
  • You MUST find at least 1 box. If you see ANY label text, box it.
  • Each box covers 1–4 words maximum
  • Box the text label TIGHTLY — not the structure itself
  • Even single-letter or single-number labels are worth boxing if they identify a structure

OUTPUT — strict JSON only, no markdown:
{
  "master_topic": "what this diagram shows",
  "cards": [
    {
      "type": "IMAGE_OCCLUSION",
      "occlusion_label": "label text here",
      "bounding_box": [ymin, xmin, ymax, xmax],
      "context_hint": "what structure this labels"
    }
  ]
}
Bounding box: [ymin, xmin, ymax, xmax] on 0–1000 scale. Box tight around the text label."""


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


_FILLER_WORDS = {
    "is", "are", "was", "were", "be", "been", "being",
    "the", "a", "an", "of", "in", "by", "via", "with", "from",
    "that", "which", "this", "these", "those", "for", "and", "or",
    "can", "may", "will", "would", "could", "should",
    "such", "as", "e.g", "i.e", "etc", "also", "to", "at", "on",
    "include", "includes", "including",
}

_FILLER_VERBS = {
    "inhibits", "inhibit", "causes", "cause", "leads", "results",
    "affects", "increases", "decreases", "produces",
    "refers", "defined", "called", "known", "used", "found",
}

# Common English words used as illustrative example names in code/enum contexts.
# These are NEVER the concept a student needs to recall — block them at the code level
# regardless of what the LLM returns.
_EXAMPLE_IDENTIFIER_NAMES = {
    # Days of the week
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    # Months
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
    # Seasons / nature
    "spring", "summer", "fall", "autumn", "winter",
    # Cardinal directions
    "north", "south", "east", "west",
    # Colors
    "red", "green", "blue", "yellow", "orange", "purple", "pink",
    "white", "black", "brown", "gray", "grey", "cyan", "magenta",
    # Generic placeholder names
    "foo", "bar", "baz", "hello", "world", "example", "sample", "test", "demo",
    # Common enum illustrative values
    "up", "down", "left", "right",
    "small", "medium", "large", "tiny", "huge",
    "low", "high",
    "yes", "no",
    "open", "closed", "pending", "active", "inactive",
    "male", "female",
    "first", "second", "third",
    "alpha", "beta", "gamma", "delta",
    "start", "stop", "begin", "end",
    "on", "off",
    "plus", "minus",
    "circle", "square", "triangle", "rectangle",
}

# Any term containing one of these words is a sentence fragment — reject it
_SENTENCE_FRAGMENT_WORDS = {
    "is", "are", "was", "were", "be", "been", "being",
    "the", "a", "an",
    "that", "which", "who", "whom",
    "does", "do", "did", "not",
    "to", "of", "in", "on", "at", "by", "for", "with", "from",
    "and", "or", "but",
    "can", "will", "would", "could", "should", "may", "might",
    "this", "these", "those", "it", "its",
    "use", "uses", "used", "using",
    "allow", "allows", "allowed",
    "define", "defines", "defined",
    "create", "creates", "created",
    "include", "includes", "including",
    "refer", "refers", "referred",
    "allocate", "store", "stores", "stored",
    "group", "groups", "grouped",
}


def _term_overlaps_title(term: str, title_words: Set[str], title_str: str = "") -> bool:
    """True if the term overlaps significantly with the slide title."""
    if not title_words and not title_str:
        return False

    # Direct substring match (case-insensitive)
    if title_str and term.lower() in title_str.lower():
        return True

    term_words = [t.lower().strip(".,;:!?()'\"") for t in term.split() if len(t) > 1]
    if not term_words:
        return False

    # If majority of term words are title words, reject
    matching = sum(1 for w in term_words if w in title_words)
    return matching >= max(1, len(term_words) * 0.6)


def _post_filter_terms(terms: List[str], title_words: Set[str], title_str: str) -> List[str]:
    """Hard rules applied after LLM output to reject bad terms.
    Hard cap: 4 words maximum (allows multi-word medical/scientific key phrases)."""
    # Words that indicate the WHOLE term is a sentence fragment (not just connectors)
    _SENTENCE_STARTERS = {
        "is", "are", "was", "were", "be", "been", "being",
        "the", "a", "an",
        "that", "which", "who", "whom",
        "does", "do", "did", "not",
        "and", "or", "but",
        "can", "will", "would", "could", "should", "may", "might",
        "this", "these", "those", "it", "its",
        "use", "uses", "used", "using",
        "allow", "allows", "allowed",
        "define", "defines", "defined",
        "create", "creates", "created",
        "include", "includes", "including",
        "refer", "refers", "referred",
        "allocate", "store", "stores", "stored",
        "group", "groups", "grouped",
    }

    filtered = []
    for term in terms:
        words = term.split()
        clean_words = [w.lower().strip(".,;:!?()'\"[]{}") for w in words]

        # Hard cap: 4 words max
        if len(words) > 4:
            logger.info(f"Rejected (>4 words): {repr(term)}")
            continue

        # For 1-2 word terms: reject if ANY word is a sentence indicator
        # For 3-4 word terms: only reject if the FIRST word is a sentence indicator
        # (allows "loss of function", "type 2 diabetes", "hepatic glucose production")
        if len(words) <= 2:
            if any(w in _SENTENCE_STARTERS for w in clean_words):
                logger.info(f"Rejected (sentence word): {repr(term)}")
                continue
        else:
            if clean_words[0] in _SENTENCE_STARTERS:
                logger.info(f"Rejected (sentence starter): {repr(term)}")
                continue

        # Skip if it's entirely filler words
        if all(w in _FILLER_WORDS for w in clean_words):
            logger.info(f"Rejected (all filler): {repr(term)}")
            continue

        # Skip if it's just a single filler verb
        if len(clean_words) == 1 and clean_words[0] in _FILLER_VERBS:
            logger.info(f"Rejected (bare verb): {repr(term)}")
            continue

        # Reject all-caps single words that are common example identifier names
        # (e.g. MONDAY, TUESDAY, RED, FOO — these are illustrative placeholders in code)
        if (len(words) == 1 and
                term.isupper() and
                term.isalpha() and
                term.lower() in _EXAMPLE_IDENTIFIER_NAMES):
            logger.info(f"Rejected (example identifier): {repr(term)}")
            continue

        # Skip if it overlaps with the title
        if _term_overlaps_title(term, title_words, title_str):
            logger.info(f"Rejected (title overlap): {repr(term)}")
            continue

        # Skip very short terms
        if len(term.strip()) < 2:
            continue

        filtered.append(term)
    return filtered


# ── PDF processing (primary — most reliable) ──────────────────────────────────

def _call_groq_occlusion(prompt: str) -> Optional[str]:
    """Call Groq with a large, instruction-following model for occlusion term selection.
    Uses llama-3.3-70b-versatile instead of the shared 8b-instant model."""
    from app.core.config import settings
    if not settings.GROQ_API_KEY:
        return None
    try:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an Anki flashcard expert. "
                        "You follow instructions exactly and return only valid JSON arrays. "
                        "You return short keywords and key phrases (1–4 words) that students must memorise — never full sentences."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=300,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.warning(f"Groq 70b occlusion call failed: {e}")
        return None


def _ask_llm_for_key_terms(
    body_text: str,
    title: str,
    checklist_text: Optional[str] = None,
) -> List[str]:
    """Send slide body text (title stripped) to LLM, get back key terms."""
    from app.services.llm import _call_ollama

    checklist_section = (
        CHECKLIST_SECTION.format(checklist=checklist_text[:1500]) if checklist_text else ""
    )
    prompt = KEY_TERMS_PROMPT.format(
        title=title or "(no title detected)",
        body_text=body_text[:4000],
        checklist_section=checklist_section,
    )
    # Try Ollama (local) first, then Groq 70B (large, instruction-following)
    raw = _call_ollama(prompt) or _call_groq_occlusion(prompt)
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
        term_parts = term_lower.split()[:4]  # allow up to 4 words

        for i in range(len(body_words)):
            if i in used:
                continue
            word_text = body_words[i][4].lower().strip(".,;:!?()'\"[]{}")

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
                # Check each word in the sequence matches the corresponding term part
                seq_words = [w[4].lower().strip(".,;:!?()'\"[]{}") for w in seq]
                if all(tp in sw for tp, sw in zip(term_parts, seq_words)):
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
                # Only treat as all-caps if it's not a common example identifier name
                is_allcaps = (text.isupper() and len(text) > 3
                              and text.lower() not in _EXAMPLE_IDENTIFIER_NAMES)

                if is_bold or is_larger or is_allcaps:
                    text_words = text.split()
                    # Skip entire sentences — only cover short keywords/terms (≤3 words)
                    if len(text_words) > 3:
                        continue
                    label = text.strip()
                    if label.lower() in _FILLER_WORDS:
                        continue
                    # Skip all-caps example identifiers (enum values like MONDAY, FOO, etc.)
                    if (label.isupper() and label.isalpha()
                            and label.lower() in _EXAMPLE_IDENTIFIER_NAMES):
                        continue
                    zones.append({
                        "label": label,
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

        # ── Step 4: hard post-filter — word count, filler, title overlap ──────
        key_terms = _post_filter_terms(key_terms, title_word_set, title_str)

        if key_terms:
            zones = _match_terms_to_pdf_words(words, key_terms, scale, title_max_y)

    # ── Step 5: formatting fallback ───────────────────────────────────────────
    if not zones:
        logger.info("LLM gave no zones — using formatting fallback")
        zones = _formatting_fallback(page, scale, title_max_y)

    # ── Step 6: last resort — any non-trivial word in the body ────────────────
    # Ensures slides with ANY readable content are never completely skipped.
    # Picks the first 3 unique non-filler words from the body as zone candidates.
    if not zones and body_words:
        seen_labels: set = set()
        for w in body_words:
            text = w[4].strip(".,;:!?()\"'[]{}|")
            norm = text.lower()
            if (len(text) >= 3
                    and norm not in _FILLER_WORDS
                    and not norm.isnumeric()
                    and norm not in seen_labels):
                seen_labels.add(norm)
                zones.append({
                    "label": text,
                    "x": round(w[0] * scale, 1),
                    "y": round(w[1] * scale, 1),
                    "width": round((w[2] - w[0]) * scale, 1),
                    "height": round((w[3] - w[1]) * scale, 1),
                })
                if len(zones) >= 3:
                    break
        if zones:
            logger.info(f"Last-resort: created {len(zones)} zone(s) from raw body words")

    return zones


# ── Vision model (shared by images and diagrams) ─────────────────────────────

def _call_vision_gemini(
    image_bytes: bytes, img_w: int, img_h: int, prompt: str = ANKIFLOW_VISION_PROMPT
) -> Optional[List[Dict]]:
    """Ask Gemini 1.5 Flash to identify key terms using the given prompt.
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

        response = model.generate_content([prompt, img])
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
    Generate occlusion zones for a plain image file (rendered slide or standalone image).
    1. Gemini with slide prompt (best for text-heavy slides)
    2. Gemini with diagram prompt (best for anatomy/science images)
    3. Groq vision fallback
    4. Tesseract OCR + LLM term selection
    """
    # Gemini 1.5 Flash with slide prompt
    gemini_zones = _call_vision_gemini(image_bytes, img_w, img_h)
    if gemini_zones:
        return gemini_zones

    # Gemini retry with diagram-specific prompt (catches image-heavy/anatomy slides)
    gemini_diag_zones = _call_vision_gemini(image_bytes, img_w, img_h, prompt=DIAGRAM_VISION_PROMPT)
    if gemini_diag_zones:
        return gemini_diag_zones

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
        key_terms = _post_filter_terms(key_terms, title_words_set, title_str)

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

        valid = [z for z in zones if z["width"] > 3 and z["height"] > 3]
        if valid:
            return valid

        # Last resort: if LLM matched nothing, take any 3 non-filler body words directly
        seen_raw: set = set()
        raw_zones = []
        for w in words:
            if w["y"] <= min_y + 30:
                continue  # skip title row
            norm = w["text"].lower().strip(".,;:!?()'\"")
            if (len(norm) >= 3
                    and norm not in _FILLER_WORDS
                    and not norm.isnumeric()
                    and norm not in seen_raw
                    and w["x1"] - w["x"] > 3 and w["y1"] - w["y"] > 3):
                seen_raw.add(norm)
                raw_zones.append({
                    "label": w["text"].strip(".,;:!?()'\""),
                    "x": float(w["x"]),
                    "y": float(w["y"]),
                    "width": float(w["x1"] - w["x"]),
                    "height": float(w["y1"] - w["y"]),
                })
                if len(raw_zones) >= 3:
                    break
        return raw_zones

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

        # Try Gemini with diagram-specific prompt first (best for anatomy/science)
        zones = _call_vision_gemini(image_bytes, diag_w, diag_h, prompt=DIAGRAM_VISION_PROMPT)

        # Gemini fallback: try with the general slide prompt
        if not zones:
            zones = _call_vision_gemini(image_bytes, diag_w, diag_h)

        # Groq fallback
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

        # OCR last resort: if image has text labels, Tesseract will find them
        if not zones:
            try:
                import io
                import pytesseract
                from PIL import Image as _PILImg
                ocr_img = _PILImg.open(io.BytesIO(image_bytes))
                ocr_data = pytesseract.image_to_data(ocr_img, output_type=pytesseract.Output.DICT)
                for idx, text in enumerate(ocr_data["text"]):
                    if (text.strip() and len(text.strip()) >= 2
                            and int(ocr_data["conf"][idx]) > 40
                            and text.lower().strip(".,;:!?") not in _FILLER_WORDS):
                        x = ocr_data["left"][idx]
                        y = ocr_data["top"][idx]
                        w = ocr_data["width"][idx]
                        h = ocr_data["height"][idx]
                        if w > 3 and h > 3:
                            zones.append({
                                "label": text.strip(),
                                "x": float(x), "y": float(y),
                                "width": float(w), "height": float(h),
                            })
                    if len(zones) >= 8:
                        break
            except Exception as e:
                logger.debug(f"Diagram OCR fallback failed: {e}")

        if not zones:
            logger.info(f"No zones found for diagram (xref={xref}) — skipping")
            continue

        results.append({
                "image_bytes": image_bytes,
                "ext": ext,
                "width": diag_w,
                "height": diag_h,
                "zones": zones,
            })

    return results
