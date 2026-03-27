import logging
import requests
from app.core.config import settings

logger = logging.getLogger(__name__)


def upload_file(file_bytes: bytes, storage_path: str, content_type: str = "image/png") -> str | None:
    """Upload a file to Supabase Storage. Returns the public URL or None if not configured / failed."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        return None

    bucket = settings.SUPABASE_BUCKET
    url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{storage_path}"

    try:
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=file_bytes,
            timeout=30,
        )
        if response.status_code in (200, 201, 204):
            return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{storage_path}"
        logger.warning("Supabase upload failed (%s): %s", response.status_code, response.text[:200])
        return None
    except Exception as exc:
        logger.warning("Supabase upload error: %s", exc)
        return None


def delete_files(storage_paths: list[str]) -> int:
    """Delete a batch of files from Supabase Storage by their storage paths.
    Returns the number of files successfully deleted."""
    if not storage_paths or not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        return 0

    bucket = settings.SUPABASE_BUCKET
    url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}"

    try:
        response = requests.delete(
            url,
            headers={
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
            },
            json={"prefixes": storage_paths},
            timeout=30,
        )
        if response.status_code in (200, 204):
            return len(storage_paths)
        logger.warning("Supabase batch delete failed (%s): %s", response.status_code, response.text[:200])
        return 0
    except Exception as exc:
        logger.warning("Supabase delete error: %s", exc)
        return 0
