import json
import logging
import re
from typing import Optional

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = """You are an expert study assistant and flashcard creator.

Given the following text from study material, generate exactly {count} flashcard question-answer pairs.

Rules:
- Questions should test understanding, not just keyword recall
- Answers must be concise (1-3 sentences)
- Cover the most important concepts
- Return ONLY a valid JSON array — no markdown, no explanation

Required format:
[
  {{"question": "What is...?", "answer": "..."}},
  {{"question": "How does...?", "answer": "..."}}
]

Study material:
{text}"""


def _parse_cards(raw: str) -> list[dict]:
    """Extract and parse a JSON card array from raw LLM output."""
    # Strip markdown code fences
    raw = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()

    # Find the first JSON array in the response
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        logger.warning("No JSON array found in LLM response")
        return []
    try:
        cards = json.loads(match.group())
        valid = [c for c in cards if "question" in c and "answer" in c]
        return valid
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error: {e}")
        return []


def _call_ollama(prompt: str) -> Optional[str]:
    """Call local Ollama instance. Returns None if unreachable."""
    try:
        resp = requests.post(
            f"{settings.OLLAMA_URL}/api/generate",
            json={"model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=90,
        )
        resp.raise_for_status()
        return resp.json().get("response", "")
    except requests.exceptions.ConnectionError:
        logger.info("Ollama not reachable — falling back to Groq")
        return None
    except requests.exceptions.Timeout:
        logger.warning("Ollama timed out — falling back to Groq")
        return None
    except Exception as e:
        logger.warning(f"Ollama error: {e}")
        return None


def _call_groq(prompt: str) -> Optional[str]:
    """Call Groq API (free tier). Returns None if key missing or call fails."""
    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — cannot use Groq fallback")
        return None
    try:
        from groq import Groq

        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a flashcard generation expert. "
                        "Always return only a valid JSON array. No markdown, no explanation."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        return response.choices[0].message.content
    except ImportError:
        logger.warning("groq package not installed")
        return None
    except Exception as e:
        logger.warning(f"Groq error: {e}")
        return None


def generate_flashcards(text: str, count: Optional[int] = None) -> list[dict]:
    """
    Generate flashcards from text.
    Priority: Ollama (local, free) → Groq (free tier fallback).
    Returns a list of {question, answer} dicts.
    """
    count = count or settings.CARD_COUNT

    # Handle empty or near-empty text gracefully
    if not text or len(text.strip()) < 20:
        text = (
            "No readable text was extracted. "
            "Generate 5 general study tips about effective learning as placeholder cards."
        )
        count = min(count, 5)

    # Scale card count with text volume for multi-page PDFs
    # ~500 chars per page → 2 cards per page, capped at 50
    estimated_pages = max(1, len(text) // 500)
    auto_count = min(max(count, estimated_pages * 2), 50)

    # Cap text to avoid token limits (~12000 chars ≈ 3000 tokens)
    prompt = PROMPT_TEMPLATE.format(count=auto_count, text=text[:12000])

    # 1. Try Ollama first
    raw = _call_ollama(prompt)
    if raw:
        cards = _parse_cards(raw)
        if cards:
            logger.info(f"Generated {len(cards)} cards via Ollama")
            return cards

    # 2. Fall back to Groq
    raw = _call_groq(prompt)
    if raw:
        cards = _parse_cards(raw)
        if cards:
            logger.info(f"Generated {len(cards)} cards via Groq")
            return cards

    logger.error("All LLM providers failed or returned no valid cards")
    return []
