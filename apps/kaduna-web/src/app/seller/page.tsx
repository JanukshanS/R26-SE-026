"use client";

/**
 * The parts shop system (the parts-management service). Any Kaduna account
 * can open a shop here; it's live as soon as it's set up. The owner adds
 * staff by email, and each person sees the tabs their role can use: the
 * counter and cash drawer, inventory and stocktakes, purchasing and supplier
 * bills, garage orders and accounts, reports, staff and the activity log.
 */
import { useCallback, useEffect, useState } from "react";

import GarageShell, { type GarageTab } from "@/components/garage/GarageShell";
import { ErrorNote, Loading, useLoad } from "@/components/garage/ui";
import { ShopAccessProvider } from "@/components/parts/shop/access";
import Accounts from "@/components/parts/shop/Accounts";
import CashDrawer from "@/components/parts/shop/CashDrawer";
import CounterSale from "@/components/parts/shop/CounterSale";
import Inventory from "@/components/parts/shop/Inventory";
import PartPage from "@/components/parts/shop/PartPage";
import Payables from "@/components/parts/shop/Payables";
import Purchasing from "@/components/parts/shop/Purchasing";
import ShopHome, { type ShopTab } from "@/components/parts/shop/ShopHome";
import ShopOrders from "@/components/parts/shop/ShopOrders";
import ShopReports from "@/components/parts/shop/ShopReports";
import ShopSettings from "@/components/parts/shop/ShopSettings";
import Stocktake from "@/components/parts/shop/Stocktake";
import { Activity, Staff } from "@/components/parts/shop/Team";
import Warranty from "@/components/parts/shop/Warranty";
import RequireAuth from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { getMyShop, getPartsMe, type PartsMe, type Permission } from "@/lib/partsApi";

/** Each tab and the permissions that open it (any of them). Empty: everyone at the shop. */
const TAB_NEEDS: Record<ShopTab, Permission[]> = {
  overview: ["reports"],
  sale: ["sell"],
  cash: ["sell", "cash"],
  warranty: ["sell", "reports", "purchasing"],
  inventory: [],
  stocktake: ["stock"],
  purchases: ["purchasing"],
  payables: ["purchasing"],
  orders: ["orders"],
  accounts: ["payments", "accounts"],
  reports: ["reports"],
  staff: ["staff"],
  activity: ["reports"],
  shop: [],
};
const TABS = Object.keys(TAB_NEEDS) as ShopTab[];
const NAV: { group: string; tabs: ShopTab[] }[] = [
  { group: "counter", tabs: ["overview", "sale", "cash", "warranty"] },
  { group: "stock", tabs: ["inventory", "stocktake", "purchases", "payables"] },
  { group: "trade", tabs: ["orders", "accounts"] },
  { group: "business", tabs: ["reports", "staff", "activity", "shop"] },
];

const allowed = (me: PartsMe | null, tab: ShopTab) => !me?.role || TAB_NEEDS[tab].length === 0 || TAB_NEEDS[tab].some((p) => me.permissions.includes(p));
/** Where each role starts: the owner and managers on the dashboard, cashiers at the counter, storekeepers in the stockroom. */
const home = (me: PartsMe | null): ShopTab => (allowed(me, "overview") ? "overview" : allowed(me, "sale") ? "sale" : "inventory");

/** #inventory, #sale… or #part/<id> for one part's page (shown under Inventory). */
function useHashTab(me: PartsMe | null): [ShopTab, (t: ShopTab) => void, string | null] {
  const [tab, setTab] = useState<ShopTab>("overview");
  const [partId, setPartId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.slice(1);
      if (raw.startsWith("part/")) {
        setPartId(decodeURIComponent(raw.slice(5)));
        setTab("inventory");
        return;
      }
      setPartId(null);
      const h = raw as ShopTab;
      setTab(TABS.includes(h) && allowed(me, h) ? h : home(me));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [me]);
  const go = useCallback((next: ShopTab) => {
    if (window.location.hash === `#${next}`) setTab(next);
    else window.location.hash = next;
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, go, partId];
}

function ShopPortal() {
  const t = useT();
  const shop = useLoad(getMyShop, []);
  const me = useLoad(getPartsMe, [shop.data?.id]);
  const [tab, go, partId] = useHashTab(me.data);
  const s = shop.data ?? null;

  let body: React.ReactNode;
  if (shop.error) body = <ErrorNote message={shop.error} onRetry={shop.reload} />;
  else if (me.error && s) body = <ErrorNote message={me.error} onRetry={me.reload} />;
  else if ((shop.loading && !shop.data) || (s && !me.data)) body = <Loading />;
  else if (!s) body = <ShopSettings shop={null} onSaved={(next) => { shop.setData(next); go("inventory"); }} />;
  else if (partId) body = <PartPage key={partId} shop={s} partId={partId} onBack={() => (window.history.length > 1 ? window.history.back() : go("inventory"))} onOpen={(id) => (window.location.hash = `part/${id}`)} />;
  else if (tab === "sale") body = <CounterSale shop={s} />;
  else if (tab === "cash") body = <CashDrawer shop={s} />;
  else if (tab === "warranty") body = <Warranty shop={s} />;
  else if (tab === "inventory") body = <Inventory shop={s} />;
  else if (tab === "stocktake") body = <Stocktake shop={s} />;
  else if (tab === "purchases") body = <Purchasing shop={s} />;
  else if (tab === "payables") body = <Payables shop={s} />;
  else if (tab === "orders") body = <ShopOrders shop={s} />;
  else if (tab === "accounts") body = <Accounts shop={s} />;
  else if (tab === "reports") body = <ShopReports shop={s} />;
  else if (tab === "staff") body = <Staff shop={s} />;
  else if (tab === "activity") body = <Activity shop={s} />;
  else if (tab === "shop") body = <ShopSettings key={s.id} shop={s} onSaved={shop.setData} />;
  else body = <ShopHome shop={s} onGo={go} />;

  const nav = NAV.map((g) => ({ group: g.group, tabs: g.tabs.filter((x) => allowed(me.data, x)) as GarageTab[] })).filter((g) => g.tabs.length);
  const role = me.data?.role;

  return (
    <ShopAccessProvider me={me.data ?? { shop: null, role: null, name: null, permissions: [], hasPin: false }}>
      <GarageShell
        tab={s ? tab : "shop"}
        garageName={s?.name ?? null}
        showNav={s !== null}
        nav={nav}
        here="/seller"
        product={role && role !== "OWNER" ? `${t("parts.seller.product")} · ${t(`shop.role.${role}`)}` : t("parts.seller.product")}
        title={s ? (partId ? t("shop.part.title") : tab === "overview" ? t("garage.tab.dashboard") : t(`shop.tab.${tab}`)) : t("parts.shop.setupTitle")}
        subtitle={s ? (partId ? t("shop.part.sub") : t(`shop.sub.${tab}`, { shop: s.name })) : undefined}
        tabLabel={(k) => t(`shop.tab.${k}`)}
      >
        {body}
      </GarageShell>
    </ShopAccessProvider>
  );
}

export default function SellerPage() {
  return (
    <RequireAuth>
      <ShopPortal />
    </RequireAuth>
  );
}
