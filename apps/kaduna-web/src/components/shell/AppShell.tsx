"use client";

import { Activity, Map as MapIcon, SlidersHorizontal, CheckCircle2, Truck, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

export type Section = "overview" | "whatif" | "validation" | "dispatch";

export const SECTIONS: { id: Section; label: string; icon: typeof Activity; hint: string }[] = [
  { id: "overview", label: "Overview", icon: MapIcon, hint: "Incidents, hotspots and impact" },
  { id: "whatif", label: "What-if", icon: SlidersHorizontal, hint: "Adjust factor weights" },
  { id: "validation", label: "Validation", icon: CheckCircle2, hint: "Model against SUMO" },
  { id: "dispatch", label: "Dispatch", icon: Truck, hint: "Routing and triage results" },
];

/**
 * Application shell: rail navigation, workspace identity, account menu.
 *
 * Built for the system this becomes — operators and third parties signing in
 * to work, not a single-screen research view. The rail is where roles and
 * permissions will gate sections, so navigation is a real structure rather
 * than tab state on one page.
 */
export function AppShell({
  section,
  onSectionChange,
  user,
  onSignOut,
  children,
}: {
  section: Section;
  onSectionChange: (s: Section) => void;
  user: { name: string; email: string; role: string };
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const account = user;
  const initials = account.name.split(" ").map((n) => n[0]).slice(0, 2).join("");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <nav
        aria-label="Sections"
        className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card"
      >
        <div className="flex items-center gap-2.5 px-4 h-14 shrink-0">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground text-[13px] font-semibold">
            K
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">Kaduna.lk</p>
            <p className="text-xs text-muted-foreground leading-tight">Geo-Intelligence</p>
          </div>
        </div>

        <Separator />

        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 pt-2 pb-1.5 text-xs font-medium text-muted-foreground">Analysis</p>
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon, hint }) => {
              const active = section === id;
              return (
                <li key={id}>
                  <button
                    onClick={() => onSectionChange(id)}
                    aria-current={active ? "page" : undefined}
                    title={hint}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <Separator />

        <div className="p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2.5 px-2.5 h-auto py-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-medium leading-tight truncate">{account.name}</p>
                  <p className="text-xs text-muted-foreground leading-tight truncate">{account.role}</p>
                </div>
                <ChevronDown className="size-4 text-muted-foreground shrink-0" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{account.name}</p>
                <p className="text-xs text-muted-foreground">{account.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Account settings</DropdownMenuItem>
              <DropdownMenuItem disabled>Manage access</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function MobileNav({
  section,
  onSectionChange,
}: {
  section: Section;
  onSectionChange: (s: Section) => void;
}) {
  return (
    <div className="md:hidden flex gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          size="sm"
          variant={section === id ? "secondary" : "ghost"}
          onClick={() => onSectionChange(id)}
          className="shrink-0 gap-1.5"
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Live service status: where hotspot/stat data came from, whether the geo
 * service answers its health check, and whether dispatch is feeding live
 * incidents. Grey dots mean the platform is down and the static research
 * dataset is standing in — the dashboard stays honest about which one it is.
 */
export function DataSourceBadge({
  dataSource,
  geoOk,
  liveCount,
}: {
  dataSource: "api" | "static";
  geoOk: boolean;
  liveCount: number;
}) {
  const live = liveCount > 0;
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={
          dataSource === "api"
            ? "Hotspots and stats loaded from the geo-intelligence API"
            : "Geo API unreachable — showing the static dataset"
        }
      >
        <span
          className={`size-1.5 rounded-full ${dataSource === "api" ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {dataSource === "api" ? "API data" : "Static dataset"}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={geoOk ? "Geo-intelligence service is healthy" : "Geo service offline"}
      >
        <span
          className={`size-1.5 rounded-full ${geoOk ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {geoOk ? "Geo OK" : "Geo offline"}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={
          live
            ? "Receiving live incidents from the dispatch service"
            : "No live backend — showing the static dataset"
        }
      >
        <span
          className={`size-1.5 rounded-full ${live ? "animate-pulse bg-[var(--priority-high)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {live ? `Live ${liveCount}` : "Demo"}
      </Badge>
    </div>
  );
}
