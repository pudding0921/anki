"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface Zone {
  id: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Card {
  id: number;
  card_type: string;
  front: string;
  back: string;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  occlusion_zones: Zone[];
}

interface Deck {
  id: number;
  name: string;
  cards: Card[];
}

// ── Text card editor ──────────────────────────────────────────────────────────

function TextCardEditor({
  card,
  onDelete,
}: {
  card: Card;
  onDelete: (id: number) => void;
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await apiFetch(`/api/cards/${card.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front, back }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const dirty = front !== card.front || back !== card.back;

  return (
    <div className="border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Flashcard
        </span>
        <button
          className="text-xs text-red-400 hover:text-red-600"
          onClick={() => onDelete(card.id)}
        >
          Delete card
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Question</label>
        <textarea
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          rows={2}
          value={front}
          onChange={(e) => setFront(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Answer</label>
        <textarea
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          rows={2}
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
      </div>

      {dirty && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-xs text-green-600">Saved!</span>}
        </div>
      )}
    </div>
  );
}

// ── Occlusion card editor ─────────────────────────────────────────────────────

function OcclusionCardEditor({
  card,
  onDelete,
  onZoneDeleted,
}: {
  card: Card;
  onDelete: (id: number) => void;
  onZoneDeleted: (cardId: number, zoneId: number) => void;
}) {
  const [zones, setZones] = useState(card.occlusion_zones);

  async function deleteZone(zoneId: number) {
    await apiFetch(`/api/cards/zones/${zoneId}`, { method: "DELETE" });
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    onZoneDeleted(card.id, zoneId);
  }

  const imgW = card.image_width ?? 800;
  const imgH = card.image_height ?? 600;

  return (
    <div className="border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Image Occlusion
        </span>
        <button
          className="text-xs text-red-400 hover:text-red-600"
          onClick={() => onDelete(card.id)}
        >
          Delete card
        </button>
      </div>

      {card.image_path ? (
        <>
          <p className="text-xs text-muted-foreground">
            Click any highlighted zone to remove it.
          </p>
          <div className="relative w-full rounded-lg border overflow-hidden">
            <img
              src={`${API_URL}${card.image_path}`}
              alt="slide"
              className="block w-full h-auto"
            />
            <svg
              viewBox={`0 0 ${imgW} ${imgH}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              {zones.map((zone) => (
                <g
                  key={zone.id}
                  className="group cursor-pointer"
                  onClick={() => deleteZone(zone.id)}
                >
                  <rect
                    x={zone.x}
                    y={zone.y}
                    width={zone.width}
                    height={zone.height}
                    fill="rgba(30,58,95,0.55)"
                    stroke="#1e40af"
                    strokeWidth="2"
                    className="group-hover:fill-red-500/60 group-hover:stroke-red-600 transition-colors"
                    rx="3"
                  />
                  <text
                    x={zone.x + zone.width / 2}
                    y={zone.y + zone.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize={Math.max(10, Math.min(16, zone.height * 0.45))}
                    fontWeight="bold"
                    className="pointer-events-none select-none"
                  >
                    {zone.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          {zones.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No zones remaining</p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Occlusion zones — remove any that cover irrelevant terms
          </span>
          {zones.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No zones remaining</p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {zones.map((zone) => (
                <div
                  key={zone.id}
                  className="flex items-center gap-1 border rounded-full px-3 py-1 text-sm bg-muted/40"
                >
                  <span>{zone.label}</span>
                  <button
                    className="text-red-400 hover:text-red-600 ml-1 font-bold leading-none"
                    title="Remove this zone"
                    onClick={() => deleteZone(zone.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function EditContent() {
  useAuthGuard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = searchParams.get("deckId");

  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deckId) { setError("No deck selected."); setLoading(false); return; }
    apiFetch(`/api/decks/${deckId}`)
      .then((r) => { if (!r.ok) throw new Error("Deck not found"); return r.json(); })
      .then(setDeck)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [deckId]);

  async function deleteCard(cardId: number) {
    await apiFetch(`/api/cards/${cardId}`, { method: "DELETE" });
    setDeck((prev) =>
      prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : prev
    );
  }

  function handleZoneDeleted(cardId: number, zoneId: number) {
    setDeck((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === cardId
            ? { ...c, occlusion_zones: c.occlusion_zones.filter((z) => z.id !== zoneId) }
            : c
        ),
      };
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  if (error || !deck) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{error || "Deck not found"}</p>
        <Button onClick={() => router.push("/dashboard")}>Back to dashboard</Button>
      </main>
    );
  }

  const textCards = deck.cards.filter((c) => c.card_type !== "occlusion");
  const occlusionCards = deck.cards.filter((c) => c.card_type === "occlusion");

  return (
    <main className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-8 py-5 border-b">
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/dashboard")}
        >
          ← Dashboard
        </button>
        <span className="font-semibold truncate max-w-xs">Edit: {deck.name}</span>
        <span className="text-sm text-muted-foreground">
          {deck.cards.length} card{deck.cards.length !== 1 ? "s" : ""}
        </span>
      </nav>

      <div className="max-w-2xl mx-auto px-8 py-10 flex flex-col gap-8">
        {deck.cards.length === 0 && (
          <p className="text-muted-foreground text-center py-16">No cards in this deck.</p>
        )}

        {occlusionCards.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="font-semibold text-lg">
              Image Occlusion cards
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — remove zones that cover irrelevant terms
              </span>
            </h2>
            {occlusionCards.map((card) => (
              <OcclusionCardEditor
                key={card.id}
                card={card}
                onDelete={deleteCard}
                onZoneDeleted={handleZoneDeleted}
              />
            ))}
          </section>
        )}

        {textCards.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="font-semibold text-lg">Flashcards</h2>
            {textCards.map((card) => (
              <TextCardEditor key={card.id} card={card} onDelete={deleteCard} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

export default function EditPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <EditContent />
    </Suspense>
  );
}
