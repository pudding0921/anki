"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_URL, apiFetch, imgUrl } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";
import OcclusionEditor, { type Zone } from "@/components/OcclusionEditor";

const PENDING_JOB_KEY = "flowcard_pending_occlusion_job";

interface PageInfo {
  image_path: string;
  width: number;
  height: number;
  page: number;
}

interface PageResult {
  page: number;
  status: "created" | "skipped" | "error";
  zones?: number;
  diagrams?: number;
  reason?: string;
}

interface ReviewCard {
  id: number;
  image_path: string;
  image_width: number;
  image_height: number;
  occlusion_zones: { id: number; x: number; y: number; width: number; height: number; label: string }[];
}

type Step = "upload" | "uploading" | "processing" | "reviewing" | "done";

export default function OcclusionPage() {
  useAuthGuard();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const checklistRef = useRef<HTMLInputElement>(null);

  const [deckName, setDeckName] = useState("");
  const [checklistFile, setChecklistFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [results, setResults] = useState<{ created: number; skipped: number; results: PageResult[]; deckId?: number }>({
    created: 0, skipped: 0, results: [],
  });

  // Reviewing state
  const [reviewCards, setReviewCards] = useState<ReviewCard[]>([]);
  const [savedCardIds, setSavedCardIds] = useState<Set<number>>(new Set());

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function onDragLeave(e: React.DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) run(f); }

  // Resume a pending job when returning to the tab after navigating away
  useEffect(() => {
    const token = localStorage.getItem("token");
    const pending = localStorage.getItem(PENDING_JOB_KEY);
    if (!pending || !token) return;
    try {
      const { jobId, total } = JSON.parse(pending);
      const authHeader = { Authorization: `Bearer ${token}` };
      setPageCount(total);
      setStep("processing");
      pollJob(jobId, authHeader).catch((err) => {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStep("upload");
        localStorage.removeItem(PENDING_JOB_KEY);
      });
    } catch {
      localStorage.removeItem(PENDING_JOB_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollJob(jobId: string, authHeader: Record<string, string>) {
    let networkErrors = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 1500));
      let statusRes: Response;
      try {
        statusRes = await fetch(`${API_URL}/api/cards/batch-occlusion/status/${jobId}`, { headers: authHeader });
      } catch {
        // Network error — server may be briefly restarting (Render cold-start
        // or OOM recovery can take up to 45s). Retry up to 6 times at 5s
        // intervals (30s tolerance) before surfacing an error.
        networkErrors++;
        if (networkErrors >= 6) throw new Error("Lost connection to server — please check your internet and try again.");
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      networkErrors = 0;
      if (!statusRes.ok) {
        if (statusRes.status === 404) throw new Error("Job expired — please re-upload your slides.");
        throw new Error("Failed to check job status");
      }
      const job = await statusRes.json();
      setProcessedCount(job.done ?? 0);
      setPageCount(job.total ?? 0);

      if (job.status === "error") {
        localStorage.removeItem(PENDING_JOB_KEY);
        throw new Error(job.error || "AI processing failed");
      }

      if (job.status === "done") {
        localStorage.removeItem(PENDING_JOB_KEY);
        setResults({ created: job.created, skipped: job.skipped, results: job.results, deckId: job.deck_id });

        // Load cards for review — retry up to 3 times in case of transient DB/network hiccup
        if (job.deck_id) {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
            try {
              const deckRes = await fetch(`${API_URL}/api/decks/${job.deck_id}`, { headers: authHeader });
              if (!deckRes.ok) continue;
              const deck = await deckRes.json();
              const cards: ReviewCard[] = (deck.cards ?? []).filter(
                (c: ReviewCard & { card_type: string }) => c.card_type === "occlusion"
              );
              if (cards.length > 0) {
                setReviewCards(cards);
                setSavedCardIds(new Set());
                setStep("reviewing");
                return;
              }
            } catch { /* retry */ }
          }
        }
        setStep("done");
        return;
      }
    }
  }

  async function uploadPages(file: File, authHeader: Record<string, string>): Promise<PageInfo[]> {
    const uploadForm = new FormData();
    uploadForm.append("file", file);
    const uploadRes = await fetch(`${API_URL}/api/cards/upload-pages`, {
      method: "POST", headers: authHeader, body: uploadForm,
    });
    if (!uploadRes.ok) { const d = await uploadRes.json().catch(() => ({})); throw new Error(d.detail || "Upload failed"); }

    let pages: PageInfo[] = [];
    const reader = uploadRes.body?.getReader();
    if (!reader) throw new Error("Streaming not supported");
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "total") setPageCount(evt.total);
          else if (evt.type === "page") setUploadedCount((n) => n + 1);
          else if (evt.type === "done") pages = evt.pages;
          else if (evt.type === "error") throw new Error(evt.detail || "Server error during upload");
          else if (evt.type === "heartbeat") { /* keep-alive, ignore */ }
          else if (Array.isArray(evt.pages)) pages = evt.pages;
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) { /* ignore malformed lines */ }
          else throw parseErr;
        }
      }
    }
    if (buf.trim()) {
      try {
        const evt = JSON.parse(buf);
        if (evt.type === "done") pages = evt.pages;
        else if (evt.type === "error") throw new Error(evt.detail || "Server error during upload");
        else if (Array.isArray(evt.pages)) pages = evt.pages;
      } catch (parseErr) {
        if (!(parseErr instanceof SyntaxError)) throw parseErr;
      }
    }
    return pages;
  }

  async function run(file: File) {
    setError("");
    setStep("uploading");

    const token = localStorage.getItem("token");
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      // Step 1: Render PDF pages (streamed).
      // Retry once if pages comes back empty — this happens when the Modal
      // container is cold-starting on first use. The retry succeeds because
      // the container is warm by then.
      setUploadedCount(0);
      let pages = await uploadPages(file, authHeader);
      if (!pages.length) {
        setError("Server is warming up — retrying upload automatically…");
        await new Promise((r) => setTimeout(r, 4000));
        setError("");
        setUploadedCount(0);
        pages = await uploadPages(file, authHeader);
      }
      if (!pages.length) throw new Error("No pages returned from upload — please try again");
      setPageCount(pages.length);

      // Step 2: Start background AI job — returns immediately with job_id
      setStep("processing");
      setProcessedCount(0);
      const batchForm = new FormData();
      batchForm.append("deck_name", deckName.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled deck");
      batchForm.append("pages_json", JSON.stringify(pages));
      if (checklistFile) batchForm.append("checklist_file", checklistFile);

      const batchRes = await fetch(`${API_URL}/api/cards/batch-occlusion`, {
        method: "POST", headers: authHeader, body: batchForm,
      });
      if (!batchRes.ok) { const d = await batchRes.json().catch(() => ({})); throw new Error(d.detail || "AI processing failed"); }
      const { job_id, total } = await batchRes.json();

      // Persist job so we can resume if the user switches tabs
      localStorage.setItem(PENDING_JOB_KEY, JSON.stringify({ jobId: job_id, total }));

      // Step 3: Poll until done
      await pollJob(job_id, authHeader);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("upload");
    }
  }

  async function saveCard(cardId: number, zones: Zone[]) {
    await apiFetch(`/api/cards/${cardId}/zones`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zones: zones.map(({ x, y, width, height, label }) => ({ x, y, width, height, label })),
      }),
    });
    setSavedCardIds((prev) => new Set(prev).add(cardId));
  }

  function handleExit() {
    if (step === "reviewing") {
      if (!confirm("Exit review? Any unsaved edits will keep the AI's original zones.")) return;
    }
    router.push("/dashboard");
  }

  async function saveAllAndFinish() {
    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen bg-background">
      <nav className="sticky top-0 z-20 glass border-b border-border/60">
        <div className="flex items-center gap-4 px-6 py-4">
          {/* Left: back/logo */}
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={() => {
              if (step === "reviewing" || step === "done") handleExit();
              else router.push("/create");
            }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
            {step === "reviewing" || step === "done" ? "Dashboard" : "Back"}
          </button>

          <span className="font-semibold text-sm truncate">Image Occlusion</span>

          {/* Right: save progress + actions (only during review) */}
          {step === "reviewing" && (
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {savedCardIds.size}
                <span className="text-muted-foreground/40"> / </span>
                {reviewCards.length} saved
              </span>
              <button
                onClick={handleExit}
                className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
              >
                Exit
              </button>
              <button
                onClick={saveAllAndFinish}
                className="px-4 py-1.5 rounded-lg gradient-btn text-sm font-semibold"
              >
                Save &amp; Finish
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-8 py-12 flex flex-col gap-8">
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* ── Upload ── */}
        {step === "upload" && (
          <>
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm">Deck name</label>
              <input
                className="border rounded-lg px-4 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Anatomy Chapter 4 (optional)"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3">
              <label className="font-medium text-sm">
                Upload lecture slides{" "}
                <span className="text-muted-foreground font-normal">— PDF or image</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-xl p-16 flex flex-col items-center gap-4 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-primary bg-primary/5" : "hover:border-primary"
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={onDragOver}
                onDragEnter={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                {isDragging ? (
                  <p className="text-primary font-medium">Drop to upload</p>
                ) : (
                  <>
                    <div className="text-4xl">📄</div>
                    <div>
                      <p className="font-medium">Drag & drop your slides here</p>
                      <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                    </div>
                    <p className="text-xs text-muted-foreground">PDF · PNG · JPG · WEBP</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The AI will analyze every slide and automatically create occlusion cards — you can review and edit each one before saving.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm">
                Study checklist{" "}
                <span className="text-muted-foreground font-normal">— optional PDF</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Upload your study guide and the AI will focus occlusions on those specific topics.
              </p>
              <div className="flex items-center gap-3">
                <button
                  className="text-sm border rounded-lg px-4 py-2 hover:bg-muted transition-colors"
                  onClick={() => checklistRef.current?.click()}
                >
                  {checklistFile ? checklistFile.name : "Choose checklist PDF"}
                </button>
                {checklistFile && (
                  <button className="text-xs text-red-400 hover:text-red-600" onClick={() => setChecklistFile(null)}>
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={checklistRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => setChecklistFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </>
        )}

        {/* ── Uploading ── */}
        {step === "uploading" && (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div>
              <p className="font-semibold text-lg">Uploading & rendering slides…</p>
              {uploadedCount > 0 && pageCount > 0 ? (
                <p className="text-sm text-muted-foreground mt-1">{uploadedCount} / {pageCount} pages ready</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">Preparing your file for AI analysis</p>
              )}
              {uploadedCount > 0 && pageCount > 0 && (
                <div className="mt-3 w-48 h-1.5 bg-muted rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((uploadedCount / pageCount) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Processing ── */}
        {step === "processing" && (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div>
              <p className="font-semibold text-lg">AI is analyzing your slides…</p>
              {processedCount > 0 ? (
                <p className="text-sm text-muted-foreground mt-1">
                  {processedCount} / {pageCount} page{pageCount !== 1 ? "s" : ""} done
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Processing {pageCount} page{pageCount !== 1 ? "s" : ""} — identifying key terms and creating cards
                </p>
              )}
              {processedCount > 0 && pageCount > 0 && (
                <div className="mt-3 w-48 h-1.5 bg-muted rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((processedCount / pageCount) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Reviewing ── */}
        {step === "reviewing" && reviewCards.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="border border-emerald-500/30 bg-emerald-500/10 rounded-xl px-5 py-4 flex flex-col gap-1">
              <p className="font-semibold text-emerald-400">
                {reviewCards.length} card{reviewCards.length !== 1 ? "s" : ""} generated from {pageCount} slide{pageCount !== 1 ? "s" : ""}
              </p>
              <p className="text-sm text-emerald-400/80">
                Edit zones on any slide below, then hit <span className="font-medium text-emerald-300">Save &amp; Finish</span> to go to your dashboard.
              </p>
            </div>

            {reviewCards.map((card, idx) => (
              <div key={card.id} className="border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                    Slide {idx + 1} of {reviewCards.length}
                  </span>
                  {savedCardIds.has(card.id) && (
                    <span className="text-xs text-emerald-400 font-medium">✓ Saved</span>
                  )}
                </div>
                <OcclusionEditor
                  key={card.id}
                  imageUrl={imgUrl(card.image_path)}
                  imageWidth={card.image_width}
                  imageHeight={card.image_height}
                  initialZones={card.occlusion_zones.map((z) => ({
                    id: String(z.id),
                    x: z.x,
                    y: z.y,
                    width: z.width,
                    height: z.height,
                    label: z.label,
                  }))}
                  saveLabel="Save zones"
                  onSave={(zones) => saveCard(card.id, zones)}
                />
              </div>
            ))}

            <div className="flex gap-3 border-t border-border pt-4 pb-8">
              <button
                onClick={saveAllAndFinish}
                className="px-5 py-2 rounded-xl gradient-btn text-sm font-semibold"
              >
                Save &amp; Finish
              </button>
              <p className="text-xs text-muted-foreground self-center">
                Unsaved cards keep the AI&apos;s zones unchanged.
              </p>
            </div>
          </div>
        )}

        {/* ── Done (fallback: 0 cards created) ── */}
        {step === "done" && (
          <div className="flex flex-col gap-6">
            <div className="border rounded-xl p-6 flex flex-col gap-2 bg-muted/40 border-border">
              <p className="font-semibold text-lg">No cards could be generated</p>
              <p className="text-sm text-muted-foreground">
                The slides may not contain readable text. Try uploading a different file or go to your dashboard to create cards manually.
              </p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button onClick={() => router.push("/dashboard")}>Go to dashboard</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setResults({ created: 0, skipped: 0, results: [], deckId: undefined });
                  setPageCount(0);
                  setUploadedCount(0);
                  setProcessedCount(0);
                  setChecklistFile(null);
                  setReviewCards([]);
                  setSavedCardIds(new Set());
                }}
              >
                Upload different slides
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
