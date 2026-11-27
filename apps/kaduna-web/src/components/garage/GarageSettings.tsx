"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Eye, ImagePlus, Trash2, Wrench } from "lucide-react";

import { saveGarage, type Garage } from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

import { BrandFooter, BrandHeader, DEFAULT_BRAND_COLOR, type Brand } from "./InvoiceBrand";
import { Card, CardHeader, ErrorNote, Field, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useMoney } from "./ui";

const SWATCHES = ["#ec5500", "#d92d20", "#0f766e", "#2f6feb", "#6d28d9", "#111827"];
const LOGO_MAX_PX = 320;

/**
 * Shrinks a chosen image to at most 320 px and re-encodes it, so the logo
 * stored with the garage stays a few tens of KB however big the original was.
 */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("bad image"));
      el.src = url;
    });
    const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparent backgrounds; a photo-like logo is smaller as JPEG.
    const png = canvas.toDataURL("image/png");
    return png.length < 150_000 ? png : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** First-run setup and, later, the settings tab. Same form, same endpoint (PUT /garage). */
export default function GarageSettings({ garage, onSaved }: { garage: Garage | null; onSaved: (g: Garage) => void }) {
  const t = useT();
  const money = useMoney();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Mirrors the form for the live invoice preview.
  const [draft, setDraft] = useState({
    name: garage?.name ?? "",
    phone: garage?.phone ?? "",
    address: garage?.address ?? "",
    labourRate: garage?.labourRate ?? 0,
    taxRate: garage?.taxRate ?? 0,
    email: garage?.email ?? "",
    registrationNo: garage?.registrationNo ?? "",
    invoiceTerms: garage?.invoiceTerms ?? "",
    invoiceFooter: garage?.invoiceFooter ?? "",
    bankDetails: garage?.bankDetails ?? "",
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(garage?.logoUrl ?? null);
  const [color, setColor] = useState(garage?.brandColor ?? DEFAULT_BRAND_COLOR);
  const currency = garage?.currency ?? "LKR";

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveGarage({
        name: text(form.get("name")) ?? "",
        phone: text(form.get("phone")),
        address: text(form.get("address")),
        labourRate: num(form.get("labourRate")) ?? 0,
        taxRate: num(form.get("taxRate")) ?? 0,
        ...(garage && {
          email: text(form.get("email")),
          registrationNo: text(form.get("registrationNo")),
          invoiceTerms: text(form.get("invoiceTerms")),
          invoiceFooter: text(form.get("invoiceFooter")),
          bankDetails: text(form.get("bankDetails")),
          logoUrl,
          brandColor: color.toLowerCase() === DEFAULT_BRAND_COLOR ? null : color,
        }),
      });
      setSaved(true);
      onSaved(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => ({ ...d, [k]: k === "labourRate" || k === "taxRate" ? Number(e.target.value) || 0 : e.target.value }));
  const sample = 2 * draft.labourRate + 12_800;
  const tax = Math.round(sample * draft.taxRate) / 100;
  const brand: Brand = {
    name: draft.name || t("garage.field.garageName"),
    phone: draft.phone || null,
    address: draft.address || null,
    email: draft.email || null,
    registrationNo: draft.registrationNo || null,
    logoUrl,
    brandColor: color,
    invoiceTerms: draft.invoiceTerms || null,
    invoiceFooter: draft.invoiceFooter || null,
    bankDetails: draft.bankDetails || null,
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
      >
        <Card>
          {!garage && (
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <Wrench className="size-6" strokeWidth={1.75} />
            </span>
          )}
          <CardHeader title={garage ? t("garage.settings.title") : t("garage.setup.title")} sub={garage ? t("garage.settings.body") : t("garage.setup.body")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("garage.field.garageName")} className="sm:col-span-2">
              <input name="name" required maxLength={160} defaultValue={garage?.name ?? ""} onChange={set("name")} className={inputCls} />
            </Field>
            <Field label={t("garage.field.phone")}>
              <input name="phone" type="tel" maxLength={40} defaultValue={garage?.phone ?? ""} onChange={set("phone")} className={inputCls} />
            </Field>
            <Field label={t("garage.field.address")}>
              <input name="address" maxLength={500} defaultValue={garage?.address ?? ""} onChange={set("address")} className={inputCls} />
            </Field>
            <Field label={t("garage.field.labourRate")} hint={t("garage.field.labourRateHint")}>
              <input name="labourRate" type="number" min={0} step="0.01" defaultValue={garage?.labourRate ?? 0} onChange={set("labourRate")} className={inputCls} />
            </Field>
            <Field label={t("garage.field.taxRate")} hint={t("garage.field.taxRateHint")}>
              <input name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={garage?.taxRate ?? 0} onChange={set("taxRate")} className={inputCls} />
            </Field>
          </div>
        </Card>

        {garage && (
          <Card>
            <CardHeader title={t("garage.brand.title")} sub={t("garage.brand.sub")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("garage.brand.logo")}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-16 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-canvas">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {logoUrl ? <img src={logoUrl} alt="" className="size-full object-contain" /> : <ImagePlus className="size-6 text-muted-foreground" />}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label={t("garage.brand.upload")}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        setLogoUrl(await shrinkLogo(file));
                        setError(null);
                      } catch {
                        setError(t("garage.brand.badImage"));
                      }
                    }}
                  />
                  <button type="button" onClick={() => fileRef.current?.click()} className={`${btnSecondary} ${btnSm}`}>
                    <ImagePlus /> {logoUrl ? t("garage.brand.replace") : t("garage.brand.upload")}
                  </button>
                  {logoUrl && (
                    <button type="button" onClick={() => setLogoUrl(null)} className={`${btnSecondary} ${btnSm}`}>
                      <Trash2 /> {t("garage.action.remove")}
                    </button>
                  )}
                  <span className="w-full text-xs text-muted-foreground">{t("garage.brand.logoHint")}</span>
                </div>
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("garage.brand.color")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={color.toLowerCase() === c}
                      onClick={() => setColor(c)}
                      className={`size-8 rounded-full ring-offset-2 transition ${color.toLowerCase() === c ? "ring-2 ring-foreground" : ""}`}
                      style={{ background: c }}
                    />
                  ))}
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("garage.brand.custom")} className="h-8 w-12 cursor-pointer rounded-lg border border-border bg-white" />
                </div>
              </div>
              <Field label={t("garage.field.email")}>
                <input name="email" type="email" maxLength={200} defaultValue={garage.email ?? ""} onChange={set("email")} className={inputCls} />
              </Field>
              <Field label={t("garage.brand.registration")}>
                <input name="registrationNo" maxLength={80} defaultValue={garage.registrationNo ?? ""} onChange={set("registrationNo")} placeholder="PV 00123456" className={inputCls} />
              </Field>
              <Field label={t("garage.brand.terms")} className="sm:col-span-2">
                <textarea name="invoiceTerms" rows={2} maxLength={1000} defaultValue={garage.invoiceTerms ?? ""} onChange={set("invoiceTerms")} placeholder={t("garage.brand.termsPlaceholder")} className={inputCls} />
              </Field>
              <Field label={t("garage.brand.bank")} className="sm:col-span-2">
                <textarea name="bankDetails" rows={2} maxLength={500} defaultValue={garage.bankDetails ?? ""} onChange={set("bankDetails")} placeholder={t("garage.brand.bankPlaceholder")} className={inputCls} />
              </Field>
              <Field label={t("garage.brand.footer")} className="sm:col-span-2">
                <input name="invoiceFooter" maxLength={500} defaultValue={garage.invoiceFooter ?? ""} onChange={set("invoiceFooter")} placeholder={t("garage.invoice.thanks")} className={inputCls} />
              </Field>
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy && <Spinner />} {garage ? t("garage.action.save") : t("garage.setup.submit")}
          </button>
          {saved && garage && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-ok">
              <CheckCircle2 className="size-4" />
              {t("garage.settings.saved")}
            </span>
          )}
          {error && (
            <div className="w-full">
              <ErrorNote message={error} />
            </div>
          )}
        </div>
      </form>

      <div className="xl:sticky xl:top-28 xl:self-start">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Eye className="size-4 text-muted-foreground" />
          {t("garage.settings.preview")}
        </p>
        <div className="overflow-hidden rounded-[20px] bg-white text-[12px] shadow-[0_12px_32px_rgba(41,31,24,.12)]">
          <div className="h-1.5" style={{ background: color }} />
          <div className="space-y-4 p-6">
            <BrandHeader brand={brand}>
              <p className="font-display text-lg font-bold uppercase" style={{ color }}>{t("garage.invoice.heading")}</p>
              <p className="font-mono">INV-1001</p>
            </BrandHeader>
            <div className="space-y-1.5">
              <div className="flex justify-between border-b border-border pb-1.5 font-medium text-muted-foreground">
                <span>{t("garage.field.description")}</span>
                <span>{t("garage.invoice.amount")}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("garage.settings.sampleLabour")}</span>
                <span className="tabular-nums">{money(2 * draft.labourRate, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("garage.settings.samplePart")}</span>
                <span className="tabular-nums">{money(12_800, currency)}</span>
              </div>
              {draft.taxRate > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("garage.invoice.tax")} ({draft.taxRate}%)</span>
                  <span className="tabular-nums">{money(tax, currency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t-2 border-foreground pt-2 font-display text-sm font-bold">
                <span>{t("garage.invoice.total")}</span>
                <span className="tabular-nums">{money(sample + tax, currency)}</span>
              </div>
            </div>
            <BrandFooter brand={brand} />
          </div>
        </div>
      </div>
    </div>
  );
}
