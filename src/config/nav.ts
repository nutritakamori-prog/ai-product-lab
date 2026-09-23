import type { LucideIcon } from "lucide-react";
import { LayoutGrid, FolderKanban, Bot, FlaskConical, Settings } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutGrid },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Test Lab", href: "/test-lab", icon: FlaskConical },
  { label: "Settings", href: "/settings", icon: Settings },
];
