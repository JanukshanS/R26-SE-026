"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Claim } from "@/lib/insurer/types";
import { useT } from "@/lib/i18n";

type ClaimsListPanelProps = {
  claims: Claim[];
  selectedFolder: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (folder: string) => void;
  expanded?: boolean;
};

export function ClaimsListPanel({
  claims,
  selectedFolder,
  search,
  onSearchChange,
  onSelect,
  expanded,
}: ClaimsListPanelProps) {
  const t = useT();
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = claims
    .filter(
      (c) =>
        c.customer.toLowerCase().includes(search.toLowerCase()) ||
        c.nic.toLowerCase().includes(search.toLowerCase()) ||
        c.vehicleModel.toLowerCase().includes(search.toLowerCase()) ||
        (c.vehicleRegNo ?? "").toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const da = a.submittedDate ? new Date(a.submittedDate).getTime() : 0;
      const db = b.submittedDate ? new Date(b.submittedDate).getTime() : 0;
      return sortAsc ? da - db : db - da;
    });

  return (
    <section className="rounded-xl border border-border bg-card flex flex-col min-h-0 overflow-hidden">
      {!expanded && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">{t("insurer.claims.title")}</h2>
          <div className="relative">
            <input
              type="search"
              placeholder={t("insurer.claims.searchPlaceholder")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={t("insurer.claims.searchA11y")}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm pr-8 w-44"
            />
            <svg
              className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setSortAsc((v) => !v)}
        className="self-start px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
      >
        {expanded
          ? sortAsc
            ? "↑"
            : "↓"
          : t("insurer.claims.sortedByDate", { direction: sortAsc ? "↑" : "↓" })}
      </button>

      <div className="flex-1 overflow-auto min-h-0">
        <Table className="table-fixed w-full">
          <colgroup>
            {!expanded && <col className="w-[130px]" />}
            <col />
            {!expanded && <col className="w-[120px]" />}
            {!expanded && <col className="w-[90px]" />}
            <col className="w-[100px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              {!expanded && <TableHead>{t("insurer.claims.colNic")}</TableHead>}
              <TableHead>{t("insurer.claims.colCustomer")}</TableHead>
              {!expanded && <TableHead>{t("insurer.claims.colVehicleModel")}</TableHead>}
              {!expanded && <TableHead>{t("insurer.claims.colRegNo")}</TableHead>}
              <TableHead>{t("insurer.claims.colSubmitted")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((claim) => (
              <TableRow
                key={claim.folder}
                onClick={() => onSelect(claim.folder)}
                className={`cursor-pointer hover:bg-accent ${
                  claim.folder === selectedFolder ? "text-primary font-medium" : ""
                }`}
              >
                {!expanded && <TableCell>{claim.nic}</TableCell>}
                <TableCell>
                  {expanded ? (
                    <>
                      <span className="block">{claim.nic}</span>
                      {claim.vehicleRegNo && (
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {claim.vehicleRegNo}
                        </span>
                      )}
                    </>
                  ) : (
                    <span>{claim.customer}</span>
                  )}
                </TableCell>
                {!expanded && <TableCell>{claim.vehicleModel}</TableCell>}
                {!expanded && <TableCell>{claim.vehicleRegNo || "—"}</TableCell>}
                <TableCell>{claim.submittedDate || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
