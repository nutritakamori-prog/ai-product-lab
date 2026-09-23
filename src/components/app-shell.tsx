import { NAV_ITEMS } from "@/config/nav";
import { NavLink } from "@/components/nav-link";

export function AppShell({ children }: { children: React.ReactNode }) {
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
