"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Zone {
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
  onSave: (zones: Zone[]) => void;
}

export default function OcclusionEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  initialZones = [],
  onSave,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reload zones if initialZones prop changes (e.g. AI re-generates)
  useEffect(() => {
    setZones(initialZones);
  }, [initialZones]);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      if (containerRef.current) {
        const available = containerRef.current.clientWidth;
        setScale(Math.min(1, available / imageWidth));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Re-draw whenever zones or scale changes
  useEffect(() => {
    redraw(zones, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, scale]);

  function redraw(zoneList: Zone[], draft: { x: number; y: number; w: number; h: number } | null) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const z of zoneList) {
      ctx.fillStyle = "rgba(30, 64, 175, 0.65)";
      ctx.fillRect(z.x * scale, z.y * scale, z.width * scale, z.height * scale);
      ctx.strokeStyle = "#1e40af";
      ctx.lineWidth = 2;
      ctx.strokeRect(z.x * scale, z.y * scale, z.width * scale, z.height * scale);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(11, 13 * scale)}px sans-serif`;
      ctx.fillText(z.label, z.x * scale + 4, z.y * scale + 15 * scale);
    }

    if (draft) {
      ctx.fillStyle = "rgba(99, 102, 241, 0.25)";
      ctx.fillRect(draft.x, draft.y, draft.w, draft.h);
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
      ctx.setLineDash([]);
    }
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setStart(getPos(e));
    setDrawing(true);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const pos = getPos(e);
    redraw(zones, {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    });
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    setDrawing(false);
    const pos = getPos(e);
    const rw = Math.abs(pos.x - start.x) / scale;
    const rh = Math.abs(pos.y - start.y) / scale;
    if (rw < 5 || rh < 5) { redraw(zones, null); return; }

    const label = prompt("Label for this zone:", `Zone ${zones.length + 1}`) ?? "";
    if (!label.trim()) { redraw(zones, null); return; }

    const newZone: Zone = {
      id: crypto.randomUUID(),
      x: Math.min(start.x, pos.x) / scale,
      y: Math.min(start.y, pos.y) / scale,
      width: rw,
      height: rh,
      label: label.trim(),
    };
    setZones((prev) => [...prev, newZone]);
  }

  function removeZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id));
  }

  return (
    <div className="flex flex-col gap-4" ref={containerRef}>
      <canvas
        ref={canvasRef}
        width={imageWidth * scale}
        height={imageHeight * scale}
        className="border rounded-xl cursor-crosshair w-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />

      {zones.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            {zones.length} zone{zones.length !== 1 ? "s" : ""} — remove any you don&apos;t want, or draw more on the image above
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {zones.map((z) => (
              <div
                key={z.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm bg-blue-50 border-blue-100"
              >
                <span className="font-medium text-blue-900 truncate mr-2">{z.label}</span>
                <button
                  className="text-xs text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => removeZone(z.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Draw rectangles on the image to add zones manually.
        </p>
      )}

      <Button
        disabled={zones.length === 0}
        onClick={() => onSave(zones)}
        className="self-start"
      >
        Save card ({zones.length} zone{zones.length !== 1 ? "s" : ""})
      </Button>
    </div>
  );
}
