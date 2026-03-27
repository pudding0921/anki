"""
Storage cleanup: delete Supabase images for cards that were soft-deleted
more than 30 days ago.

Runs once at startup, then every 24 hours in the background.
Only touches image_path values that are Supabase public URLs — local paths
and null values are skipped safely.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_SUPABASE_URL_MARKER = "/storage/v1/object/public/"
_BATCH_SIZE = 100  # Supabase delete API handles up to 1000, keep conservative


def _extract_storage_path(image_url: str, bucket: str) -> str | None:
    """Extract the storage path (e.g. '42/uuid.png') from a full Supabase public URL."""
    marker = f"{_SUPABASE_URL_MARKER}{bucket}/"
    idx = image_url.find(marker)
    if idx == -1:
        return None
    return image_url[idx + len(marker):]


def run_cleanup() -> None:
    """Synchronous cleanup — called from the async wrapper below."""
    from app.core.config import settings
    from app.database import SessionLocal
    from app.models.models import Card
    from app.services.storage import delete_files
    from sqlalchemy import and_

    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        logger.info("Storage cleanup skipped — Supabase not configured")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    bucket = settings.SUPABASE_BUCKET
    total_deleted = 0

    with SessionLocal() as db:
        # Find soft-deleted cards whose images are old enough to purge
        candidates = (
            db.query(Card)
            .filter(
                and_(
                    Card.deleted_at.isnot(None),
                    Card.deleted_at < cutoff,
                    Card.image_path.isnot(None),
                )
            )
            .all()
        )

        if not candidates:
            logger.info("Storage cleanup: no eligible images found")
            return

        logger.info("Storage cleanup: %d candidate images to purge", len(candidates))

        # Process in batches
        for batch_start in range(0, len(candidates), _BATCH_SIZE):
            batch = candidates[batch_start: batch_start + _BATCH_SIZE]

            paths: list[str] = []
            card_ids: list[int] = []
            for card in batch:
                path = _extract_storage_path(card.image_path, bucket)
                if path:
                    paths.append(path)
                    card_ids.append(card.id)

            if not paths:
                continue

            deleted = delete_files(paths)
            if deleted:
                # Null out image_path so we don't retry failed deletes next run
                db.query(Card).filter(Card.id.in_(card_ids)).update(
                    {"image_path": None}, synchronize_session=False
                )
                db.commit()
                total_deleted += deleted
                logger.info("Storage cleanup: purged %d images (batch)", deleted)

    logger.info("Storage cleanup complete — %d images purged total", total_deleted)


async def run_cleanup_loop() -> None:
    """Background loop: run cleanup at startup then every 24 hours."""
    while True:
        try:
            await asyncio.get_running_loop().run_in_executor(None, run_cleanup)
        except Exception as exc:
            logger.error("Storage cleanup error: %s", exc)
        await asyncio.sleep(24 * 60 * 60)  # 24 hours
