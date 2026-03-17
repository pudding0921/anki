import io
import logging
from typing import List

logger = logging.getLogger(__name__)


def extract_text_from_image(image_bytes: bytes) -> str:
    """Extract text from image bytes using Tesseract OCR."""
    try:
        import pytesseract
        from PIL import Image

        image = Image.open(io.BytesIO(image_bytes))
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        text = pytesseract.image_to_string(image, config="--psm 6")
        cleaned = text.strip()
        logger.info(f"OCR extracted {len(cleaned)} chars from image")
        return cleaned
    except ImportError:
        logger.warning("pytesseract/Pillow not installed — OCR skipped")
        return ""
    except Exception as e:
        logger.warning(f"OCR failed: {e}")
        return ""


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """
    Extract text from all pages of a PDF using PyMuPDF.
    Prefers embedded text (fast, perfect for text-based PDFs like lecture slides).
    Falls back to OCR if a page has no embedded text.
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages_text: List[str] = []

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if text:
                pages_text.append(f"[Page {page_num}]\n{text}")
                logger.info(f"PDF page {page_num}: extracted {len(text)} chars (text)")
            else:
                # Page has no embedded text — render and OCR
                mat = fitz.Matrix(2, 2)  # 2x scale for better OCR quality
                pix = page.get_pixmap(matrix=mat)
                img_bytes = pix.tobytes("png")
                ocr_text = extract_text_from_image(img_bytes)
                if ocr_text:
                    pages_text.append(f"[Page {page_num}]\n{ocr_text}")
                    logger.info(f"PDF page {page_num}: OCR extracted {len(ocr_text)} chars")
                else:
                    logger.info(f"PDF page {page_num}: no text found")

        doc.close()
        return "\n\n".join(pages_text)

    except ImportError:
        logger.warning("PyMuPDF not installed — install with: pip install PyMuPDF")
        return ""
    except Exception as e:
        logger.warning(f"PDF extraction failed: {e}")
        return ""


def extract_text(file_bytes: bytes, filename: str = "") -> str:
    """
    Route to the correct extractor based on file type.
    Supports PDF and image files (PNG, JPG, WEBP, etc.).
    """
    fname = filename.lower()
    if fname.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)
    return extract_text_from_image(file_bytes)
