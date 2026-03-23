"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { apiFetch, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TrashModal } from "@/components/TrashModal";
import { TutorialModal } from "@/components/TutorialModal";

interface Folder {
  id: number;
  name: string;
  deck_count: number;
}

interface Deck {
  id: number;
  name: string;
  description: string;
  card_count: number;
  created_at: string;
  folder_id: number | null;
}

interface PendingDelete {
  deck: Deck;
  timerId: ReturnType<typeof setTimeout>;
}

interface ConfirmState {
  isOpen: boolean;
  itemType: "deck" | "folder" | "card";
  itemName: string;
  onConfirm: () => void;
}

// Rotating accent colors for deck cards
const DECK_ACCENTS = [
  "from-indigo-400/70 to-blue-400/70",
  "from-violet-400/70 to-purple-400/70",
  "from-emerald-400/70 to-teal-400/70",
  "from-amber-400/70 to-orange-400/70",
  "from-rose-400/70 to-pink-400/70",
  "from-cyan-400/70 to-sky-400/70",
];

function getAccent(id: number) {
  return DECK_ACCENTS[id % DECK_ACCENTS.length];
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

function IconFolder({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconChevronRight({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconPencil({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function IconMove({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

function IconPlus({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconDownload({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ── Deck card ────────────────────────────────────────────────────────────────

interface DeckCardProps {
  deck: Deck;
  folders: Folder[];
  onDelete: (deck: Deck) => void;
  onMove: (deckId: number, folderId: number | null) => void;
  onExport: (id: number, name: string) => void;
}

function DeckCard({ deck, folders, onDelete, onMove, onExport }: DeckCardProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);
  const accent = getAccent(deck.id);

  useEffect(() => {
    if (!moveOpen) return;
    function handleClick(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moveOpen]);

  const dateStr = new Date(deck.created_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div className="group relative bg-card border border-border rounded-2xl card-hover flex flex-col">
      {/* Colored top accent bar — rounded-t-2xl so it clips to card corners without overflow-hidden */}
      <div className={`h-1 w-full bg-gradient-to-r ${accent} opacity-80 rounded-t-2xl`} />

      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-sm leading-snug">{deck.name}</h3>
          {deck.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{deck.description}</p>
          )}
        </div>

        <div className="flex items-center gap-3 mt-auto">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{deck.card_count}</span>{" "}
            card{deck.card_count !== 1 ? "s" : ""}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">{dateStr}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 flex-wrap items-center pt-1 border-t border-border">
          <Link
            href={`/study?deckId=${deck.id}`}
            className="flex-1 min-w-0 text-center text-xs font-semibold px-3 py-1.5 rounded-lg gradient-btn transition-all"
          >
            Study
          </Link>
          <Link
            href={`/edit?deckId=${deck.id}`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Edit
          </Link>
          <button
            className="text-xs font-medium px-2 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
            onClick={() => onExport(deck.id, deck.name)}
            title="Export to Anki"
          >
            <IconDownload className="w-3.5 h-3.5" />
          </button>

          {/* Move dropdown */}
          <div className="relative" ref={moveRef}>
            <button
              className="text-xs font-medium px-2 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
              onClick={() => setMoveOpen((v) => !v)}
              title="Move to folder"
            >
              <IconMove className="w-3.5 h-3.5" />
            </button>
            {moveOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 min-w-[160px] glass rounded-xl shadow-2xl py-1.5 text-sm">
                {folders.length === 0 && (
                  <p className="px-3 py-2 text-muted-foreground text-xs">No folders yet</p>
                )}
                {folders.map((f) => (
                  <button
                    key={f.id}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/80 transition-colors flex items-center gap-2 text-xs ${
                      deck.folder_id === f.id ? "text-indigo-400 font-semibold" : ""
                    }`}
                    onClick={() => { onMove(deck.id, f.id); setMoveOpen(false); }}
                  >
                    <IconFolder className="w-3 h-3 shrink-0" />
                    {f.name}
                  </button>
                ))}
                {deck.folder_id !== null && (
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-muted/80 transition-colors text-muted-foreground text-xs border-t border-border mt-1 pt-2"
                    onClick={() => { onMove(deck.id, null); setMoveOpen(false); }}
                  >
                    Remove from folder
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            className="ml-auto text-xs px-2 py-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={() => onDelete(deck)}
            title="Delete deck"
          >
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Folder row ───────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: Folder;
  decks: Deck[];
  allFolders: Folder[];
  onRename: (folderId: number, newName: string) => void;
  onDelete: (folderId: number) => void;
  onDeckDelete: (deck: Deck) => void;
  onDeckMove: (deckId: number, folderId: number | null) => void;
  onExport: (id: number, name: string) => void;
}

function FolderRow({ folder, decks, allFolders, onRename, onDelete, onDeckDelete, onDeckMove, onExport }: FolderRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== folder.name) onRename(folder.id, trimmed);
    else setDraftName(folder.name);
    setEditing(false);
  }

  return (
    <div className="rounded-2xl border border-border">
      {/* Header — overflow-hidden here clips the bg to rounded corners */}
      <div
        className={`overflow-hidden flex items-center gap-3 px-5 py-3.5 bg-card/80 hover:bg-muted/30 transition-colors cursor-pointer select-none rounded-t-2xl ${!expanded ? "rounded-b-2xl" : ""}`}
        onClick={() => !editing && setExpanded((v) => !v)}
      >
        <IconChevronRight
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center shrink-0">
          <IconFolder className="w-3.5 h-3.5 text-indigo-400" />
        </div>

        {editing ? (
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-b border-indigo-500 outline-none text-sm font-medium py-0.5"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraftName(folder.name); setEditing(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 text-sm font-semibold truncate"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {folder.name}
          </span>
        )}

        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 shrink-0">
          {decks.length} deck{decks.length !== 1 ? "s" : ""}
        </span>

        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
            title="Rename"
          >
            <IconPencil className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400"
            onClick={() => onDelete(folder.id)}
            title="Delete folder"
          >
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Deck grid */}
      {expanded && (
        <div className="px-5 pb-5 pt-4 bg-background/50 rounded-b-2xl">
          {decks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No decks yet — move a deck here using the move button.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {decks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  folders={allFolders}
                  onDelete={onDeckDelete}
                  onMove={onDeckMove}
                  onExport={onExport}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  useAuthGuard();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  pendingDeleteRef.current = pendingDelete;

  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false, itemType: "deck", itemName: "", onConfirm: () => {},
  });
  const [trashOpen, setTrashOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => () => { if (pendingDeleteRef.current) clearTimeout(pendingDeleteRef.current.timerId); }, []);
  useEffect(() => { if (creatingFolder) newFolderInputRef.current?.focus(); }, [creatingFolder]);

  // Auto-show tutorial for first-time users
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("flowcard_tutorial_done")) {
      setTutorialOpen(true);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/decks").then((r) => (r.ok ? r.json() : Promise.reject("decks"))),
      apiFetch("/api/folders").then((r) => (r.ok ? r.json() : Promise.reject("folders"))),
    ])
      .then(([d, f]) => { setDecks(d); setFolders(f); })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function askConfirm(itemType: "deck" | "folder" | "card", itemName: string, onConfirm: () => void) {
    setConfirmState({ isOpen: true, itemType, itemName, onConfirm });
  }
  function closeConfirm() { setConfirmState((prev) => ({ ...prev, isOpen: false })); }

  // ── Deck actions ─────────────────────────────────────────────────────────────

  function deleteDeck(deck: Deck) {
    askConfirm("deck", deck.name, () => {
      closeConfirm();
      setDecks((prev) => prev.filter((d) => d.id !== deck.id));
      apiFetch(`/api/decks/${deck.id}`, { method: "DELETE" });
    });
  }

  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timerId);
    setDecks((prev) => [...prev, pendingDelete.deck].sort((a, b) => a.id - b.id));
    setPendingDelete(null);
  }

  function exportDeck(id: number, name: string) {
    const token = localStorage.getItem("token");
    fetch(`${API_URL}/api/decks/${id}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${name}.apkg`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
      });
  }

  function moveDeck(deckId: number, folderId: number | null) {
    setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, folder_id: folderId } : d)));
    setFolders((prev) => {
      const deck = decks.find((d) => d.id === deckId);
      return prev.map((f) => {
        let count = f.deck_count;
        if (deck?.folder_id === f.id) count -= 1;
        if (folderId === f.id) count += 1;
        return { ...f, deck_count: count };
      });
    });
    apiFetch(`/api/folders/decks/${deckId}/move`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
  }

  // ── Folder actions ───────────────────────────────────────────────────────────

  function commitNewFolder() {
    const name = newFolderName.trim() || "Untitled folder";
    setCreatingFolder(false);
    setNewFolderName("");
    apiFetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((f: Folder) => setFolders((prev) => [...prev, f]));
  }

  function renameFolder(folderId: number, newName: string) {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f)));
    apiFetch(`/api/folders/${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
  }

  function deleteFolder(folderId: number) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    askConfirm("folder", folder.name, () => {
      closeConfirm();
      setDecks((prev) => prev.map((d) => (d.folder_id === folderId ? { ...d, folder_id: null } : d)));
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      apiFetch(`/api/folders/${folderId}`, { method: "DELETE" });
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const unfiledDecks = decks.filter((d) => d.folder_id === null);
  const totalCards = decks.reduce((sum, d) => sum + d.card_count, 0);
  const isEmpty = !loading && !error && decks.length === 0 && folders.length === 0 && !pendingDelete;

  return (
    <main className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-20 glass border-b border-border/60">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-sm shadow-indigo-400/20">
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-lg font-bold gradient-brand">FlowCard</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreatingFolder(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <IconFolder className="w-3.5 h-3.5" />
              New Folder
            </button>
            <Link
              href="/create"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg gradient-btn shadow-sm"
            >
              <IconPlus className="w-3.5 h-3.5" />
              New Deck
            </Link>
            <button
              onClick={() => setTutorialOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="How to use FlowCard"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Tour
            </button>
            <button
              onClick={() => setTrashOpen(true)}
              className="text-xs font-medium px-3 py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Trash"
            >
              <IconTrash className="w-4 h-4" />
            </button>
            <button
              className="text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors text-muted-foreground"
              onClick={() => setConfirm({
                isOpen: true,
                itemType: "subscription",
                itemName: "subscription",
                onConfirm: async () => {
                  const token = localStorage.getItem("token");
                  await fetch(`${API_URL}/api/stripe/cancel`, {
                    method: "POST",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                  });
                  localStorage.removeItem("token");
                  window.location.href = "/?subscription=canceled";
                },
              })}
            >
              Cancel subscription
            </button>
            <button
              className="text-xs font-medium px-3 py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              onClick={() => { localStorage.removeItem("token"); window.location.href = "/login"; }}
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats bar */}
        {!loading && !error && (decks.length > 0 || folders.length > 0) && (
          <div className="flex items-center gap-6 mb-8 p-4 glass rounded-2xl">
            <div className="flex flex-col">
              <span className="text-2xl font-bold">{decks.length}</span>
              <span className="text-xs text-muted-foreground">Decks</span>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="flex flex-col">
              <span className="text-2xl font-bold">{totalCards}</span>
              <span className="text-xs text-muted-foreground">Cards</span>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="flex flex-col">
              <span className="text-2xl font-bold">{folders.length}</span>
              <span className="text-xs text-muted-foreground">Folders</span>
            </div>
            <div className="ml-auto flex gap-2">
              <Link href="/create/occlusion" className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                Image Occlusion
              </Link>
              <Link href="/create" className="text-xs font-semibold px-3 py-1.5 rounded-lg gradient-btn">
                AI Flashcards
              </Link>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading your library…</p>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* New folder inline input */}
        {creatingFolder && (
          <div className="mb-6 flex items-center gap-3 glass border border-indigo-400/20 rounded-xl px-4 py-3">
            <div className="w-5 h-5 rounded-md bg-indigo-400/15 border border-indigo-400/20 flex items-center justify-center">
              <IconFolder className="w-3 h-3 text-indigo-400" />
            </div>
            <input
              ref={newFolderInputRef}
              className="flex-1 bg-transparent outline-none text-sm"
              placeholder="Folder name…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={commitNewFolder}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewFolder();
                if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
              }}
            />
            <span className="text-xs text-muted-foreground">Enter to save · Esc to cancel</span>
          </div>
        )}

        {/* ── Empty state ── */}
        {isEmpty && (
          <div className="flex flex-col items-center gap-12 py-20">
            <div className="text-center flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold">Your library is empty</h2>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
                Upload lecture slides or notes and let AI generate flashcards in seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
              <Link
                href="/create/occlusion"
                className="group glass rounded-2xl p-6 flex flex-col gap-3 hover:border-indigo-400/25 hover:bg-indigo-400/4 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border border-indigo-500/20 flex items-center justify-center">
                  <span className="text-xl">🖼️</span>
                </div>
                <div>
                  <p className="font-semibold text-sm">Image Occlusion</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Upload slides — AI blanks out key terms for recall.
                  </p>
                </div>
                <span className="text-xs text-indigo-400 font-medium group-hover:underline mt-auto">
                  Upload slides →
                </span>
              </Link>

              <Link
                href="/create"
                className="group glass rounded-2xl p-6 flex flex-col gap-3 hover:border-violet-400/25 hover:bg-violet-400/4 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20 flex items-center justify-center">
                  <span className="text-xl">⚡</span>
                </div>
                <div>
                  <p className="font-semibold text-sm">AI Flashcards</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Upload notes and get Q&A cards generated instantly.
                  </p>
                </div>
                <span className="text-xs text-violet-400 font-medium group-hover:underline mt-auto">
                  Generate cards →
                </span>
              </Link>
            </div>
          </div>
        )}

        {/* ── Folders ── */}
        {!loading && !error && folders.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-1">
              Folders
            </h2>
            <div className="flex flex-col gap-3">
              {folders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  decks={decks.filter((d) => d.folder_id === folder.id)}
                  allFolders={folders}
                  onRename={renameFolder}
                  onDelete={deleteFolder}
                  onDeckDelete={deleteDeck}
                  onDeckMove={moveDeck}
                  onExport={exportDeck}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Unfiled decks ── */}
        {!loading && !error && unfiledDecks.length > 0 && (
          <section>
            {folders.length > 0 && (
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-1">
                Unfiled
              </h2>
            )}
            {folders.length === 0 && decks.length > 0 && (
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-1">
                My Decks
              </h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {unfiledDecks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  folders={folders}
                  onDelete={deleteDeck}
                  onMove={moveDeck}
                  onExport={exportDeck}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Undo toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 glass px-5 py-3 rounded-xl shadow-2xl z-50 whitespace-nowrap">
          <span className="text-sm">&ldquo;{pendingDelete.deck.name}&rdquo; will be deleted</span>
          <button className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        itemType={confirmState.itemType}
        itemName={confirmState.itemName}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={() => {
          Promise.all([
            apiFetch("/api/decks").then((r) => (r.ok ? r.json() : [])),
            apiFetch("/api/folders").then((r) => (r.ok ? r.json() : [])),
          ]).then(([d, f]) => { setDecks(d); setFolders(f); });
        }}
      />

      <TutorialModal
        isOpen={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
    </main>
  );
}
