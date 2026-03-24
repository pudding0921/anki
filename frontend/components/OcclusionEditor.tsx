"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface Zone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initialZones?: Zone[];
  saveLabel?: string;
  onSave: (zones: Zone[]) => void;
}

const HANDLE_R = 6;
const HANDLE_HIT = 10;
const HANDLE_CURSORS: Record<HandleDir, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};

type DrawingRect = { sx: number; sy: number; ex: number; ey: number };

type Interaction =
  | { kind: "idle" }
  | { kind: "moving"; id: string; sx: number; sy: number; ox: number; oy: number }
  | { kind: "resizing"; id: string; handle: HandleDir; sx: number; sy: number; orig: Zone }
  | { kind: "drawing"; sx: number; sy: number; ex: number; ey: number };

function handlePositions(z: Zone, sc: number): Record<HandleDir, [number, number]> {
  const x1 = z.x * sc, y1 = z.y * sc;
  const x2 = (z.x + z.width) * sc, y2 = (z.y + z.height) * sc;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return { nw: [x1, y1], n: [mx, y1], ne: [x2, y1], e: [x2, my], se: [x2, y2], s: [mx, y2], sw: [x1, y2], w: [x1, my] };
}

function hitHandle(px: number, py: number, z: Zone, sc: number): HandleDir | null {
  for (const [dir, [hx, hy]] of Object.entries(handlePositions(z, sc))) {
    if (Math.abs(px - hx) <= HANDLE_HIT && Math.abs(py - hy) <= HANDLE_HIT) return dir as HandleDir;
  }
  return null;
}

function hitZone(px: number, py: number, z: Zone, sc: number): boolean {
  return px >= z.x * sc && px <= (z.x + z.width) * sc
    && py >= z.y * sc && py <= (z.y + z.height) * sc;
}

function applyResize(orig: Zone, handle: HandleDir, dx: number, dy: number, sc: number): Zone {
  const ddx = dx / sc, ddy = dy / sc;
  let { x, y, width, height } = orig;
  if (handle.includes("w")) { x += ddx; width -= ddx; }
  if (handle.includes("e")) { width += ddx; }
  if (handle.includes("n")) { y += ddy; height -= ddy; }
  if (handle.includes("s")) { height += ddy; }
  if (width < 5 / sc) width = 5 / sc;
  if (height < 5 / sc) height = 5 / sc;
  return { ...orig, x, y, width, height };
}

export default function OcclusionEditor({
  imageUrl, imageWidth, imageHeight, initialZones = [], saveLabel, onSave,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [imgRevision, setImgRevision] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const iactionRef = useRef<Interaction>({ kind: "idle" });

  const zonesRef = useRef(zones);
  const scaleRef = useRef(scale);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  useEffect(() => {
    setZones(initialZones);
    setSelectedId(null);
    iactionRef.current = { kind: "idle" };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialZones]);

  useEffect(() => {
    imgRef.current = null;
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      if (containerRef.current) {
        setScale(Math.min(1, containerRef.current.clientWidth / imageWidth));
      }
      // Always force a redraw — setScale won't trigger one if scale didn't change
      setImgRevision((r) => r + 1);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  function redraw(zoneList: Zone[], sel: string | null, drawing?: DrawingRect) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sc = scaleRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const z of zoneList) {
      const isSelected = z.id === sel;
      ctx.fillStyle = isSelected ? "rgba(99,102,241,0.55)" : "rgba(30,64,175,0.65)";
      ctx.fillRect(z.x * sc, z.y * sc, z.width * sc, z.height * sc);
      ctx.strokeStyle = isSelected ? "#6366f1" : "#1e40af";
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.strokeRect(z.x * sc, z.y * sc, z.width * sc, z.height * sc);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(11, 13 * sc)}px sans-serif`;
      ctx.fillText(z.label, z.x * sc + 4, z.y * sc + 15 * sc);

      if (isSelected) {
        for (const [hx, hy] of Object.values(handlePositions(z, sc))) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(hx - HANDLE_R, hy - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
          ctx.strokeStyle = "#6366f1";
          ctx.lineWidth = 2;
          ctx.strokeRect(hx - HANDLE_R, hy - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
        }
      }
    }

    if (drawing) {
      const x = Math.min(drawing.sx, drawing.ex);
      const y = Math.min(drawing.sy, drawing.ey);
      const w = Math.abs(drawing.ex - drawing.sx);
      const h = Math.abs(drawing.ey - drawing.sy);
      ctx.fillStyle = "rgba(99,102,241,0.3)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  useEffect(() => {
    redraw(zones, selectedId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, scale, selectedId, imgRevision]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getPos(e);
    const sc = scaleRef.current;
    const zs = zonesRef.current;
    const sel = selectedIdRef.current;

    if (sel) {
      const sz = zs.find((z) => z.id === sel);
      if (sz) {
        const h = hitHandle(pos.x, pos.y, sz, sc);
        if (h) {
          iactionRef.current = { kind: "resizing", id: sel, handle: h, sx: pos.x, sy: pos.y, orig: { ...sz } };
          return;
        }
      }
    }

    for (let i = zs.length - 1; i >= 0; i--) {
      if (hitZone(pos.x, pos.y, zs[i], sc)) {
        setSelectedId(zs[i].id);
        iactionRef.current = { kind: "moving", id: zs[i].id, sx: pos.x, sy: pos.y, ox: zs[i].x, oy: zs[i].y };
        return;
      }
    }

    // Nothing hit — start drawing a new zone
    setSelectedId(null);
    iactionRef.current = { kind: "drawing", sx: pos.x, sy: pos.y, ex: pos.x, ey: pos.y };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getPos(e);
    const sc = scaleRef.current;
    const ia = iactionRef.current;
    const zs = zonesRef.current;
    const sel = selectedIdRef.current;

    const canvas = canvasRef.current;
    if (canvas) {
      let cursor = "crosshair";
      if (ia.kind === "drawing") {
        cursor = "crosshair";
      } else if (sel) {
        const sz = zs.find((z) => z.id === sel);
        if (sz) {
          const h = hitHandle(pos.x, pos.y, sz, sc);
          if (h) cursor = HANDLE_CURSORS[h];
          else if (hitZone(pos.x, pos.y, sz, sc)) cursor = "move";
        }
      }
      if (cursor === "crosshair") {
        for (const z of zs) if (hitZone(pos.x, pos.y, z, sc)) { cursor = "pointer"; break; }
      }
      canvas.style.cursor = cursor;
    }

    if (ia.kind === "moving") {
      const updated = zs.map((z) =>
        z.id === ia.id ? { ...z, x: ia.ox + (pos.x - ia.sx) / sc, y: ia.oy + (pos.y - ia.sy) / sc } : z
      );
      zonesRef.current = updated;
      redraw(updated, sel);
      return;
    }

    if (ia.kind === "resizing") {
      const updated = zs.map((z) =>
        z.id === ia.id ? applyResize(ia.orig, ia.handle, pos.x - ia.sx, pos.y - ia.sy, sc) : z
      );
      zonesRef.current = updated;
      redraw(updated, sel);
    }

    if (ia.kind === "drawing") {
      iactionRef.current = { ...ia, ex: pos.x, ey: pos.y };
      redraw(zs, sel, { sx: ia.sx, sy: ia.sy, ex: pos.x, ey: pos.y });
    }
  }

  function onMouseUp() {
    const ia = iactionRef.current;
    iactionRef.current = { kind: "idle" };
    if (ia.kind === "moving" || ia.kind === "resizing") {
      setZones([...zonesRef.current]);
    }
    if (ia.kind === "drawing") {
      const sc = scaleRef.current;
      const x = Math.min(ia.sx, ia.ex) / sc;
      const y = Math.min(ia.sy, ia.ey) / sc;
      const width = Math.abs(ia.ex - ia.sx) / sc;
      const height = Math.abs(ia.ey - ia.sy) / sc;
      if (width > 10 / sc && height > 10 / sc) {
        const newZone: Zone = {
          id: crypto.randomUUID(),
          x, y, width, height,
          label: `Zone ${zonesRef.current.length + 1}`,
        };
        const updated = [...zonesRef.current, newZone];
        zonesRef.current = updated;
        setZones(updated);
        setSelectedId(newZone.id);
      } else {
        redraw(zonesRef.current, selectedIdRef.current);
      }
    }
  }

  function removeZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (selectedIdRef.current === id) setSelectedId(null);
  }

  function renameZone(id: string, label: string) {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, label } : z)));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const sel = selectedIdRef.current;
      const target = e.target as HTMLElement;
      if ((e.key === "Delete" || e.key === "Backspace") && sel && target.tagName !== "INPUT") {
        removeZone(sel);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4" ref={containerRef}>
      {selectedId && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => removeZone(selectedId)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Delete selected zone
          </button>
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={imageWidth * scale}
        height={imageHeight * scale}
        className="border rounded-xl w-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />

      {zones.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            {zones.length} zone{zones.length !== 1 ? "s" : ""} — drag on empty space to add, click to select, drag to move, drag handles to resize, Delete key or ✕ to remove
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {zones.map((z) => (
              <div
                key={z.id}
                onClick={() => setSelectedId(z.id)}
                className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm cursor-pointer transition-colors ${
                  z.id === selectedId
                    ? "border-indigo-500/50 bg-indigo-500/10"
                    : "border-border hover:border-indigo-500/30 hover:bg-indigo-500/5"
                }`}
              >
                <input
                  className="flex-1 bg-transparent font-medium focus:outline-none min-w-0 text-foreground"
                  value={z.label}
                  onChange={(e) => renameZone(z.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  className="text-xs text-muted-foreground hover:text-red-400 shrink-0 transition-colors"
                  onClick={(e) => { e.stopPropagation(); removeZone(z.id); }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No zones yet — drag on the image to draw a new zone.
        </p>
      )}

      <Button
        disabled={zones.length === 0}
        onClick={() => onSave(zones)}
        className="self-start"
      >
        {saveLabel ?? `Save card (${zones.length} zone${zones.length !== 1 ? "s" : ""})`}
      </Button>
    </div>
  );
}
