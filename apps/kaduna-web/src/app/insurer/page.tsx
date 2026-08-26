"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClaimDetailPanel } from "@/components/insurer/dashboard/ClaimDetailPanel";
import { ClaimsListPanel } from "@/components/insurer/dashboard/ClaimsListPanel";
import { DashboardHeader } from "@/components/insurer/dashboard/DashboardHeader";
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
    <div className="dashboard">
      <DashboardHeader onAdminClick={undefined} />
      {user?.company_name && <p className="dashboard__company">{user.company_name}</p>}

      {loading && <p style={{ padding: "2rem" }}>Loading claims…</p>}
      {error && <p style={{ padding: "2rem", color: "red" }}>{error}</p>}

      {!loading && !error && (
        <div className={`dashboard__content${expanded ? " dashboard__content--expanded" : ""}`}>
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
    </div>
  );
}

export default function InsurerPage() {
  return (
    <PipelineJobProvider>
      <DashboardInner />
    </PipelineJobProvider>
  );
}
