import hashlib
import os
import genanki
from typing import List
from app.models.models import Card

# Fixed model ID — must never change, or Anki creates duplicate note types on re-import
_MODEL_ID = 1607392319

# Fixed render width for occlusion cards in Anki (px).
# The height is derived from the image aspect ratio.
_RENDER_W = 500


def _deck_id(deck_name: str) -> int:
    """Deterministic deck ID so re-exports don't duplicate decks in Anki."""
    return int(hashlib.sha256(deck_name.encode()).hexdigest(), 16) % (1 << 31)


def _note_guid(*parts: str) -> str:
    """Deterministic GUID so re-exports don't create duplicate notes."""
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:10]


def _occlusion_html(
    img_filename: str,
    card_w: int,
    card_h: int,
    zones,
    active_idx: int,
    is_back: bool,
    label: str,
) -> str:
    """
    Build the HTML for one side of an occlusion Anki card.

    Front: image with active zone in RED, all others in dark blue.
    Back : image with active zone transparent (revealed), others still dark blue,
           plus the label text below.

    The image uses position:absolute inside a fixed-size container so Anki's
    default `img { max-width:100% }` CSS cannot shrink it and misalign overlays.
    The .ankiai-img class (defined in the model CSS) enforces the correct size.
    """
    scale = _RENDER_W / max(card_w, 1)
    render_h = int(card_h * scale)

    parts = [
        # Container has explicit pixel width AND height.
        # overflow:hidden clips any accidental overflow from rounding.
        f'<div style="position:relative;display:inline-block;'
        f'width:{_RENDER_W}px;height:{render_h}px;overflow:hidden;line-height:0;">',
        # Image is position:absolute so the container height drives layout, not the image.
        # .ankiai-img class sets max-width:none !important to defeat Anki's default CSS.
        f'<img src="{img_filename}" class="ankiai-img" '
        f'width="{_RENDER_W}" height="{render_h}" alt="slide">',
    ]

    for i, zone in enumerate(zones):
        # On the back side, leave the active zone transparent (revealed)
        if is_back and i == active_idx:
            continue

        x = zone.x * scale
        y = zone.y * scale
        w = zone.width * scale
        h = zone.height * scale

        if not is_back and i == active_idx:
            bg = "#dc2626"
            border = "2px solid #b91c1c"
        else:
            bg = "#1e3a5f"
            border = "2px solid #1e40af"

        parts.append(
            f'<div style="position:absolute;left:{x:.1f}px;top:{y:.1f}px;'
            f'width:{w:.1f}px;height:{h:.1f}px;'
            f'background:{bg};border:{border};border-radius:3px;"></div>'
        )

    parts.append("</div>")

    if is_back:
        parts.append(
            f'<p style="font-size:24px;font-weight:bold;margin-top:12px;">{label}</p>'
        )

    return "".join(parts)


_MODEL = genanki.Model(
    _MODEL_ID,
    "AnkiAI Basic",
    fields=[
        {"name": "Front"},
        {"name": "Back"},
    ],
    templates=[{
        "name": "Card 1",
        "qfmt": "{{Front}}",
        # Back field already contains the full revealed image + label,
        # so we don't use {{FrontSide}} to avoid doubling the image.
        "afmt": "{{Back}}",
    }],
    css=(
        ".card { font-family: sans-serif; font-size: 18px; text-align: center; "
        "background: #fff; padding: 10px; } "
        # Prevent Anki's default `img { max-width:100% }` from shrinking our occlusion
        # images — which would shift the overlay boxes off the wrong positions.
        ".ankiai-img { position:absolute !important; top:0 !important; left:0 !important; "
        "width:100% !important; height:100% !important; "
        "max-width:none !important; object-fit:fill !important; border-radius:6px; }"
    ),
)


def export_deck_to_apkg(
    deck_name: str,
    cards: List[Card],
    output_path: str,
    upload_root: str = "",
) -> str:
    """
    Export cards to .apkg.
    - Regular Q&A cards: exported as Front/Back text.
    - Occlusion cards: one Anki note per zone.
      Front = image with colored overlay boxes (red = active, blue = others).
      Back  = image with active zone revealed + label text.
    upload_root: absolute path to the backend directory (images live at {root}/uploads/...)
    """
    anki_deck = genanki.Deck(_deck_id(deck_name), deck_name)
    media_files: List[str] = []
    seen_media: set = set()

    for card in cards:
        if card.card_type == "occlusion":
            if not card.occlusion_zones:
                continue

            img_filename = ""
            img_w = card.image_width or 800
            img_h = card.image_height or 600

            if card.image_path:
                img_filename = os.path.basename(card.image_path)
                abs_img = os.path.join(upload_root, card.image_path.lstrip("/"))
                if os.path.exists(abs_img):
                    if abs_img not in seen_media:
                        media_files.append(abs_img)
                        seen_media.add(abs_img)
                else:
                    img_filename = ""  # image missing — fall back to text-only

            if not img_filename:
                # No image — produce simple text cards per zone
                for zone in card.occlusion_zones:
                    note = genanki.Note(
                        model=_MODEL,
                        fields=[
                            "<p>Recall: <b>____</b></p>",
                            f"<b style='font-size:24px'>{zone.label}</b>",
                        ],
                        guid=_note_guid(deck_name, str(card.id), str(zone.id)),
                    )
                    anki_deck.add_note(note)
                continue

            # One Anki note per zone — with rendered overlay boxes
            for i, zone in enumerate(card.occlusion_zones):
                front = _occlusion_html(
                    img_filename, img_w, img_h, card.occlusion_zones, i,
                    is_back=False, label=zone.label,
                )
                back = _occlusion_html(
                    img_filename, img_w, img_h, card.occlusion_zones, i,
                    is_back=True, label=zone.label,
                )
                note = genanki.Note(
                    model=_MODEL,
                    fields=[front, back],
                    guid=_note_guid(deck_name, str(card.id), str(zone.id)),
                )
                anki_deck.add_note(note)

        else:
            front = (card.front or "").strip()
            if not front:
                continue
            note = genanki.Note(
                model=_MODEL,
                fields=[front, card.back or ""],
                guid=_note_guid(deck_name, str(card.id)),
            )
            anki_deck.add_note(note)

    pkg = genanki.Package(anki_deck)
    pkg.media_files = media_files
    pkg.write_to_file(output_path)
    return output_path
