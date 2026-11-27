"use client";

/** The garage's own branding on invoices: logo, accent colour, business details, terms and bank details. */
import type { Garage } from "@/lib/garageApi";
import { useT } from "@/lib/i18n";

import { Avatar } from "./ui";

export type Brand = Pick<Garage, "name" | "phone" | "address" | "email" | "registrationNo" | "logoUrl" | "brandColor" | "invoiceTerms" | "invoiceFooter" | "bankDetails">;

export const DEFAULT_BRAND_COLOR = "#ec5500";
export const brandColor = (b: Pick<Brand, "brandColor">) => b.brandColor || DEFAULT_BRAND_COLOR;

export function BrandLogo({ brand, size = "lg" }: { brand: Pick<Brand, "name" | "logoUrl">; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "size-14" : "size-10";
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL or external logo, not an optimisable asset
  return brand.logoUrl ? <img src={brand.logoUrl} alt="" className={`${dims} shrink-0 rounded-xl object-contain`} /> : <Avatar name={brand.name || "?"} tone="gray" size={size} />;
}

export function BrandHeader({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <BrandLogo brand={brand} />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{brand.name}</p>
          {brand.address && <p className="text-xs text-muted-foreground">{brand.address}</p>}
          {(brand.phone || brand.email) && <p className="text-xs text-muted-foreground">{[brand.phone, brand.email].filter(Boolean).join(" · ")}</p>}
          {brand.registrationNo && <p className="text-xs text-muted-foreground">{brand.registrationNo}</p>}
        </div>
      </div>
      <div className="text-right">{children}</div>
    </header>
  );
}

export function BrandFooter({ brand }: { brand: Brand }) {
  const t = useT();
  return (
    <>
      {(brand.invoiceTerms || brand.bankDetails) && (
        <div className="grid gap-4 rounded-2xl bg-canvas p-4 text-xs sm:grid-cols-2">
          {brand.invoiceTerms && (
            <div>
              <p className="font-semibold uppercase tracking-wider text-muted-foreground">{t("garage.brand.terms")}</p>
              <p className="mt-1 whitespace-pre-line">{brand.invoiceTerms}</p>
            </div>
          )}
          {brand.bankDetails && (
            <div>
              <p className="font-semibold uppercase tracking-wider text-muted-foreground">{t("garage.brand.bank")}</p>
              <p className="mt-1 whitespace-pre-line">{brand.bankDetails}</p>
            </div>
          )}
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span>{brand.invoiceFooter || t("garage.invoice.thanks")}</span>
        <span>
          {t("garage.inv.poweredBy")} <b className="font-display text-primary">Kaduna</b>
        </span>
      </footer>
    </>
  );
}
