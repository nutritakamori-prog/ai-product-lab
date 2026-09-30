"use client";

import { useState } from "react";
import { Button } from "@/components/button";

/**
 * Pure clipboard write of a string already fully rendered server-side
 * (formatImplementationTaskAsText) — no server round-trip, no persistence.
 * "Copiado!" is a local, per-click UI state only; it never blocks or
 * confirms anything beyond the browser's own clipboard write succeeding.
 */
export function CopyTaskButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="primary" onClick={handleClick}>
      {copied ? "Copiado!" : "Copiar tarefa"}
    </Button>
  );
}
