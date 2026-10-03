"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/config/nav";
import { NavLink } from "@/components/nav-link";

/**
 * FASE 9E — /qg is the one route that gets the full viewport instead of the
 * sidebar. Its own composition (living-lab-room.tsx) already provides real
 * navigation — "Voltar ao LAB" and the Quick View drawer's full link list —
 * so the site-wide sidebar here only duplicated that and ate the width the
 * organism needs (FASE 9D's own validation named this the main remaining
 * visual problem: "uma aplicação com um organismo dentro"). The `<aside>` is
 * not hidden via CSS for this route, it's not rendered at all — nothing
 * invisible is left focusable, and every other route keeps the exact same
 * markup as before this phase.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/qg") {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="px-4 py-5">
          <span className="text-[13px] font-semibold tracking-tight">AI Product Lab</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<item.icon size={16} strokeWidth={1.75} />}
            />
          ))}
        </nav>
        <div className="mt-auto px-4 py-4 text-[11px] text-muted">v0.1 · Foundation</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
