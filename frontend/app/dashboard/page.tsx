"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiFetch, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface Deck {
  id: number;
  name: string;
  description: string;
  card_count: number;
  created_at: string;
}

interface PendingDelete {
  deck: Deck;
  timerId: ReturnType<typeof setTimeout>;
}

export default function DashboardPage() {
  useAuthGuard();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  pendingDeleteRef.current = pendingDelete;

  // Cancel any pending delete if the user navigates away
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId);
      }
    };
  }, []);

  useEffect(() => {
    apiFetch("/api/decks")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load decks");
        return res.json();
      })
      .then(setDecks)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function deleteDeck(deck: Deck) {
    // Cancel any prior pending delete immediately (commit it now)
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timerId);
      apiFetch(`/api/decks/${pendingDeleteRef.current.deck.id}`, { method: "DELETE" });
      setPendingDelete(null);
    }

    // Optimistically remove from list
    setDecks((prev) => prev.filter((d) => d.id !== deck.id));

    // Commit delete after 5 s unless user clicks Undo
    const timerId = setTimeout(async () => {
      await apiFetch(`/api/decks/${deck.id}`, { method: "DELETE" });
      setPendingDelete(null);
    }, 5000);

    setPendingDelete({ deck, timerId });
  }

  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timerId);
    // Restore deck to list, sorted by id so position is stable
    setDecks((prev) =>
      [...prev, pendingDelete.deck].sort((a, b) => a.id - b.id)
    );
    setPendingDelete(null);
  }

  function exportDeck(id: number, name: string) {
    const token = localStorage.getItem("token");
    const url = `${API_URL}/api/decks/${id}/export`;
    const a = document.createElement("a");
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = `${name}.apkg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      });
  }

  return (
    <main className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-8 py-5 border-b">
        <span className="text-xl font-bold tracking-tight">AnkiAI</span>
        <div className="flex gap-3">
          <Link href="/create" className={buttonVariants({})}>
            New deck
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              localStorage.removeItem("token");
              window.location.href = "/login";
            }}
          >
            Log out
          </Button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold mb-8">My Decks</h1>

        {loading && (
          <p className="text-muted-foreground text-sm">Loading your decks…</p>
        )}

        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {!loading && !error && decks.length === 0 && !pendingDelete && (
          <div className="border border-dashed rounded-xl p-16 flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">No decks yet.</p>
            <Link href="/create" className={buttonVariants({})}>
              Create your first deck
            </Link>
          </div>
        )}

        {decks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="border rounded-xl p-6 flex flex-col gap-3 hover:shadow-sm transition-shadow"
              >
                <div>
                  <h3 className="font-semibold text-lg">{deck.name}</h3>
                  {deck.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {deck.description}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {deck.card_count} card{deck.card_count !== 1 ? "s" : ""}
                </p>
                <div className="flex gap-2 mt-auto pt-2 flex-wrap">
                  <Link
                    href={`/study?deckId=${deck.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    Study
                  </Link>
                  <Link
                    href={`/edit?deckId=${deck.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Edit cards
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportDeck(deck.id, deck.name)}
                  >
                    Export .apkg
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteDeck(deck)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-xl z-50 whitespace-nowrap">
          <span className="text-sm">
            &ldquo;{pendingDelete.deck.name}&rdquo; will be deleted
          </span>
          <button
            className="text-sm font-semibold text-yellow-400 hover:text-yellow-300 transition-colors"
            onClick={undoDelete}
          >
            Undo
          </button>
        </div>
      )}
    </main>
  );
}
