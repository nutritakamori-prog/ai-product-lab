"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * The one overlay shell every QG click-to-interact detail uses (Agent, Head,
 * Meeting, Reports, Clock) — a single reusable component instead of one
 * bespoke modal per station, and the same dismiss behavior (Escape, the X
 * button, or the backdrop) everywhere.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
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
    </div>
  );
}
