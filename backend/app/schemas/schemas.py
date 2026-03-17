from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr


# --- Auth ---

class UserRegister(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


# --- AI Generation ---

class CardGenerated(BaseModel):
    question: str
    answer: str


class GenerateCardsResponse(BaseModel):
    cards: List[CardGenerated]
    ocr_text: str
    image_path: Optional[str] = None


# --- Occlusion ---

class OcclusionZoneCreate(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str


class OcclusionZoneOut(BaseModel):
    id: int
    x: float
    y: float
    width: float
    height: float
    label: str

    model_config = {"from_attributes": True}


class OcclusionCardCreate(BaseModel):
    deck_name: str
    image_path: str
    image_width: int
    image_height: int
    zones: List[OcclusionZoneCreate]


# --- Cards ---

class CardCreate(BaseModel):
    question: str
    answer: str


class CardOut(BaseModel):
    id: int
    deck_id: int
    card_type: str
    front: str
    back: str
    image_path: Optional[str]
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    created_at: datetime
    occlusion_zones: List[OcclusionZoneOut] = []
    sm2_interval: int = 1
    sm2_repetitions: int = 0
    sm2_ease_factor: float = 2.5
    sm2_due_date: Optional[datetime] = None

    model_config = {"from_attributes": True}


# --- Decks ---

class DeckCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    cards: List[CardCreate] = []


class DeckOut(BaseModel):
    id: int
    name: str
    description: str
    user_id: int
    created_at: datetime
    card_count: int = 0

    model_config = {"from_attributes": True}


class DeckWithCards(BaseModel):
    id: int
    name: str
    description: str
    user_id: int
    created_at: datetime
    cards: List[CardOut] = []

    model_config = {"from_attributes": True}


# --- SM-2 Study ---

class ReviewCreate(BaseModel):
    card_id: int
    quality: int  # 0=Again, 3=Hard, 4=Good, 5=Easy


class ReviewOut(BaseModel):
    card_id: int
    next_due: datetime
    interval: int
