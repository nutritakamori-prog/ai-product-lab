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
 * Rendered via a portal into document.body — required once a caller (the
 * FASE 11/12 Command Center) is itself nested inside `.qg-floor`, which
 * carries a CSS `transform` (even `scale(1)` at the default zoom level).
 * Per spec, any non-`none` transform on an ancestor becomes the containing
 * block for a `position: fixed` descendant, so without the portal this
 * panel would position itself relative to the zoomed floor instead of the
 * real viewport — invisible-but-clickable background elements would then
 * sit on top of it, silently swallowing clicks on its own buttons. No
 * mount guard is needed for `document`: every caller renders this
 * component conditionally (`panel?.type === "x" ? <Panel/> : null`, always
 * starting closed), so it only ever mounts in response to a client-side
 * click — never during the server-rendered initial pass.
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
        className="qg-panel-dialog-in flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
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
