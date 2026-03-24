"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiFetch, imgUrl } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface OcclusionZone {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

interface Card {
  id: number;
  card_type: string;
  front: string;
  back: string;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  occlusion_zones: OcclusionZone[];
}

const RATINGS = [
  { label: "Again", quality: 0, bg: "bg-red-500/15 hover:bg-red-500/25 text-red-400 border-red-500/20", dot: "bg-red-400" },
  { label: "Hard", quality: 3, bg: "bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 border-orange-500/20", dot: "bg-orange-400" },
  { label: "Good", quality: 4, bg: "bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border-blue-500/20", dot: "bg-blue-400" },
  { label: "Easy", quality: 5, bg: "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
];

function OcclusionCard({ card, revealedCount }: { card: Card; revealedCount: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const imgW = card.image_width ?? 800;
  const imgH = card.image_height ?? 600;

  useEffect(() => {
    function update() {
      if (containerRef.current) {
        const available = containerRef.current.clientWidth;
        setScale(Math.min(1, available / imgW));
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [imgW]);

  return (
    <div ref={containerRef} className="w-full max-w-2xl">
      <div style={{ width: imgW * scale, height: imgH * scale, position: "relative" }} className="mx-auto rounded-2xl overflow-hidden shadow-2xl">
        <img
          src={imgUrl(card.image_path)}
          alt="slide"
          style={{ width: imgW * scale, height: imgH * scale }}
          className="block"
        />
        {card.occlusion_zones.map((zone, i) => {
          const revealed = i < revealedCount;
          const active = i === revealedCount;
          // Revealed = transparent (student sees the answer underneath)
          if (revealed) return (
            <div
              key={zone.id}
              style={{
                position: "absolute",
                left: zone.x * scale,
                top: zone.y * scale,
                width: zone.width * scale,
                height: zone.height * scale,
                background: "rgba(134,239,172,0.15)",
                border: "2px solid rgba(134,239,172,0.4)",
                borderRadius: 6,
              }}
            />
          );
          // Active = the zone currently being tested — muted indigo
          if (active) {
            return (
              <div
                key={zone.id}
                style={{
                  position: "absolute",
                  left: zone.x * scale,
                  top: zone.y * scale,
                  width: zone.width * scale,
                  height: zone.height * scale,
                  background: "#4f52a0",
                  border: "2px solid #6366a8",
                  borderRadius: 6,
                  boxShadow: "0 0 0 2px rgba(99,102,180,0.25), 0 4px 12px rgba(99,102,180,0.3)",
                }}
              />
            );
          }
          // Upcoming = fully opaque muted dark box
          return (
            <div
              key={zone.id}
              style={{
                position: "absolute",
                left: zone.x * scale,
                top: zone.y * scale,
                width: zone.width * scale,
                height: zone.height * scale,
                background: "#2a2840",
                border: "2px solid #3d3a60",
                borderRadius: 6,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function StudyContent() {
  useAuthGuard();
  const searchParams = useSearchParams();
  const router = useRouter();
  const deckId = searchParams.get("deckId");

  const [cards, setCards] = useState<Card[]>([]);
  const [deckName, setDeckName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (!deckId) { setError("No deck selected."); setLoading(false); return; }
    apiFetch(`/api/decks/${deckId}`)
      .then((res) => { if (!res.ok) throw new Error("Deck not found"); return res.json(); })
      .then((data) => { setDeckName(data.name); setCards(data.cards); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [deckId]);

  const card = cards[index];
  const isOcclusion = card?.card_type === "occlusion";
  const totalZones = isOcclusion ? (card?.occlusion_zones?.length ?? 0) : 0;
  const allRevealed = isOcclusion ? revealedCount >= totalZones : flipped;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (isOcclusion) {
          if (revealedCount < totalZones) setRevealedCount((r) => r + 1);
        } else {
          setFlipped((f) => !f);
        }
        return;
      }

      // Arrow keys and WASD for navigation
      if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        if (index < cards.length - 1) { resetCard(); setIndex((i) => i + 1); }
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        if (index > 0) { resetCard(); setIndex((i) => i - 1); }
        return;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOcclusion, revealedCount, totalZones, index, cards.length]);

  function resetCard() { setFlipped(false); setRevealedCount(0); setReviewed(false); }
  function next() { resetCard(); setIndex((i) => Math.min(i + 1, cards.length - 1)); }
  function prev() { resetCard(); setIndex((i) => Math.max(i - 1, 0)); }

  async function submitReview(quality: number) {
    setReviewed(true);
    await apiFetch("/api/study/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: card.id, quality }),
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading deck…</p>
        </div>
      </main>
    );
  }

  if (error || cards.length === 0) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground text-center">{error || "This deck has no cards yet."}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm font-medium"
        >
          Back to dashboard
        </button>
      </main>
    );
  }

  const progress = ((index + 1) / cards.length) * 100;

  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="glass border-b border-border/60 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <button
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => router.push("/dashboard")}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          Dashboard
        </button>
        <span className="font-semibold text-sm truncate max-w-xs">{deckName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums font-medium">
            {index + 1} <span className="text-muted-foreground/40">/</span> {cards.length}
          </span>
        </div>
      </nav>

      {/* Progress bar */}
      <div className="h-0.5 bg-muted w-full">
        <div
          className="h-full bg-gradient-to-r from-indigo-400/80 to-violet-400/80 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-col items-center justify-center flex-1 gap-8 px-4 py-10">
        {/* Occlusion card */}
        {isOcclusion ? (
          <>
            <OcclusionCard card={card} revealedCount={revealedCount} />

            {!allRevealed ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {revealedCount === 0
                    ? `${totalZones} term${totalZones !== 1 ? "s" : ""} hidden`
                    : `${totalZones - revealedCount} term${totalZones - revealedCount !== 1 ? "s" : ""} remaining`}
                  {" · Space to reveal · ← → to navigate"}
                </p>
                <button
                  onClick={() => setRevealedCount((r) => r + 1)}
                  className="px-5 py-2 rounded-xl border border-indigo-400/20 bg-indigo-400/8 text-indigo-300 hover:bg-indigo-400/15 text-sm font-medium transition-colors"
                >
                  Reveal next
                </button>
              </div>
            ) : (
              <p className="text-xs text-emerald-400 font-medium">✓ All terms revealed</p>
            )}
          </>
        ) : (
          /* Text flashcard */
          <>
            <div
              className="w-full max-w-lg cursor-pointer select-none"
              onClick={() => setFlipped((f) => !f)}
            >
              <div className={`relative min-h-52 glass rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300 hover:border-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/10 ${flipped ? "border-emerald-500/20" : ""}`}>
                <span className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-4 ${flipped ? "text-emerald-400" : "text-indigo-400"}`}>
                  {flipped ? "Answer" : "Question"}
                </span>
                <p className="text-lg font-medium leading-relaxed">
                  {flipped ? card.back : card.front}
                </p>
                {!flipped && (
                  <p className="text-xs text-muted-foreground/50 mt-6">Space to flip · ← → to navigate</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Rating buttons */}
        {allRevealed && (
          <div className="flex flex-col items-center gap-4 w-full max-w-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              How did it go?
            </p>
            <div className="grid grid-cols-4 gap-2 w-full">
              {RATINGS.map((r) => (
                <button
                  key={r.quality}
                  disabled={reviewed}
                  onClick={() => submitReview(r.quality)}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-sm font-semibold transition-all ${r.bg} ${
                    reviewed ? "opacity-40 cursor-not-allowed" : "hover:scale-105 active:scale-95"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${r.dot}`} />
                  {r.label}
                </button>
              ))}
            </div>
            {reviewed && (
              <p className="text-xs text-emerald-400 font-medium">Saved ✓</p>
            )}
          </div>
        )}

        {/* Nav buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={prev}
            disabled={index === 0}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          {index === cards.length - 1 && allRevealed ? (
            <button
              onClick={() => { setIndex(0); resetCard(); }}
              className="px-4 py-2 rounded-xl gradient-btn text-sm font-semibold"
            >
              Start over
            </button>
          ) : (
            <button
              onClick={next}
              disabled={index === cards.length - 1}
              className="px-4 py-2 rounded-xl gradient-btn text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          )}
        </div>

        {index === cards.length - 1 && allRevealed && (
          <p className="text-sm text-muted-foreground text-center">
            🎉 You&apos;ve reached the end of the deck!
          </p>
        )}
      </div>
    </main>
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    }>
      <StudyContent />
    </Suspense>
  );
}
