"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch, API_URL } from "@/lib/api";
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
  { label: "Again", quality: 0, color: "text-red-500" },
  { label: "Hard", quality: 3, color: "text-orange-500" },
  { label: "Good", quality: 4, color: "text-blue-500" },
  { label: "Easy", quality: 5, color: "text-green-600" },
];

function OcclusionCard({
  card,
  revealedCount,
}: {
  card: Card;
  revealedCount: number;
}) {
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
    <div ref={containerRef} className="w-full max-w-lg">
      <div
        style={{ width: imgW * scale, height: imgH * scale, position: "relative" }}
        className="mx-auto"
      >
        <img
          src={`${API_URL}${card.image_path}`}
          alt="slide"
          style={{ width: imgW * scale, height: imgH * scale }}
          className="rounded-xl border"
        />
        {card.occlusion_zones.map((zone, i) => {
          const revealed = i < revealedCount;
          const active = i === revealedCount;

          if (revealed) {
            // Transparent — student sees the slide content underneath
            return <div key={zone.id} style={{ position: "absolute" }} />;
          }

          if (active) {
            // RED — this is the zone currently being tested
            return (
              <div
                key={zone.id}
                style={{
                  position: "absolute",
                  left: zone.x * scale,
                  top: zone.y * scale,
                  width: zone.width * scale,
                  height: zone.height * scale,
                  background: "#dc2626",
                  border: "2px solid #b91c1c",
                  borderRadius: 4,
                  boxShadow: "0 0 0 3px rgba(220,38,38,0.3)",
                }}
              />
            );
          }

          // Upcoming — solid dark blue, fully covered
          return (
            <div
              key={zone.id}
              style={{
                position: "absolute",
                left: zone.x * scale,
                top: zone.y * scale,
                width: zone.width * scale,
                height: zone.height * scale,
                background: "#1e3a5f",
                border: "2px solid #1e40af",
                borderRadius: 4,
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

  // For plain flashcards
  const [flipped, setFlipped] = useState(false);
  // For occlusion cards: how many zones have been revealed
  const [revealedCount, setRevealedCount] = useState(0);

  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (!deckId) {
      setError("No deck selected. Go back to your dashboard.");
      setLoading(false);
      return;
    }
    apiFetch(`/api/decks/${deckId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Deck not found");
        return res.json();
      })
      .then((data) => {
        setDeckName(data.name);
        setCards(data.cards);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [deckId]);

  const card = cards[index];
  const isOcclusion = card?.card_type === "occlusion";
  const totalZones = isOcclusion ? (card?.occlusion_zones?.length ?? 0) : 0;
  const allRevealed = isOcclusion ? revealedCount >= totalZones : flipped;

  // Spacebar handler
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (isOcclusion) {
        if (revealedCount < totalZones) {
          setRevealedCount((r) => r + 1);
        }
      } else {
        setFlipped((f) => !f);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOcclusion, revealedCount, totalZones]);

  function resetCard() {
    setFlipped(false);
    setRevealedCount(0);
    setReviewed(false);
  }

  function next() {
    resetCard();
    setIndex((i) => Math.min(i + 1, cards.length - 1));
  }

  function prev() {
    resetCard();
    setIndex((i) => Math.max(i - 1, 0));
  }

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
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading deck…</p>
      </main>
    );
  }

  if (error || cards.length === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted-foreground text-center">
          {error || "This deck has no cards yet."}
        </p>
        <Button onClick={() => router.push("/dashboard")}>Back to dashboard</Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-8 py-5 border-b">
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/dashboard")}
        >
          ← Dashboard
        </button>
        <span className="font-semibold truncate max-w-xs">{deckName}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {index + 1} / {cards.length}
        </span>
      </nav>

      <div className="flex flex-col items-center justify-center flex-1 gap-8 px-4 py-8">
        {/* Progress bar */}
        <div className="w-full max-w-lg h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((index + 1) / cards.length) * 100}%` }}
          />
        </div>

        {isOcclusion ? (
          <>
            <OcclusionCard card={card} revealedCount={revealedCount} />

            {!allRevealed ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {revealedCount === 0
                    ? `${totalZones} term${totalZones !== 1 ? "s" : ""} hidden — press Space to reveal`
                    : `${totalZones - revealedCount} remaining — press Space to reveal next`}
                </p>
                <Button variant="outline" onClick={() => setRevealedCount((r) => r + 1)}>
                  Reveal next
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">All terms revealed</p>
            )}
          </>
        ) : (
          <>
            <div
              className="w-full max-w-lg min-h-52 border rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer select-none transition-all hover:shadow-md gap-3"
              onClick={() => setFlipped((f) => !f)}
            >
              <span className="text-xs text-muted-foreground uppercase tracking-widest">
                {flipped ? "Answer" : "Question"}
              </span>
              <p className="text-lg font-medium leading-relaxed">
                {flipped ? card.back : card.front}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Press Space or click to flip
            </p>
          </>
        )}

        {/* SM-2 ratings — shown when all revealed */}
        {allRevealed && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
              How did it go?
            </p>
            <div className="flex gap-2">
              {RATINGS.map((r) => (
                <button
                  key={r.quality}
                  disabled={reviewed}
                  onClick={() => submitReview(r.quality)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-opacity ${r.color} ${
                    reviewed ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {reviewed && <p className="text-xs text-green-600">Saved!</p>}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={prev} disabled={index === 0}>
            Back
          </Button>
          <Button onClick={next} disabled={index === cards.length - 1}>
            Next
          </Button>
        </div>

        {index === cards.length - 1 && allRevealed && (
          <p className="text-sm text-muted-foreground">
            You&apos;ve reached the end!{" "}
            <button
              className="underline hover:text-foreground"
              onClick={() => {
                setIndex(0);
                resetCard();
              }}
            >
              Start over
            </button>
          </p>
        )}
      </div>
    </main>
  );
}

export default function StudyPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      }
    >
      <StudyContent />
    </Suspense>
  );
}
