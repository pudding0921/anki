from datetime import datetime, timedelta, timezone
from app.models.models import Card


def apply_sm2(card: Card, quality: int) -> Card:
    """
    Apply SM-2 algorithm to a card given a quality rating.
    quality: 0=Again, 3=Hard, 4=Good, 5=Easy
    """
    ef = card.sm2_ease_factor
    n = card.sm2_repetitions
    interval = card.sm2_interval

    if quality < 3:
        # Failed — reset
        n = 0
        interval = 1
    else:
        if n == 0:
            interval = 1
        elif n == 1:
            interval = 6
        else:
            interval = max(1, round(interval * ef))

        ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        ef = max(1.3, ef)
        n += 1

    card.sm2_interval = interval
    card.sm2_repetitions = n
    card.sm2_ease_factor = round(ef, 4)
    card.sm2_due_date = datetime.now(timezone.utc) + timedelta(days=interval)

    return card
