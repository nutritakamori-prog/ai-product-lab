"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
        isActive
          ? "bg-foreground/[0.06] text-foreground font-medium"
          : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
