"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const MAX_SCALE = 6;
const TAP_ZOOM = 2.5;

type View = { s: number; x: number; y: number };
type Point = { x: number; y: number };

// Pinch or wheel to zoom, drag to pan, double-tap or double-click to toggle zoom.
export function ZoomableImage({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; mid: Point; dist: number } | null>(null);
  const tap = useRef<{ at: number; x: number; y: number; moved: boolean }>({
    at: 0,
    x: 0,
    y: 0,
    moved: false,
  });
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  const apply = (next: View) => {
    const box = frame.current?.getBoundingClientRect();
    const img = image.current;
    const s = Math.min(MAX_SCALE, Math.max(1, next.s));
    let { x, y } = next;
    if (box && img) {
      const maxX = Math.max(0, (img.offsetWidth * s - box.width) / 2);
      const maxY = Math.max(0, (img.offsetHeight * s - box.height) / 2);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
    }
    if (s === 1) x = y = 0;
    viewRef.current = { s, x, y };
    setView(viewRef.current);
  };

  // Point relative to the frame centre, the origin of the image transform.
  const local = (clientX: number, clientY: number): Point => {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: clientX - box.left - box.width / 2,
      y: clientY - box.top - box.height / 2,
    };
  };

  // Scale to `s` while keeping the image point under `f` fixed on screen.
  const zoomAt = (from: View, s: number, f: Point, to: Point = f) => {
    const k = Math.min(MAX_SCALE, Math.max(1, s)) / from.s;
    apply({ s: from.s * k, x: to.x - k * (f.x - from.x), y: to.y - k * (f.y - from.y) });
  };

  const startGesture = () => {
    const pts = Array.from(pointers.current.values());
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        view: viewRef.current,
        mid: local((a.x + b.x) / 2, (a.y + b.y) / 2),
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      };
    } else if (pts.length === 1) {
      gesture.current = { view: viewRef.current, mid: local(pts[0].x, pts[0].y), dist: 0 };
    } else gesture.current = null;
  };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const from = viewRef.current;
      zoomAt(from, from.s * Math.exp(-e.deltaY * 0.002), local(e.clientX, e.clientY));
    };
    // iOS Safari fires its own pinch events; keep them from zooming the page.
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", block);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", block);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={frame}
      className="lightbox-image zoomable"
      data-zoomed={view.s > 1 || undefined}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1)
          tap.current = { at: e.timeStamp, x: e.clientX, y: e.clientY, moved: false };
        else tap.current.moved = true;
        startGesture();
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 8)
          tap.current.moved = true;
        const g = gesture.current;
        if (!g) return;
        const pts = Array.from(pointers.current.values());
        if (pts.length >= 2 && g.dist) {
          const [a, b] = pts;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt(g.view, (g.view.s * dist) / g.dist, g.mid, local((a.x + b.x) / 2, (a.y + b.y) / 2));
        } else if (pts.length === 1 && g.view.s > 1) {
          const p = local(pts[0].x, pts[0].y);
          apply({ ...g.view, x: g.view.x + p.x - g.mid.x, y: g.view.y + p.y - g.mid.y });
        }
      }}
      onPointerUp={(e) => {
        if (!pointers.current.delete(e.pointerId)) return;
        const t = tap.current;
        if (pointers.current.size === 0 && !t.moved && e.timeStamp - t.at < 300) {
          const prev = lastTap.current;
          if (prev && e.timeStamp - prev.at < 350 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
            lastTap.current = null;
            const from = viewRef.current;
            if (from.s > 1) apply({ s: 1, x: 0, y: 0 });
            else zoomAt(from, TAP_ZOOM, local(e.clientX, e.clientY));
          } else lastTap.current = { at: e.timeStamp, x: e.clientX, y: e.clientY };
        }
        startGesture();
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        startGesture();
      }}
    >
      <Image
        ref={image}
        unoptimized
        draggable={false}
        width={width}
        height={height}
        style={{
          width: "auto",
          height: "auto",
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
        }}
        src={src}
        alt={alt}
      />
    </div>
  );
}
