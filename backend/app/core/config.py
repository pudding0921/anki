from pathlib import Path
from pydantic_settings import BaseSettings

# config.py lives at backend/app/core/config.py → parent × 3 = backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = str(_BACKEND_DIR / ".env")


class Settings(BaseSettings):
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days
    DATABASE_URL: str = f"sqlite:///{_BACKEND_DIR}/flowcard.db"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_MONTHLY: str = ""
    STRIPE_PRICE_BIANNUAL: str = ""
    FRONTEND_URL: str = "http://localhost:3000"

    # AI settings
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2"
    CARD_COUNT: int = 10

    # File storage (local fallback)
    UPLOAD_DIR: str = "uploads"

    # Supabase Storage (persistent image hosting)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_BUCKET: str = "card-images"

    # Admin
    ADMIN_SECRET: str = ""

    # Email (Resend)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "FlowCard <noreply@flowcard.pro>"
    CONTACT_RECIPIENT: str = "taexk2006@gmail.com"

    class Config:
        env_file = _ENV_FILE


settings = Settings()
