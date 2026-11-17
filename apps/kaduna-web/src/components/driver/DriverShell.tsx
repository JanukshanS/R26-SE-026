"use client";

import Link from "next/link";
import { CarFront, ChevronDown, LayoutDashboard, LifeBuoy, LogOut, PackageCheck, ShieldCheck, Siren, UserRound, Warehouse, Wrench, type LucideIcon } from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { Avatar } from "@/components/garage/ui";
import { areasFor, useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { vehicleTitle, type Vehicle } from "@/lib/vehicleApi";
import { BrandLogo } from "@/components/brand/BrandLogo";

// Vehicle health and trips are parked for now (components/driver/Health.tsx
// and Trips.tsx are kept); old #health / #trips links fall back to overview.
export type DriverTab = "overview" | "vehicles" | "garage" | "services" | "pickups" | "requests" | "claims" | "profile";
export const DRIVER_TABS: DriverTab[] = ["overview", "vehicles", "garage", "services", "pickups", "requests", "claims", "profile"];

const ICONS: Record<DriverTab, LucideIcon> = {
  overview: LayoutDashboard,
  vehicles: CarFront,
  garage: Warehouse,
  services: Wrench,
  pickups: PackageCheck,
  requests: LifeBuoy,
  claims: ShieldCheck,
  profile: UserRound,
};

const NAV: { group: string; tabs: DriverTab[] }[] = [
  { group: "car", tabs: ["overview", "vehicles", "garage", "services", "pickups"] },
  { group: "help", tabs: ["requests", "claims"] },
  { group: "account", tabs: ["profile"] },
];

/**
 * The driver portal frame: the garage workspace's layout (left sidebar that
 * becomes a scrolling tab row on phones, top bar with the page title) so the
 * two read as one product. Sections live in the URL hash.
 */
export default function DriverShell({
  tab,
  name,
  liveCount = 0,
  title,
  subtitle,
  actions,
  vehicles,
  selected,
  onSelect,
  children,
}: {
  /** The member's cars, for the switcher in the top bar (hidden with fewer than two). */
  vehicles?: Vehicle[] | null;
  selected?: Vehicle | null;
  onSelect?: (id: string) => void;
  tab: DriverTab;
  name: string | null;
  /** Breakdown requests still in progress: shown on the nav item and the help card. */
  liveCount?: number;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const { session, profile } = useAuth();
  const otherAreas = areasFor(profile).filter((a) => a.href !== "/app" && a.href !== "/#get-help");
  const email = session?.user.email ?? "";

  const navItem = (key: DriverTab, compact = false) => {
    const on = key === tab;
    const Icon = ICONS[key];
    return (
      <a
        key={key}
        href={`#${key}`}
        aria-current={on ? "page" : undefined}
        className={
          compact
            ? `flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-canvas"}`
            : `flex items-center gap-3.5 rounded-xl px-4 py-2.5 text-sm transition ${
                on ? "bg-primary font-semibold text-primary-foreground shadow-[0_8px_18px_-4px_rgba(236,85,0,.35)]" : "font-medium text-muted-foreground hover:bg-canvas hover:text-foreground"
              }`
        }
      >
        <Icon className={compact ? "size-4" : "size-[21px]"} strokeWidth={1.75} />
        {t(`me.tab.${key}`)}
        {key === "requests" && liveCount > 0 && (
          <span className={`ml-auto rounded-full px-1.5 text-[11px] font-semibold leading-[18px] ${on ? "bg-white text-primary" : "bg-bad text-white"}`}>{liveCount}</span>
        )}
      </a>
    );
  };

  return (
    <div className="min-h-screen bg-canvas text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-border bg-white px-5 pb-6 pt-7 lg:flex">
        <Link href="/" className="flex flex-col gap-1 pb-6 pl-2" aria-label="Kaduna.lk">
          <BrandLogo height={52} className="self-start" />
          <span className="text-xs font-medium text-primary">{t("me.shell.product")}</span>
        </Link>
        <nav aria-label={t("me.shell.product")} className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {NAV.map((g) => (
            <div key={g.group} className="mb-2">
              <p className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t(`me.navGroup.${g.group}`)}</p>
              {g.tabs.map((key) => navItem(key))}
            </div>
          ))}
        </nav>
        <Link href="/#get-help" className="mb-2 mt-2 flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-white" style={{ background: "linear-gradient(135deg,#f56b1a,#d94500)" }}>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20">
            <Siren className="size-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t("me.shell.helpTitle")}</span>
            <span className="block text-xs leading-4 opacity-90">{liveCount > 0 ? t("me.shell.helpLive", { n: liveCount }) : t("me.shell.helpIdle")}</span>
          </span>
        </Link>
        {otherAreas.length > 0 && (
          <div className="mb-2 mt-3 flex flex-wrap gap-1.5 px-2">
            {otherAreas.map((a) => (
              <Link key={a.href} href={a.href} className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                {a.label}
              </Link>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-canvas hover:text-foreground"
        >
          <LogOut className="size-[21px]" strokeWidth={1.75} />
          {t("portal.action.signOut")}
        </button>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex items-center gap-4 px-4 py-3 sm:px-8 lg:h-[88px] lg:py-0">
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Kaduna.lk">
              <BrandLogo height={36} />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-bold leading-tight sm:text-[28px] sm:leading-9">{title}</h1>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            {vehicles && vehicles.length > 1 && selected && onSelect && <VehicleSwitcher vehicles={vehicles} selected={selected} onSelect={onSelect} className="hidden sm:flex" />}
            {actions && <div className="hidden items-center gap-2 md:flex">{actions}</div>}
            <div className="hidden sm:block">
              <LanguagePicker />
            </div>
            <div className="hidden items-center gap-3 xl:flex">
              <Avatar name={name || email} tone="brand" />
              <div className="max-w-[200px] leading-tight">
                <p className="truncate text-sm font-semibold">{name || t("me.shell.driver")}</p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
            </div>
            <Link href="/#get-help" className="grid size-9 place-items-center rounded-xl bg-bad text-white lg:hidden" aria-label={t("me.shell.helpTitle")}>
              <Siren className="size-4" />
            </Link>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground lg:hidden"
              aria-label={t("portal.action.signOut")}
            >
              <LogOut className="size-4" />
            </button>
          </div>
          {vehicles && vehicles.length > 1 && selected && onSelect && (
            <div className="px-4 pb-3 sm:hidden">
              <VehicleSwitcher vehicles={vehicles} selected={selected} onSelect={onSelect} className="flex w-full" />
            </div>
          )}
          <nav aria-label={t("me.shell.product")} className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-8 lg:hidden">
            {DRIVER_TABS.map((key) => navItem(key, true))}
          </nav>
          {actions && <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-8 md:hidden">{actions}</div>}
        </header>

        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * Which car the dashboard is about. The choice is remembered on this device
 * and every vehicle section (overview, garage visits, service history) follows it.
 */
function VehicleSwitcher({ vehicles, selected, onSelect, className = "" }: { vehicles: Vehicle[]; selected: Vehicle; onSelect: (id: string) => void; className?: string }) {
  const t = useT();
  return (
    <label className={`relative min-w-0 items-center gap-2.5 rounded-xl border border-border bg-white py-1.5 pl-2 pr-8 hover:bg-canvas ${className}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-primary">
        <CarFront className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[11px] font-medium text-muted-foreground">{t("me.switcher.label")}</span>
        <span className="block max-w-[200px] truncate text-sm font-semibold">
          {vehicleTitle(selected)} <span className="font-mono text-xs font-normal text-muted-foreground">{selected.plateNumber}</span>
        </span>
      </span>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      {/* The real control: native, so it works with keyboards, screen readers and phones. */}
      <select
        value={selected.id}
        onChange={(e) => onSelect(e.target.value)}
        aria-label={t("me.switcher.label")}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {vehicleTitle(v)} · {v.plateNumber}
          </option>
        ))}
      </select>
    </label>
  );
}
