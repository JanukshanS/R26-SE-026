"use client";

import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  HardHat,
  LayoutDashboard,
  LogOut,
  Package,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Receipt,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Siren,
  Store,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  Banknote,
  FileText,
  History,
  ListChecks,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { areasFor, useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

import { Avatar } from "./ui";
import { BrandLogo } from "@/components/brand/BrandLogo";

export type GarageTab =
  | "overview"
  | "kaduna"
  | "appointments"
  | "jobs"
  | "inspections"
  | "customers"
  | "inventory"
  | "suppliers"
  | "invoices"
  | "staff"
  | "reports"
  | "settings"
  // Parts: the owner's orders and sellers, a mechanic's pickups, and a parts shop's own tabs (/seller).
  | "parts"
  | "pickups"
  | "sale"
  | "purchases"
  | "orders"
  | "accounts"
  | "shop"
  | "cash"
  | "stocktake"
  | "payables"
  | "activity"
  | "warranty"
  // The garage's own stock-keeping and equipment.
  | "purchaseorders"
  | "stockcounts"
  | "assets"
  | "held";

const ICONS: Record<GarageTab, LucideIcon> = {
  parts: ShoppingCart,
  pickups: PackageCheck,
  sale: ScanBarcode,
  purchases: PackagePlus,
  orders: Warehouse,
  accounts: Wallet,
  shop: Store,
  cash: Banknote,
  stocktake: ListChecks,
  payables: FileText,
  activity: History,
  warranty: ShieldCheck,
  purchaseorders: PackagePlus,
  stockcounts: ListChecks,
  assets: Wrench,
  held: PackageOpen,
  overview: LayoutDashboard,
  kaduna: Siren,
  appointments: CalendarDays,
  jobs: ClipboardList,
  inspections: ClipboardCheck,
  customers: Users,
  inventory: Package,
  suppliers: Truck,
  invoices: Receipt,
  staff: HardHat,
  reports: BarChart3,
  settings: Settings,
};

/** The owner's sidebar, in groups. Mechanics get a short list of their own (see /workshop). */
export const OWNER_NAV: { group: string; tabs: GarageTab[] }[] = [
  { group: "workshop", tabs: ["overview", "kaduna", "appointments", "jobs", "inspections", "customers"] },
  { group: "stock", tabs: ["inventory", "purchaseorders", "parts", "stockcounts", "assets", "held", "suppliers"] },
  { group: "business", tabs: ["invoices", "reports", "staff", "settings"] },
];

/**
 * The garage workspace frame: a left sidebar (collapses to a scrolling tab row
 * on small screens) and a top bar with the page title. Sections live in the
 * URL hash, so every nav item is a plain anchor.
 */
export default function GarageShell({
  tab,
  garageName,
  showNav,
  kadunaCount = 0,
  nav = OWNER_NAV,
  product,
  here = "/provider/garage",
  tabLabel,
  title,
  subtitle,
  actions,
  children,
}: {
  /** This area's own link, left out of the "other areas" list. */
  here?: string;
  /** Labels for the nav items; defaults to the garage's (garage.tab.*). */
  tabLabel?: (tab: GarageTab) => string;
  tab: GarageTab;
  garageName: string | null;
  showNav: boolean;
  kadunaCount?: number;
  nav?: { group: string; tabs: GarageTab[] }[];
  /** Under the logo; defaults to "Garage system". */
  product?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const { session, profile } = useAuth();
  const otherAreas = areasFor(profile).filter((a) => a.href !== here);
  const flat = nav.flatMap((g) => g.tabs);
  const showLive = flat.includes("kaduna");
  const email = session?.user.email ?? "";

  const navItem = (key: GarageTab, compact = false) => {
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
        {tabLabel ? tabLabel(key) : t(`garage.tab.${key}`)}
        {key === "kaduna" && kadunaCount > 0 && (
          <span className={`ml-auto rounded-full px-1.5 text-[11px] font-semibold leading-[18px] ${on ? "bg-white text-primary" : "bg-bad text-white"}`}>{kadunaCount}</span>
        )}
      </a>
    );
  };

  return (
    <div className="min-h-screen bg-canvas text-foreground lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-border bg-white px-5 pb-6 pt-7 lg:flex">
        <Link href="/" className="flex flex-col gap-1 pb-6 pl-2" aria-label="Kaduna.lk">
          <BrandLogo height={52} className="self-start" />
          <span className="text-xs font-medium text-primary">{product ?? t("garage.shell.product")}</span>
        </Link>
        {showNav && (
          <nav aria-label={t("garage.title")} className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
            {nav.map((g) => (
              <div key={g.group} className="mb-2">
                {nav.length > 1 && <p className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t(`garage.navGroup.${g.group}`)}</p>}
                {g.tabs.map((key) => navItem(key))}
              </div>
            ))}
          </nav>
        )}
        {!showNav && <div className="flex-1" />}
        {showNav && showLive && (
          <a href="#kaduna" className="mb-2 mt-2 flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-white" style={{ background: "linear-gradient(135deg,#f56b1a,#d94500)" }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20">
              <Siren className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("garage.shell.liveTitle")}</span>
              <span className="block text-xs leading-4 opacity-90">
                {kadunaCount > 0 ? t("garage.shell.liveOffers", { n: kadunaCount }) : t("garage.shell.liveIdle")}
              </span>
            </span>
          </a>
        )}
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
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex items-center gap-4 px-4 py-3 sm:px-8 lg:h-[88px] lg:py-0">
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Kaduna.lk">
              <BrandLogo height={36} />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-bold leading-tight sm:text-[28px] sm:leading-9">{title}</h1>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="hidden items-center gap-2 md:flex">{actions}</div>}
            <div className="hidden sm:block">
              <LanguagePicker />
            </div>
            <div className="hidden items-center gap-3 xl:flex">
              <Avatar name={garageName ?? email} tone="brand" />
              <div className="max-w-[200px] leading-tight">
                <p className="truncate text-sm font-semibold">{garageName ?? t("garage.title")}</p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground lg:hidden"
              aria-label={t("portal.action.signOut")}
            >
              <LogOut className="size-4" />
            </button>
          </div>
          {showNav && (
            <nav aria-label={t("garage.title")} className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-8 lg:hidden">
              {flat.map((key) => navItem(key, true))}
            </nav>
          )}
          {actions && <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-8 md:hidden">{actions}</div>}
        </header>

        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
