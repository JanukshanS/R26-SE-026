"use client";

const PRIORITIES = [
  ["Critical", "var(--priority-critical)"],
  ["High", "var(--priority-high)"],
  ["Medium", "var(--priority-medium)"],
  ["Low", "var(--priority-low)"],
] as const;

/**
 * How to read the map.
 *
 * The PP1 panel's comment on this dashboard was that the colours and points
 * "have no meaning in plain sight". Colour was already carried by the priority
 * filter chips, but marker radius encodes the impact score
 * (`4 + impactScore * 0.5` in both map engines) and that was never stated
 * anywhere — so a bigger dot read as decoration rather than as the single most
 * important thing on the screen.
 *
 * Every mark the map can draw is listed, whether or not its layer is currently
 * on: the point is to explain the vocabulary, not to mirror the toggles.
 */
export default function MapLegend() {
  return (
    <section
      aria-label="Map legend"
      className="rounded-xl border border-border bg-card p-3 text-xs"
    >
      <h2 className="text-xs font-medium">How to read this map</h2>

      <dl className="mt-2.5 space-y-2.5">
        <div>
          <dt className="text-muted-foreground">Colour — how urgent</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {PRIORITIES.map(([label, colour]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: colour }}
                  aria-hidden
                />
                {label}
              </span>
            ))}
          </dd>
        </div>

        <div>
          <dt className="text-muted-foreground">Size — how much traffic it costs</dt>
          <dd className="mt-1 flex items-center gap-2">
            <span className="flex items-end gap-1.5" aria-hidden>
              {[5, 8, 12, 16].map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-muted-foreground/50"
                  style={{ width: d, height: d }}
                />
              ))}
            </span>
            <span className="text-muted-foreground">impact 1 → 10</span>
          </dd>
        </div>

        <div>
          <dt className="text-muted-foreground">Other marks</dt>
          <dd className="mt-1 space-y-1">
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full border-2 border-dashed border-[var(--priority-high)]"
                aria-hidden
              />
              Hotspot — where scored incidents cluster
            </span>
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rotate-45 bg-[var(--priority-critical)]"
                aria-hidden
              />
              Blackspot — a real accident site (NTC 2024)
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-6 shrink-0 rounded-sm"
                style={{
                  background:
                    "linear-gradient(90deg, var(--priority-low), var(--priority-medium), var(--priority-high), var(--priority-critical))",
                }}
                aria-hidden
              />
              Heatmap — where impact concentrates
            </span>
          </dd>
        </div>
      </dl>

      <p className="mt-2.5 text-muted-foreground">
        Hotspots, blackspots and the heatmap are off until you turn them on above.
      </p>
    </section>
  );
}
