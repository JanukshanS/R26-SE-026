"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, HardHat, Languages, LogOut, Mail, Trash2 } from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { Avatar, Card, CardHeader, ErrorNote, Field, Loading, Spinner, btnPrimary, btnSecondary, inputCls, useAction } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { VehicleApiError, updateMyProfile } from "@/lib/vehicleApi";

import type { DriverData } from "./shared";

export default function Profile({ data }: { data: DriverData }) {
  const t = useT();
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const p = data.profile.data;

  if (data.profile.error) return <ErrorNote message={data.profile.error} onRetry={data.profile.reload} />;
  if (!p) return <Loading />;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={p.name || p.email} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-bold">{p.name || t("me.shell.driver")}</p>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail className="size-4 shrink-0" /> {p.email}
            </p>
          </div>
        </div>
        <form
          key={`${p.name}|${p.phone}|${p.location}|${p.licenceNumber}|${p.nicNumber}`}
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(false);
            const f = new FormData(e.currentTarget);
            const s = (k: string) => String(f.get(k) ?? "").trim() || null;
            const next = await action.run("save", async () => {
              try {
                return await updateMyProfile({ name: s("name") ?? "", phone: s("phone"), location: s("location"), licenceNumber: s("licence"), nicNumber: s("nic") });
              } catch (err) {
                if (err instanceof VehicleApiError && err.code === "23505") throw new Error(t("me.profile.taken"));
                throw err;
              }
            });
            if (next) {
              data.setProfile(next);
              setSaved(true);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("me.profile.name")}>
              <input name="name" required maxLength={120} defaultValue={p.name} autoComplete="name" className={inputCls} />
            </Field>
            <Field label={t("me.profile.phone")}>
              <input name="phone" type="tel" maxLength={20} defaultValue={p.phone ?? ""} autoComplete="tel" placeholder="07X XXX XXXX" className={inputCls} />
            </Field>
            <Field label={t("me.profile.location")} className="sm:col-span-2">
              <input name="location" maxLength={120} defaultValue={p.location ?? ""} placeholder={t("me.profile.locationPlaceholder")} className={inputCls} />
            </Field>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t("me.profile.documents")}</h3>
            <p className="mb-3 text-xs text-muted-foreground">{t("me.profile.documentsSub")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("me.profile.licence")}>
                <input name="licence" maxLength={20} defaultValue={p.licenceNumber ?? ""} className={`${inputCls} font-mono uppercase`} />
              </Field>
              <Field label={t("me.profile.nic")}>
                <input name="nic" maxLength={12} defaultValue={p.nicNumber ?? ""} placeholder="200012345678" className={`${inputCls} font-mono uppercase`} />
              </Field>
            </div>
          </div>
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={action.busy !== null} className={btnPrimary}>
              {action.busy === "save" && <Spinner />} {t("garage.action.save")}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ok">
                <CheckCircle2 className="size-4" /> {t("me.profile.saved")}
              </span>
            )}
          </div>
        </form>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title={t("me.profile.preferences")} />
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Languages className="size-4 text-muted-foreground" /> {t("me.profile.language")}
            </span>
            <LanguagePicker />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("me.profile.account")} />
          <div className="grid gap-2">
            <Link href="/workshop" className={`${btnSecondary} justify-start`}>
              <HardHat /> {t("app.workshop.prompt")} {t("app.workshop.link")}
            </Link>
            <button type="button" onClick={() => supabase.auth.signOut()} className={`${btnSecondary} justify-start`}>
              <LogOut /> {t("portal.action.signOut")}
            </button>
            <Link href="/delete-account" className={`${btnSecondary} justify-start text-bad!`}>
              <Trash2 /> {t("me.profile.delete")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
