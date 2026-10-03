"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * The one overlay shell every QG click-to-interact detail uses (Agent, Head,
 * Meeting, Reports, Clock, and — FASE 11/12 — the Command Center console).
 * A single reusable component instead of one bespoke modal per station, and
 * the same dismiss behavior (Escape, the X button, or the backdrop)
 * everywhere.
 *
 * Rendered via a portal into document.body rather than inline. Per spec,
 * any non-`none` CSS `transform` on an ancestor becomes the containing
 * block for a `position: fixed` descendant, so an inline fixed-position
 * modal breaks the moment one of its ancestors gets one — exactly what
 * happened with the old zoomable QG room, and exactly what a future
 * Framer Motion `motion.div` (already an approved Living Interface
 * dependency, not yet used by any current caller) or the agent orbs'
 * own breathing transform would risk again. The portal makes every
 * caller immune to that regardless of what wraps it. No mount guard is
 * needed for `document`: every caller
 * renders this component conditionally (`panel?.type === "x" ? <Panel/> :
 * null`, always starting closed), so it only ever mounts in response to a
 * client-side click — never during the server-rendered initial pass.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="qg-panel-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="qg-panel-dialog-in qg-panel-scope flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
