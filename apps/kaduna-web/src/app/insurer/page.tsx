"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { ClaimDetailPanel } from "@/components/insurer/dashboard/ClaimDetailPanel";
import { ClaimsListPanel } from "@/components/insurer/dashboard/ClaimsListPanel";
import { PipelineSteps } from "@/components/insurer/dashboard/PipelineSteps";
import { PipelineJobProvider, usePipelineJob } from "@/lib/insurer/PipelineJobContext";
import { useInsurerUser } from "@/lib/insurer/auth";
import { fetchClaims } from "@/lib/insurer/claimsApi";
import type { Claim } from "@/lib/insurer/types";

function GlobalPipelineWidget() {
  const { activeJob, clearJob } = usePipelineJob();
  if (!activeJob) return null;
  return (
    <PipelineSteps
      steps={activeJob.steps}
      modelState={activeJob.state}
      claimLabel={activeJob.label}
      onDismiss={activeJob.state !== "generating" ? clearJob : undefined}
    />
  );
}

function DashboardInner() {
  const { user } = useInsurerUser();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleExpand = () => {
    if (animTimer.current) clearTimeout(animTimer.current);
    setIsAnimating(true);
    setExpanded((v) => !v);
    animTimer.current = setTimeout(() => setIsAnimating(false), 420);
  };

  useEffect(() => {
    fetchClaims()
      .then((data) => {
        setClaims(data);
        if (data.length > 0) setSelectedFolder(data[0].folder);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load claims"))
      .finally(() => setLoading(false));
  }, []);

  const selectedClaim = useMemo(
    () => claims.find((c) => c.folder === selectedFolder) ?? claims[0],
    [claims, selectedFolder],
  );

  return (
    <PortalShell title="" fullWidth stretch>
      {user?.company_name && (
        <p className="mb-4 text-sm text-muted-foreground">{user.company_name}</p>
      )}

      {loading && <p className="py-8 text-muted-foreground">Loading claims…</p>}
      {error && <p className="py-8 text-red-600">{error}</p>}

      {!loading && !error && (
        <div
          className={`grid gap-4 h-full transition-[grid-template-columns] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
            expanded ? "grid-cols-[240px_1fr]" : "grid-cols-[minmax(280px,38%)_1fr]"
          }`}
        >
          <ClaimsListPanel
            claims={claims}
            selectedFolder={selectedFolder}
            search={search}
            onSearchChange={setSearch}
            onSelect={setSelectedFolder}
            expanded={expanded}
          />
          {selectedClaim && (
            <ClaimDetailPanel
              claim={selectedClaim}
              key={selectedClaim.folder}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
              isAnimating={isAnimating}
            />
          )}
        </div>
      )}

      <GlobalPipelineWidget />
    </PortalShell>
  );
}

export default function InsurerPage() {
  return (
    <PipelineJobProvider>
      <DashboardInner />
    </PipelineJobProvider>
  );
}
