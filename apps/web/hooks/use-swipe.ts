"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useMedia } from "./use-media";

// Lock direction before capturing the pointer; pan-y remains native scrolling.
export function useSwipe(
  onComplete: () => void,
  enabled = true,
  actionsWidth = 184,
) {
  const mobile = useMedia("(max-width: 760px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [x, setX] = useState(0);
  const [open, setOpen] = useState(false);
  const position = useRef(0);
  const animation = useRef(0);
  const suppressClick = useRef(false);
  const gesture = useRef<{
    x: number;
    y: number;
    start: number;
    direction: "pending" | "horizontal" | "vertical";
  } | null>(null);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  function move(value: number) {
    position.current = value;
    setX(value);
  }
  function settle(target: number) {
    cancelAnimationFrame(animation.current);
    setOpen(target < 0);
    if (reduced) {
      move(target);
      return;
    }
    let velocity = 0;
    let previous = performance.now();
    const frame = (time: number) => {
      const dt = Math.min((time - previous) / 1000, 0.032);
      previous = time;
      // Damped spring: force = -kx - cv, integrated at animation-frame cadence.
      velocity += ((target - position.current) * 420 - velocity * 34) * dt;
      const next = position.current + velocity * dt;
      if (Math.abs(next - target) < 0.3 && Math.abs(velocity) < 2) {
        move(target);
        return;
      }
      move(next);
      animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.direction !== "horizontal") return;
    suppressClick.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && position.current >= 88) {
      settle(0);
      onComplete();
    } else settle(!cancelled && position.current < -52 ? -actionsWidth : 0);
  }
  return {
    x,
    open,
    close: () => settle(0),
    handlers: {
      onPointerDown(e: PointerEvent<HTMLDivElement>) {
        suppressClick.current = false;
        if (
          !enabled ||
          !mobile ||
          e.pointerType === "mouse" ||
          !(e.target instanceof Element) ||
          e.target.closest(
            "input,textarea,.task-check,.row-open,.swipe-actions",
          )
        )
          return;
        cancelAnimationFrame(animation.current);
        gesture.current = {
          x: e.clientX,
          y: e.clientY,
          start: position.current,
          direction: "pending",
        };
      },
      onPointerMove(e: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current) return;
        const dx = e.clientX - current.x,
          dy = e.clientY - current.y;
        if (current.direction === "pending") {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
          current.direction =
            Math.abs(dx) > Math.abs(dy) * 1.3 ? "horizontal" : "vertical";
          if (current.direction === "horizontal")
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (current.direction !== "horizontal") return;
        suppressClick.current = true;
        const distance = current.start + dx;
        move(Math.max(-actionsWidth - 18, Math.min(125, distance)));
      },
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => finish(e),
      onPointerCancel: (e: PointerEvent<HTMLDivElement>) => finish(e, true),
      onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      },
    },
  };
}
