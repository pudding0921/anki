"use client";

import { Suspense, useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch, imgUrl } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";
import OcclusionEditor, { Zone as EditorZone } from "@/components/OcclusionEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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

interface TextCardHandle {
  save: () => Promise<void>;
  isDirty: () => boolean;
}

const TextCardEditor = forwardRef<TextCardHandle, { card: Card; onDelete: (id: number) => void }>(
  function TextCardEditor({ card, onDelete }, ref) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const frontRef = useRef(front);
  const backRef = useRef(back);
  frontRef.current = front;
  backRef.current = back;

  useImperativeHandle(ref, () => ({
    isDirty: () => frontRef.current !== card.front || backRef.current !== card.back,
    save: async () => {
      if (frontRef.current === card.front && backRef.current === card.back) return;
      setSaving(true);
      await apiFetch(`/api/cards/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: frontRef.current, back: backRef.current }),
      });
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  }));

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
          {saved && <span className="text-xs text-emerald-400">Saved!</span>}
        </div>
      )}
    </div>
  );
});

// ── Occlusion card editor ─────────────────────────────────────────────────────

function OcclusionCardEditor({
  card,
  onDelete,
}: {
  card: Card;
  onDelete: (id: number) => void;
}) {
  const [saved, setSaved] = useState(false);

  const imgW = card.image_width ?? 800;
  const imgH = card.image_height ?? 600;

  const initialZones: EditorZone[] = card.occlusion_zones.map((z) => ({
    id: String(z.id),
    x: z.x,
    y: z.y,
    width: z.width,
    height: z.height,
    label: z.label,
  }));

  async function handleSave(zones: EditorZone[]) {
    await apiFetch(`/api/cards/${card.id}/zones`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zones: zones.map((z) => ({
          label: z.label,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
        })),
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!card.image_path) return null;

  return (
    <div className="border rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Image Occlusion
        </span>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-emerald-400">Saved!</span>}
          <button
            className="text-xs text-red-400 hover:text-red-600"
            onClick={() => onDelete(card.id)}
          >
            Delete card
          </button>
        </div>
      </div>

      <OcclusionEditor
        imageUrl={imgUrl(card.image_path)}
        imageWidth={imgW}
        imageHeight={imgH}
        initialZones={initialZones}
        saveLabel="Save zones"
        onSave={handleSave}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface EditConfirmState {
  isOpen: boolean;
  cardId: number;
  cardFront: string;
}

function EditContent() {
  useAuthGuard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deckId = searchParams.get("deckId");

  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exiting, setExiting] = useState(false);
  const [confirmState, setConfirmState] = useState<EditConfirmState>({
    isOpen: false,
    cardId: 0,
    cardFront: "",
  });

  const textCardRefs = useRef<Map<number, TextCardHandle>>(new Map());

  useEffect(() => {
    if (!deckId) { setError("No deck selected."); setLoading(false); return; }
    apiFetch(`/api/decks/${deckId}`)
      .then((r) => { if (!r.ok) throw new Error("Deck not found"); return r.json(); })
      .then(setDeck)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [deckId]);

  function requestDeleteCard(cardId: number) {
    const card = deck?.cards.find((c) => c.id === cardId);
    setConfirmState({
      isOpen: true,
      cardId,
      cardFront: card?.front || "(Image Occlusion)",
    });
  }

  async function confirmDeleteCard() {
    const cardId = confirmState.cardId;
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
    await apiFetch(`/api/cards/${cardId}`, { method: "DELETE" });
    textCardRefs.current.delete(cardId);
    setDeck((prev) =>
      prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : prev
    );
  }

  async function saveAndExit() {
    setExiting(true);
    const saves = Array.from(textCardRefs.current.values()).map((ref) => ref.save());
    await Promise.all(saves);
    router.push("/dashboard");
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
      <nav className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b flex items-center justify-between px-8 py-4">
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/dashboard")}
        >
          ← Dashboard
        </button>
        <span className="font-semibold truncate max-w-xs">Edit: {deck.name}</span>
        <Button size="sm" onClick={saveAndExit} disabled={exiting}>
          {exiting ? "Saving…" : "Save & Exit"}
        </Button>
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
                — drag to add zones, click to select, resize or delete
              </span>
            </h2>
            {occlusionCards.map((card) => (
              <OcclusionCardEditor
                key={card.id}
                card={card}
                onDelete={requestDeleteCard}
              />
            ))}
          </section>
        )}

        {textCards.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="font-semibold text-lg">Flashcards</h2>
            {textCards.map((card) => (
              <TextCardEditor
                key={card.id}
                ref={(el) => {
                  if (el) textCardRefs.current.set(card.id, el);
                  else textCardRefs.current.delete(card.id);
                }}
                card={card}
                onDelete={requestDeleteCard}
              />
            ))}
          </section>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        itemType="card"
        itemName={confirmState.cardFront}
        onConfirm={confirmDeleteCard}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
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
