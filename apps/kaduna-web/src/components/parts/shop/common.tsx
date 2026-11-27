"use client";

/** Pieces the shop screens share: a part search-and-pick box and payment method chips. (Printing is in ./print.) */
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Chip, Spinner, inputCls, useDebounced } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import { PAYMENT_METHODS, listParts, type Part, type PaymentMethod } from "@/lib/partsApi";

/** Search the shop's stock by name or any number and pick one. Enter on an exact code picks it straight away. */
export function PartPicker({
  onPick,
  placeholder,
  autoFocus = false,
  onCode,
}: {
  onPick: (p: Part) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Enter pressed: try the text as a barcode or exact code first. Return true if it was handled. */
  onCode?: (code: string) => Promise<boolean>;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Part[] | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(text.trim(), 250);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    let live = true;
    setBusy(true);
    listParts({ q, limit: 12 }).then(
      (r) => live && setResults(r.items),
      () => live && setResults([])
    ).finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: Part) => {
    onPick(p);
    setText("");
    setResults(null);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const code = text.trim();
          if (!code) return;
          if (onCode && (await onCode(code))) {
            setText("");
            setResults(null);
            return;
          }
          if (results?.length === 1) pick(results[0]);
        }}
        placeholder={placeholder ?? t("shop.picker.placeholder")}
        className={`${inputCls} pl-9`}
      />
      {open && q && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-white shadow-lg">
          {busy && !results ? (
            <p className="p-3 text-sm text-muted-foreground"><Spinner /> {t("garage.loading")}</p>
          ) : !results?.length ? (
            <p className="p-3 text-sm text-muted-foreground">{t("shop.picker.none")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => pick(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-canvas">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}{p.brand && <span className="font-normal text-muted-foreground"> · {p.brand}</span>}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{[p.sku, p.oemNumber, p.location].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${p.stockQty > 0 ? "text-muted-foreground" : "text-bad"}`}>{t("shop.stockShort", { n: p.stockQty })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function MethodChips({ value, onChange }: { value: PaymentMethod | null; onChange: (m: PaymentMethod) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {PAYMENT_METHODS.map((m) => (
        <Chip key={m} on={value === m} onClick={() => onChange(m)}>{t(`garage.method.${m}`)}</Chip>
      ))}
    </div>
  );
}
