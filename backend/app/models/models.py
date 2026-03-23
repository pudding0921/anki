from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Stripe subscription
    stripe_customer_id = Column(String, nullable=True)
    subscription_status = Column(String, default="free")   # free | active | canceled
    subscription_plan = Column(String, nullable=True)       # monthly | biannual
    subscription_end = Column(DateTime, nullable=True)

    decks = relationship("Deck", back_populates="owner", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="user", cascade="all, delete-orphan")
    folders = relationship("Folder", back_populates="owner", cascade="all, delete-orphan")


class Folder(Base):
    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    deleted_at = Column(DateTime, nullable=True, default=None)

    owner = relationship("User", back_populates="folders")
    decks = relationship("Deck", back_populates="folder")


class Deck(Base):
    __tablename__ = "decks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    deleted_at = Column(DateTime, nullable=True, default=None)

    owner = relationship("User", back_populates="decks")
    folder = relationship("Folder", back_populates="decks")
    cards = relationship("Card", back_populates="deck", cascade="all, delete-orphan")


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    deck_id = Column(Integer, ForeignKey("decks.id"), nullable=False)
    card_type = Column(String, default="text")  # "text" | "occlusion"
    front = Column(Text, default="")
    back = Column(Text, default="")
    image_path = Column(String, nullable=True)
    image_width = Column(Integer, nullable=True)
    image_height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    deleted_at = Column(DateTime, nullable=True, default=None)

    # SM-2 spaced repetition
    sm2_interval = Column(Integer, default=1)
    sm2_repetitions = Column(Integer, default=0)
    sm2_ease_factor = Column(Float, default=2.5)
    sm2_due_date = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    deck = relationship("Deck", back_populates="cards")
    occlusion_zones = relationship("OcclusionZone", back_populates="card", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="card", cascade="all, delete-orphan")


class OcclusionZone(Base):
    __tablename__ = "occlusion_zones"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    label = Column(String, default="")
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)

    card = relationship("Card", back_populates="occlusion_zones")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    quality = Column(Integer, nullable=False)  # 0=Again 3=Hard 4=Good 5=Easy
    reviewed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    card = relationship("Card", back_populates="reviews")
    user = relationship("User", back_populates="reviews")


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    used_by_email = Column(String, nullable=True)
    used_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    read = Column(Boolean, default=False)
