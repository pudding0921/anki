"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface Card {
  question: string;
  answer: string;
}

type Step = "input" | "generating" | "review" | "saving";
type Mode = "ai" | "occlusion";

export default function CreatePage() {
  useAuthGuard();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("ai");
  const [deckName, setDeckName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState("");

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...arr.filter((f) => !existing.has(f.name + f.size))];
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  async function handleGenerate() {
    if (files.length === 0) return;
    setStep("generating");
    setError("");

    try {
      const form = new FormData();
      for (const file of files) {
        form.append("files", file);
      }
      form.append("card_count", "10");

      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/cards/generate`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      if (res.status === 401) { router.push("/login"); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Generation failed");
      }

      const data = await res.json();
      setCards(data.cards);
      setStep("review");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("input");
    }
  }

  async function handleSave() {
    setStep("saving");
    setError("");
    try {
      const res = await apiFetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deckName.trim() || "Untitled deck", cards }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Save failed");
      }
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("review");
    }
  }

  function updateCard(i: number, field: "question" | "answer", value: string) {
    setCards((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c))
    );
  }

  function removeCard(i: number) {
    setCards((prev) => prev.filter((_, idx) => idx !== i));
  }

  const hasPdfs = files.some((f) => f.name.toLowerCase().endsWith(".pdf"));

  return (
    <main className="min-h-screen bg-background">
      <nav className="flex items-center px-8 py-5 border-b gap-4">
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/dashboard")}
        >
          ← Dashboard
        </button>
        <span className="text-xl font-bold tracking-tight">New deck</span>
      </nav>

      <div className="max-w-2xl mx-auto px-8 py-12 flex flex-col gap-8">
        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {/* Mode selector */}
        {step === "input" && (
          <div className="flex gap-2 border rounded-xl p-1 self-start">
            {(["ai", "occlusion"] as Mode[]).map((m) => (
              <button
                key={m}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "ai" ? "AI Flashcards" : "Image Occlusion"}
              </button>
            ))}
          </div>
        )}

        {/* Occlusion mode — redirect to dedicated page */}
        {step === "input" && mode === "occlusion" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Upload lecture slides (PDF) or an image, draw rectangles over the
              content you want to hide, and save occlusion cards.
            </p>
            <Link
              href="/create/occlusion"
              className={buttonVariants({ className: "self-start" })}
            >
              Open occlusion editor
            </Link>
          </div>
        )}

        {/* AI mode */}
        {mode === "ai" && (
          <>
            {(step === "input" || step === "generating") && (
              <>
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm">
                    Deck name{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    className="border rounded-lg px-4 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. Anatomy Chapter 4"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    disabled={step === "generating"}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm">
                    Upload files{" "}
                    <span className="text-muted-foreground font-normal">
                      — PDFs, images, or both
                    </span>
                  </label>

                  {/* Drop zone */}
                  <div
                    className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 text-center cursor-pointer transition-colors ${
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary"
                    }`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={onDragOver}
                    onDragEnter={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    {isDragging ? (
                      <p className="text-sm font-medium text-primary">
                        Drop files here
                      </p>
                    ) : files.length === 0 ? (
                      <>
                        <p className="text-muted-foreground text-sm">
                          Drag & drop lecture slides, notes, or any study material
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PDF, PNG, JPG, WEBP · Multiple files allowed · or click to browse
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Drop more files here or click to browse
                      </p>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                    />
                  </div>

                  {/* File list */}
                  {files.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
                      {files.map((file, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                              {file.name.split(".").pop()}
                            </span>
                            <span className="truncate">{file.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {(file.size / 1024).toFixed(0)} KB
                            </span>
                          </div>
                          <button
                            className="text-xs text-red-400 hover:text-red-600 ml-3 shrink-0"
                            onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        {files.length} file{files.length !== 1 ? "s" : ""} selected
                        {hasPdfs && " · All PDF pages will be processed"}
                      </p>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={files.length === 0 || step === "generating"}
                  className="self-start"
                >
                  {step === "generating"
                    ? "Generating cards…"
                    : `Generate flashcards${files.length > 0 ? ` from ${files.length} file${files.length !== 1 ? "s" : ""}` : ""}`}
                </Button>

                {step === "generating" && (
                  <p className="text-xs text-muted-foreground -mt-4">
                    Reading all pages and generating cards — this may take 10–30 seconds…
                  </p>
                )}
              </>
            )}

            {(step === "review" || step === "saving") && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">
                    Review cards ({cards.length})
                  </h2>
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => { setStep("input"); setCards([]); }}
                  >
                    ← Start over
                  </button>
                </div>

                <div className="flex flex-col gap-4">
                  {cards.map((card, i) => (
                    <div key={i} className="border rounded-xl p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">
                          Card {i + 1}
                        </span>
                        <button
                          className="text-xs text-red-400 hover:text-red-600"
                          onClick={() => removeCard(i)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Question</label>
                        <textarea
                          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                          rows={2}
                          value={card.question}
                          onChange={(e) => updateCard(i, "question", e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Answer</label>
                        <textarea
                          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                          rows={2}
                          value={card.answer}
                          onChange={(e) => updateCard(i, "answer", e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {cards.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    All cards removed. Start over to regenerate.
                  </p>
                )}

                <div className="flex gap-3 items-center">
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Deck name</label>
                    <input
                      className="border rounded-lg px-4 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Untitled deck"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={cards.length === 0 || step === "saving"}
                    className="self-end"
                  >
                    {step === "saving" ? "Saving…" : `Save deck (${cards.length} cards)`}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
