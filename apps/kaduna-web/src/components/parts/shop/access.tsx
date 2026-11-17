"use client";

/**
 * Who is at the till: the signed-in person's role at the shop and what it
 * lets them do (from /me), and the manager-PIN prompt for the things their
 * role can't do alone (a big discount, a void, a refund).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";

import { ErrorNote, Spinner, btnPrimary, btnSecondary, inputCls } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import { isApprovalNeeded, type PartsMe, type Permission } from "@/lib/partsApi";

type Access = PartsMe & { can: (...any: Permission[]) => boolean };

const ShopAccess = createContext<Access>({ shop: null, role: null, name: null, permissions: [], hasPin: false, can: () => false });

export function ShopAccessProvider({ me, children }: { me: PartsMe; children: React.ReactNode }) {
  const can = useCallback((...any: Permission[]) => any.some((p) => me.permissions.includes(p)), [me.permissions]);
  return <ShopAccess.Provider value={{ ...me, can }}>{children}</ShopAccess.Provider>;
}

export const useAccess = () => useContext(ShopAccess);

/** Thrown when the PIN prompt is closed: the action simply didn't happen. */
export class ApprovalCancelled extends Error {}

/**
 * Wrap a call that may need a manager: `approve((pin) => voidSale(id, { reason, approvalPin: pin }))`.
 * If the server asks for approval, a PIN prompt opens and the call is retried
 * with the PIN (and again on a wrong one) until it goes through or is closed.
 * Render `prompt` somewhere in the screen.
 */
export function useApproval() {
  const t = useT();
  const [ask, setAsk] = useState<{ message: string; resolve: (pin: string | null) => void } | null>(null);
  const prompt = (message: string) => new Promise<string | null>((resolve) => setAsk({ message, resolve }));

  const approve = useCallback(
    async <T,>(fn: (pin?: string) => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (!isApprovalNeeded(err)) throw err;
        let message = (err as Error).message;
        for (;;) {
          const pin = await prompt(message);
          if (pin == null) throw new ApprovalCancelled(t("shop.approve.cancelled"));
          try {
            return await fn(pin);
          } catch (again) {
            if (!isApprovalNeeded(again)) throw again;
            message = (again as Error).message;
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const element = ask && (
    <PinPrompt
      message={ask.message}
      onDone={(pin) => {
        ask.resolve(pin);
        setAsk(null);
      }}
    />
  );
  return { approve, prompt: element };
}

function PinPrompt({ message, onDone }: { message: string; onDone: (pin: string | null) => void }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onDone(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4,6}$/.test(pin)) onDone(pin);
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-primary"><KeyRound className="size-5" /></span>
          <h2 id="pin-title" className="font-display text-lg font-bold">{t("shop.approve.title")}</h2>
        </div>
        <ErrorNote message={message} />
        <p className="text-sm text-muted-foreground">{t("shop.approve.body")}</p>
        <input
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="••••"
          aria-label={t("shop.approve.pin")}
          className={`${inputCls} text-center font-mono text-2xl tracking-[.5em]`}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className={btnSecondary}>{t("garage.action.cancel")}</button>
          <button type="submit" disabled={!/^\d{4,6}$/.test(pin)} className={btnPrimary}><KeyRound /> {t("shop.approve.ok")}</button>
        </div>
      </form>
    </div>
  );
}

/** A small "you can't" note for screens a role can't use. */
export function NotForYourRole() {
  const t = useT();
  return <p className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">{t("shop.access.notYours")}</p>;
}

export { Spinner };
