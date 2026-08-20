import * as FileSystem from 'expo-file-system/legacy';

/**
 * Persisted settings for engine-state detection (`engineMonitor.ts`).
 *
 * The important one is the per-vehicle RESTING VOLTAGE BASELINE. Cheap ELM327
 * clones commonly read 0.2–0.8V off, and some report a fixed value — so an
 * absolute "engine is running above 13.2V" test is unreliable across adapters.
 * Learning what THIS car reads when parked lets the monitor look for a RISE
 * from that baseline instead, which is robust to a constant offset and needs
 * no `ATCV` calibration from the user.
 *
 * The rise test is also what distinguishes an alternator from a battery
 * charger: a charger holds a steady high voltage (no rise from a baseline
 * learned while it was connected), an alternator produces a step change.
 */

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'auto-trip/';
const SETTINGS_FILE = ROOT_DIR + 'settings.json';

/** How many resting samples to keep per vehicle. Median of these is the baseline. */
const BASELINE_WINDOW = 9;

interface AutoTripSettings {
  /**
   * Master switch for auto trip recording. Currently unused — this pass runs
   * the monitor in observe-only mode — but persisted now so enabling it later
   * doesn't need a migration.
   */
  enabled: boolean;
  /** vehicleId -> recent resting (engine-off) voltage samples, newest last. */
  restingSamples: Record<string, number[]>;
}

const DEFAULTS: AutoTripSettings = { enabled: false, restingSamples: {} };

// In-memory mirror so the monitor's hot path never awaits a file read.
let cache: AutoTripSettings | null = null;
let writeChain: Promise<void> = Promise.resolve();

export async function loadAutoTripSettings(): Promise<AutoTripSettings> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
    if (!info.exists) {
      cache = { ...DEFAULTS, restingSamples: {} };
      return cache;
    }
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_FILE)) as Partial<AutoTripSettings>;
    cache = {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      restingSamples: parsed.restingSamples ?? {},
    };
  } catch {
    // Corrupt or unreadable — start clean rather than blocking the monitor.
    cache = { ...DEFAULTS, restingSamples: {} };
  }
  return cache;
}

/** Serialized so concurrent baseline updates can't interleave a partial write. */
function persist(): void {
  const snapshot = cache;
  if (!snapshot) return;
  writeChain = writeChain
    .then(async () => {
      await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
      await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(snapshot));
    })
    .catch((e) => {
      console.log(`[AutoTripSettings] persist failed: ${e instanceof Error ? e.message : String(e)}`);
    });
}

export function isAutoTripEnabled(): boolean {
  return cache?.enabled ?? DEFAULTS.enabled;
}

export function setAutoTripEnabled(value: boolean): void {
  if (!cache) cache = { ...DEFAULTS, restingSamples: {} };
  cache.enabled = value;
  persist();
}

/**
 * Record a resting (engine-off) voltage for this vehicle. Keeps a rolling
 * window; the baseline is the MEDIAN of it, not the mean, so one bad reading
 * from a clone can't drag the baseline with it.
 */
export function recordRestingVoltage(vehicleId: string, volts: number): void {
  if (!cache) cache = { ...DEFAULTS, restingSamples: {} };
  const list = cache.restingSamples[vehicleId] ?? [];
  list.push(volts);
  if (list.length > BASELINE_WINDOW) list.splice(0, list.length - BASELINE_WINDOW);
  cache.restingSamples[vehicleId] = list;
  persist();
}

/**
 * Median resting voltage for this vehicle, or null until enough samples exist.
 * Requires at least 3 so a single startup reading can't become the baseline.
 */
export function getRestingBaseline(vehicleId: string): number | null {
  const list = cache?.restingSamples[vehicleId];
  if (!list || list.length < 3) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Number(median.toFixed(2));
}
