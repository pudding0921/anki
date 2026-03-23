"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

interface TrashFolder {
  id: number;
  name: string;
  deleted_at: string;
  days_remaining: number;
}

interface TrashDeck {
  id: number;
  name: string;
  description: string;
  card_count: number;
  deleted_at: string;
  days_remaining: number;
}

interface TrashCard {
  id: number;
  deck_id: number;
  deck_name: string;
  card_type: string;
  front: string;
  back: string;
  deleted_at: string;
  days_remaining: number;
}

interface TrashData {
  folders: TrashFolder[];
  decks: TrashDeck[];
  cards: TrashCard[];
}

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored: () => void;
}

function DaysTag({ days }: { days: number }) {
  const color =
    days <= 3
      ? "text-red-400 bg-red-500/10"
      : days <= 7
      ? "text-orange-400 bg-orange-500/10"
      : "text-muted-foreground bg-muted";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>
      {days}d left
    </span>
  );
}

export function TrashModal({ isOpen, onClose, onRestored }: TrashModalProps) {
  const [data, setData] = useState<TrashData | null>(null);
  const [loading, setLoading] = useState(false);
  const [emptying, setEmptying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    apiFetch("/api/trash")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const totalItems =
    (data?.folders.length ?? 0) +
    (data?.decks.length ?? 0) +
    (data?.cards.length ?? 0);

  async function restore(type: "folder" | "deck" | "card", id: number) {
    await apiFetch(`/api/trash/restore/${type}/${id}`, { method: "POST" });
    setData((prev) => {
      if (!prev) return prev;
      return {
        folders: type === "folder" ? prev.folders.filter((f) => f.id !== id) : prev.folders,
        decks: type === "deck" ? prev.decks.filter((d) => d.id !== id) : prev.decks,
        cards: type === "card" ? prev.cards.filter((c) => c.id !== id) : prev.cards,
      };
    });
    onRestored();
  }

  async function deleteForever(type: "folder" | "deck" | "card", id: number) {
    await apiFetch(`/api/trash/${type}/${id}`, { method: "DELETE" });
    setData((prev) => {
      if (!prev) return prev;
      return {
        folders: type === "folder" ? prev.folders.filter((f) => f.id !== id) : prev.folders,
        decks: type === "deck" ? prev.decks.filter((d) => d.id !== id) : prev.decks,
        cards: type === "card" ? prev.cards.filter((c) => c.id !== id) : prev.cards,
      };
    });
  }

  async function emptyTrash() {
    setEmptying(true);
    await apiFetch("/api/trash/empty", { method: "DELETE" });
    setData({ folders: [], decks: [], cards: [] });
    setEmptying(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col mx-4 max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🗑️</span>
            <h2 className="font-semibold text-base">Trash</h2>
            {!loading && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {totalItems} item{totalItems !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalItems > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={emptyTrash}
                disabled={emptying}
              >
                {emptying ? "Emptying…" : "Empty Trash"}
              </Button>
            )}
            <button
              className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none p-1"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-6">
          {loading && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading…
            </p>
          )}

          {!loading && totalItems === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="text-4xl">✨</span>
              <p className="text-sm text-muted-foreground">
                Trash is empty. Items are permanently deleted after 30 days.
              </p>
            </div>
          )}

          {!loading && data && data.folders.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Folders
              </h3>
              {data.folders.map((f) => (
                <TrashRow
                  key={`folder-${f.id}`}
                  name={f.name}
                  subtitle="Folder"
                  daysRemaining={f.days_remaining}
                  onRestore={() => restore("folder", f.id)}
                  onDeleteForever={() => deleteForever("folder", f.id)}
                />
              ))}
            </section>
          )}

          {!loading && data && data.decks.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Decks
              </h3>
              {data.decks.map((d) => (
                <TrashRow
                  key={`deck-${d.id}`}
                  name={d.name}
                  subtitle={`${d.card_count} card${d.card_count !== 1 ? "s" : ""}`}
                  daysRemaining={d.days_remaining}
                  onRestore={() => restore("deck", d.id)}
                  onDeleteForever={() => deleteForever("deck", d.id)}
                />
              ))}
            </section>
          )}

          {!loading && data && data.cards.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Cards
              </h3>
              {data.cards.map((c) => (
                <TrashRow
                  key={`card-${c.id}`}
                  name={c.front || "(Image Occlusion)"}
                  subtitle={`From deck: ${c.deck_name}`}
                  daysRemaining={c.days_remaining}
                  onRestore={() => restore("card", c.id)}
                  onDeleteForever={() => deleteForever("card", c.id)}
                />
              ))}
            </section>
          )}
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 border-t border-border shrink-0">
          <p className="text-xs text-muted-foreground text-center">
            Items in Trash are permanently deleted after 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}

function TrashRow({
  name,
  subtitle,
  daysRemaining,
  onRestore,
  onDeleteForever,
}: {
  name: string;
  subtitle: string;
  daysRemaining: number;
  onRestore: () => void;
  onDeleteForever: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <DaysTag days={daysRemaining} />
      <div className="flex gap-1.5 shrink-0">
        <Button variant="outline" size="sm" onClick={onRestore}>
          Restore
        </Button>
        <Button variant="destructive" size="sm" onClick={onDeleteForever}>
          Delete Forever
        </Button>
      </div>
    </div>
  );
}
