"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createGarage,
  createPart,
  deleteGarage,
  deletePart,
  formatLkr,
  listGarages,
  listParts,
  type ComponentKey,
  type GarageInput,
  type GarageRecord,
  type PartInput,
  type PartRecord,
} from "@/lib/marketplaceApi";
import { useT } from "@/lib/i18n";

const COMPONENTS: ComponentKey[] = ["engine", "brake", "tire", "battery"];

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded border border-red-300 px-3 py-1 font-medium">
        {t("admin.action.retry")}
      </button>
    </div>
  );
}

export function PartsTab() {
  const t = useT();
  const [rows, setRows] = useState<PartRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ComponentKey | "">("");
  const [form, setForm] = useState<PartInput>({
    name: "",
    component: "brake",
    price_lkr: 0,
    vehicle_compatibility: [],
    in_stock: true,
  });
  const [compatText, setCompatText] = useState("");

  const reload = useCallback(() => {
    setError(null);
    listParts(filter || undefined).then(setRows, (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [filter]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createPart({
        ...form,
        vehicle_compatibility: compatText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setForm({ name: "", component: form.component, price_lkr: 0, in_stock: true });
      setCompatText("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: string) {
    if (!confirm(t("admin.parts.deleteConfirm"))) return;
    try {
      await deletePart(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      {error ? <ErrorCard message={error} onRetry={reload} /> : null}

      <form onSubmit={onCreate} className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
        <h3 className="font-display text-lg font-semibold md:col-span-2">{t("admin.parts.formTitle")}</h3>
        <div className="space-y-2">
          <Label htmlFor="part-name">{t("admin.parts.fieldName")}</Label>
          <Input id="part-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="part-component">{t("admin.parts.fieldComponent")}</Label>
          <select
            id="part-component"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.component}
            onChange={(e) => setForm({ ...form, component: e.target.value as ComponentKey })}
          >
            {COMPONENTS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="part-price">{t("admin.parts.fieldPrice")}</Label>
          <Input
            id="part-price"
            type="number"
            min={1}
            value={form.price_lkr || ""}
            onChange={(e) => setForm({ ...form, price_lkr: Number(e.target.value) })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="part-brand">{t("admin.parts.fieldBrand")}</Label>
          <Input id="part-brand" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="part-compat">{t("admin.parts.fieldCompatibility")}</Label>
          <Input id="part-compat" value={compatText} onChange={(e) => setCompatText(e.target.value)} placeholder="Toyota Aqua, Honda City" />
        </div>
        <div className="md:col-span-2">
          <Button type="submit">{t("admin.parts.submit")}</Button>
        </div>
      </form>

      <div className="flex items-center gap-3">
        <Label htmlFor="part-filter">{t("admin.parts.filterLabel")}</Label>
        <select
          id="part-filter"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ComponentKey | "")}
        >
          <option value="">{t("admin.parts.filterAll")}</option>
          {COMPONENTS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {!rows ? (
        <p className="text-sm text-muted-foreground">{t("admin.parts.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.parts.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.parts.colName")}</TableHead>
                <TableHead>{t("admin.parts.colComponent")}</TableHead>
                <TableHead>{t("admin.parts.colPrice")}</TableHead>
                <TableHead>{t("admin.parts.colStock")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    {row.brand ? <div className="text-xs text-muted-foreground">{row.brand}</div> : null}
                  </TableCell>
                  <TableCell>{row.component}</TableCell>
                  <TableCell>{formatLkr(row.price_lkr)}</TableCell>
                  <TableCell>{row.in_stock ? t("admin.parts.inStock") : t("admin.parts.outOfStock")}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline" size="sm" onClick={() => onDelete(row.id)}>
                      {t("admin.action.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function GaragesTab() {
  const t = useT();
  const [rows, setRows] = useState<GarageRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GarageInput>({ name: "", city: "", services: [], verified: false });
  const [servicesText, setServicesText] = useState("Oil Change, Brake Service");

  const reload = useCallback(() => {
    setError(null);
    listGarages().then(setRows, (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createGarage({
        ...form,
        services: servicesText.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setForm({ name: "", city: "", verified: false });
      setServicesText("Oil Change, Brake Service");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: string) {
    if (!confirm(t("admin.garages.deleteConfirm"))) return;
    try {
      await deleteGarage(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      {error ? <ErrorCard message={error} onRetry={reload} /> : null}

      <form onSubmit={onCreate} className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
        <h3 className="font-display text-lg font-semibold md:col-span-2">{t("admin.garages.formTitle")}</h3>
        <div className="space-y-2">
          <Label htmlFor="garage-name">{t("admin.garages.fieldName")}</Label>
          <Input id="garage-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="garage-city">{t("admin.garages.fieldCity")}</Label>
          <Input id="garage-city" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="garage-address">{t("admin.garages.fieldAddress")}</Label>
          <Input id="garage-address" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="garage-services">{t("admin.garages.fieldServices")}</Label>
          <Input id="garage-services" value={servicesText} onChange={(e) => setServicesText(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button type="submit">{t("admin.garages.submit")}</Button>
        </div>
      </form>

      {!rows ? (
        <p className="text-sm text-muted-foreground">{t("admin.garages.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.garages.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.garages.colName")}</TableHead>
                <TableHead>{t("admin.garages.colCity")}</TableHead>
                <TableHead>{t("admin.garages.colServices")}</TableHead>
                <TableHead>{t("admin.garages.colRating")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.city ?? "—"}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate">{row.services_raw ?? row.services.join(", ")}</div>
                    {/* A garage is matched to a driver by the COMPONENTS its
                        services map onto, not by the service names themselves.
                        With none mapped it is stored fine and then never
                        appears anywhere in the app - which is invisible from
                        here without saying so. The seeder prints the same
                        warning for the same reason. */}
                    {row.services.length === 0 ? (
                      <div className="text-xs text-amber-600 mt-1">
                        {t("admin.garages.unmatchedServices")}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.rating != null ? row.rating.toFixed(1) : "—"}</TableCell>
                  <TableCell>
                    <Button type="button" variant="outline" size="sm" onClick={() => onDelete(row.id)}>
                      {t("admin.action.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
