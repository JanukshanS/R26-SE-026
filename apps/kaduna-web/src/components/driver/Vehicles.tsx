"use client";

import { useEffect, useState } from "react";
import { CarFront, Pencil, Phone, Plus, ShieldCheck, Star, Trash2, Wrench } from "lucide-react";

import { Badge, Card, Empty, ErrorNote, Field, Loading, Panel, Spinner, btnDanger, btnGhost, btnPrimary, btnSecondary, btnSm, inputCls, useAction, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { isValidPlate, normalizePlate } from "@/lib/plate";
import {
  FUEL_TYPES,
  VehicleApiError,
  createVehicle,
  daysUntil,
  deleteVehicle,
  insuranceExpiry,
  listInsuranceCompanies,
  saveInsurance,
  setDefaultVehicle,
  updateVehicle,
  vehicleModelLine,
  vehicleTitle,
  type FuelType,
  type InsuranceCompany,
  type Vehicle,
  type VehicleInsurance,
} from "@/lib/vehicleApi";

import type { DriverTab } from "./DriverShell";
import { PlateTag, type DriverData } from "./shared";

export default function Vehicles({ data, onGo, onEdit }: { data: DriverData; onGo: (tab: DriverTab, vehicleId?: string) => void; onEdit: (v: Vehicle | "new") => void }) {
  const t = useT();
  const { formatDate, formatNumber } = useI18n();
  const action = useAction();
  const vehicles = data.vehicles.data;

  if (data.vehicles.error) return <ErrorNote message={data.vehicles.error} onRetry={data.vehicles.reload} />;
  if (!vehicles) return <Loading />;
  if (vehicles.length === 0) {
    return (
      <Empty
        title={t("me.vehicles.emptyTitle")}
        body={t("me.vehicles.emptyBody")}
        action={
          <button type="button" onClick={() => onEdit("new")} className={btnPrimary}>
            <Plus /> {t("me.vehicles.add")}
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {action.error && <ErrorNote message={action.error} />}
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {vehicles.map((v) => {
          const ins = data.insurance[v.id];
          return (
            <Card key={v.id} as="article" className="flex flex-col p-0!">
              <div className="flex items-start gap-3 p-5 pb-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary">
                  <CarFront className="size-6" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-display text-lg font-bold">{vehicleTitle(v)}</p>
                    {v.isDefault && (
                      <Badge tone="brand" dot={false}>
                        <Star className="size-3 fill-current" /> {t("app.vehicles.defaultBadge")}
                      </Badge>
                    )}
                  </div>
                  {v.nickname && <p className="truncate text-sm text-muted-foreground">{vehicleModelLine(v)}</p>}
                  <PlateTag plate={v.plateNumber} className="mt-2" />
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-px border-y border-border bg-border text-sm">
                <Spec label={t("me.vehicles.mileage")} value={t("app.vehicles.mileage", { km: formatNumber(v.currentMileage) })} />
                <Spec label={t("me.vehicles.fuel")} value={t(`me.fuel.${v.fuelType}`)} />
                <Spec label={t("me.vehicles.colour")} value={v.color || "–"} />
              </dl>

              <div className="flex flex-1 flex-col gap-3 p-5">
                <InsuranceLine ins={ins} formatDate={formatDate} />
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <button type="button" onClick={() => onEdit(v)} className={`${btnSecondary} ${btnSm}`}>
                    <Pencil /> {t("me.action.edit")}
                  </button>
                  <button type="button" onClick={() => onGo("services", v.id)} className={`${btnSecondary} ${btnSm}`}>
                    <Wrench /> {t("me.tab.services")}
                  </button>
                  {!v.isDefault && (
                    <button
                      type="button"
                      disabled={action.busy !== null}
                      onClick={async () => {
                        const ok = await action.run(`d-${v.id}`, () => setDefaultVehicle(v.id).then(() => true));
                        if (ok) data.vehicles.reload();
                      }}
                      className={`${btnGhost} ${btnSm}`}
                    >
                      {action.busy === `d-${v.id}` ? <Spinner /> : <Star />} {t("me.vehicles.makeDefault")}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        <button
          type="button"
          onClick={() => onEdit("new")}
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-border bg-white/60 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <Plus className="size-6" /> {t("me.vehicles.add")}
        </button>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

/** Policy expiry → tone and words: expired, soon (≤ 30 days), or fine. */
export function insuranceState(ins: VehicleInsurance | undefined): { tone: Tone; days: number | null; expiry: Date | null } {
  const expiry = insuranceExpiry(ins?.expireMonth);
  if (!expiry) return { tone: "gray", days: null, expiry: null };
  const days = daysUntil(expiry);
  return { tone: days < 0 ? "bad" : days <= 30 ? "warn" : "ok", days, expiry };
}

function InsuranceLine({ ins, formatDate }: { ins: VehicleInsurance | undefined; formatDate: (d: Date, o?: Intl.DateTimeFormatOptions) => string }) {
  const t = useT();
  if (!ins?.provider && !ins?.policyNumber) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4" /> {t("me.insurance.none")}
      </p>
    );
  }
  const s = insuranceState(ins);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <ShieldCheck className="size-4 text-info" />
      <span className="font-medium">{ins.provider || t("me.insurance.title")}</span>
      {ins.policyNumber && <span className="font-mono text-xs text-muted-foreground">{ins.policyNumber}</span>}
      {s.expiry && (
        <Badge tone={s.tone}>
          {s.days! < 0 ? t("me.insurance.expired") : t("me.insurance.until", { date: formatDate(s.expiry, { month: "short", year: "numeric" }) })}
        </Badge>
      )}
    </div>
  );
}

// ─── Add / edit panel ────────────────────────────────────────────────────

/** "26/09" ↔ "2026-09" for the month input. */
const toMonthInput = (yyMm: string | null | undefined) => (yyMm?.match(/^\d{2}\/\d{2}$/) ? `20${yyMm.slice(0, 2)}-${yyMm.slice(3)}` : "");
const fromMonthInput = (v: string) => (v.match(/^\d{4}-\d{2}$/) ? `${v.slice(2, 4)}/${v.slice(5)}` : "");

export function VehiclePanel({ data, editing, onClose }: { data: DriverData; editing: Vehicle | "new" | null; onClose: () => void }) {
  const t = useT();
  const isNew = editing === "new";
  const v = editing && editing !== "new" ? editing : null;
  return (
    <Panel open={editing !== null} onClose={onClose} title={isNew ? t("me.vehicles.add") : t("me.vehicles.editTitle")} description={v ? <PlateTag plate={v.plateNumber} /> : t("me.vehicles.addSub")}>
      {editing !== null && <VehicleForm key={v?.id ?? "new"} data={data} vehicle={v} onDone={onClose} />}
    </Panel>
  );
}

function VehicleForm({ data, vehicle, onDone }: { data: DriverData; vehicle: Vehicle | null; onDone: () => void }) {
  const t = useT();
  const action = useAction();
  const ins = vehicle ? data.insurance[vehicle.id] : undefined;
  const first = (data.vehicles.data ?? []).length === 0;
  const [plate, setPlate] = useState("");
  const [fuel, setFuel] = useState<FuelType>((vehicle?.fuelType as FuelType) ?? "petrol");
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  useEffect(() => {
    listInsuranceCompanies().then(setCompanies);
  }, []);
  const plateOk = !plate || isValidPlate(plate);

  async function submit(form: FormData) {
    const s = (k: string) => String(form.get(k) ?? "").trim();
    const year = Number(s("year"));
    const input = {
      nickname: s("nickname") || null,
      make: s("make"),
      model: s("model"),
      year: year ? year : null,
      color: s("color") || null,
      currentMileage: Number(s("mileage")) || 0,
      fuelType: fuel,
      isDefault: form.get("isDefault") === "on" || first,
    };
    const insurance = { provider: s("provider") || null, policyNumber: s("policy") || null, expireMonth: fromMonthInput(s("expiry")) || null };
    const done = await action.run("save", async () => {
      try {
        const saved = vehicle ? await updateVehicle(vehicle.id, input) : await createVehicle({ ...input, plateNumber: plate });
        if (ins || insurance.provider || insurance.policyNumber || insurance.expireMonth) await saveInsurance(saved.id, insurance);
        return saved;
      } catch (err) {
        if (err instanceof VehicleApiError && err.code === "23505") {
          throw new Error(/policy/i.test(err.message) ? t("me.insurance.policyTaken") : t("me.vehicles.plateTaken"));
        }
        throw err;
      }
    });
    if (done) {
      data.vehicles.reload();
      data.reloadInsurance();
      onDone();
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
    >
      <Card className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">{t("me.vehicles.sectionVehicle")}</h3>
        {!vehicle && (
          <Field label={t("me.vehicles.plate")} hint={plate && plateOk ? t("me.vehicles.plateSaved", { plate: normalizePlate(plate) }) : t("me.vehicles.plateHint")}>
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              required
              maxLength={16}
              placeholder="CAB-1234"
              aria-invalid={!plateOk}
              className={`${inputCls} font-mono uppercase ${plateOk ? "" : "border-bad! ring-2 ring-bad/20"}`}
            />
            {!plateOk && <span className="mt-1.5 block text-xs text-bad">{t("me.vehicles.plateInvalid")}</span>}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("me.vehicles.make")}>
            <input name="make" required maxLength={60} defaultValue={vehicle?.make} placeholder="Toyota" className={inputCls} />
          </Field>
          <Field label={t("me.vehicles.model")}>
            <input name="model" required maxLength={60} defaultValue={vehicle?.model} placeholder="Aqua" className={inputCls} />
          </Field>
          <Field label={t("me.vehicles.year")}>
            <input name="year" type="number" min={1950} max={new Date().getFullYear() + 1} defaultValue={vehicle?.year} placeholder="2016" className={inputCls} />
          </Field>
          <Field label={t("me.vehicles.colour")}>
            <input name="color" maxLength={30} defaultValue={vehicle?.color} placeholder={t("me.vehicles.colourPlaceholder")} className={inputCls} />
          </Field>
          <Field label={t("me.vehicles.nickname")} hint={t("me.vehicles.nicknameHint")}>
            <input name="nickname" maxLength={40} defaultValue={vehicle?.nickname} placeholder={t("me.vehicles.nicknamePlaceholder")} className={inputCls} />
          </Field>
          <Field label={t("me.vehicles.mileageKm")}>
            <input name="mileage" type="number" min={0} max={2_000_000} required defaultValue={vehicle?.currentMileage ?? ""} placeholder="85000" className={inputCls} />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("me.vehicles.fuel")}</p>
          <div className="flex flex-wrap gap-2">
            {FUEL_TYPES.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={fuel === f}
                onClick={() => setFuel(f)}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${fuel === f ? "border-primary bg-brand-soft text-primary" : "border-border bg-white text-muted-foreground hover:text-foreground"}`}
              >
                {t(`me.fuel.${f}`)}
              </button>
            ))}
          </div>
        </div>
        {!first && !vehicle?.isDefault && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="isDefault" className="size-4 accent-primary" />
            <span>
              <span className="block font-medium">{t("me.vehicles.makeDefault")}</span>
              <span className="block text-xs text-muted-foreground">{t("me.vehicles.defaultHint")}</span>
            </span>
          </label>
        )}
        {vehicle?.isDefault && <input type="hidden" name="isDefault" value="on" />}
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">{t("me.insurance.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("me.insurance.sub")}</p>
        </div>
        <Field label={t("me.insurance.provider")}>
          <input name="provider" list="insurers" maxLength={80} defaultValue={ins?.provider ?? ""} placeholder={t("me.insurance.providerPlaceholder")} className={inputCls} />
          <datalist id="insurers">
            {companies.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("me.insurance.policy")}>
            <input name="policy" maxLength={40} defaultValue={ins?.policyNumber ?? ""} className={`${inputCls} font-mono`} />
          </Field>
          <Field label={t("me.insurance.expiry")}>
            <input name="expiry" type="month" defaultValue={toMonthInput(ins?.expireMonth)} className={inputCls} />
          </Field>
        </div>
        {ins?.provider && companies.find((c) => c.name === ins.provider)?.phone && (
          <a href={`tel:${companies.find((c) => c.name === ins.provider)!.phone}`} className={`${btnSecondary} ${btnSm}`}>
            <Phone /> {t("me.insurance.call", { insurer: ins.provider })}
          </a>
        )}
      </Card>

      {action.error && <ErrorNote message={action.error} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={action.busy !== null || (!vehicle && !plateOk)} className={`${btnPrimary} flex-1`}>
          {action.busy === "save" && <Spinner />} {vehicle ? t("garage.action.save") : t("me.vehicles.add")}
        </button>
        {vehicle && (
          <button
            type="button"
            disabled={action.busy !== null}
            onClick={async () => {
              if (!window.confirm(t("me.vehicles.removeConfirm", { vehicle: vehicleTitle(vehicle) }))) return;
              const ok = await action.run("delete", () => deleteVehicle(vehicle.id).then(() => true));
              if (ok) {
                data.vehicles.reload();
                onDone();
              }
            }}
            className={btnDanger}
          >
            {action.busy === "delete" ? <Spinner /> : <Trash2 />} {t("me.vehicles.remove")}
          </button>
        )}
      </div>
    </form>
  );
}
