import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import auth, cards, decks, health
from app.api import study, export as export_router
from app.api import folders as folders_router
from app.api import trash as trash_router
from app.core.config import settings
from app.database import Base, engine, SessionLocal

# Absolute path to the uploads directory — never depends on CWD.
# main.py lives at backend/app/main.py → parent × 2 = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ABS_UPLOAD_DIR = str(_BACKEND_DIR / settings.UPLOAD_DIR)


def _migrate_db():
    """Add columns that may be missing on older databases. Safe to run on every boot."""
    from app.database import engine as _engine
    is_pg = not settings.DATABASE_URL.startswith("sqlite")

    # These are idempotent ALTER TABLE statements.
    # PostgreSQL raises DuplicateColumn (caught below); SQLite raises OperationalError.
    migrations = [
        "ALTER TABLE cards ADD COLUMN image_width INTEGER",
        "ALTER TABLE cards ADD COLUMN image_height INTEGER",
        "ALTER TABLE cards ADD COLUMN sm2_interval INTEGER DEFAULT 1",
        "ALTER TABLE cards ADD COLUMN sm2_repetitions INTEGER DEFAULT 0",
        "ALTER TABLE cards ADD COLUMN sm2_ease_factor REAL DEFAULT 2.5",
        "ALTER TABLE cards ADD COLUMN sm2_due_date TIMESTAMP",
        "ALTER TABLE decks ADD COLUMN folder_id INTEGER REFERENCES folders(id)",
        "ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMP",
        "ALTER TABLE decks ADD COLUMN deleted_at TIMESTAMP",
        "ALTER TABLE cards ADD COLUMN deleted_at TIMESTAMP",
    ]
    with SessionLocal() as session:
        for sql in migrations:
            try:
                session.execute(text(sql))
                session.commit()
            except Exception:
                session.rollback()  # required for PostgreSQL after any error


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    os.makedirs(_ABS_UPLOAD_DIR, exist_ok=True)
    _migrate_db()
    yield


app = FastAPI(title="FlowCard", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "https://flowcard.pages.dev"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded images
app.mount("/uploads", StaticFiles(directory=_ABS_UPLOAD_DIR), name="uploads")

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(decks.router, prefix="/api")
app.include_router(cards.router, prefix="/api")
app.include_router(folders_router.router, prefix="/api")
app.include_router(trash_router.router, prefix="/api")
app.include_router(study.router)
app.include_router(export_router.router)
