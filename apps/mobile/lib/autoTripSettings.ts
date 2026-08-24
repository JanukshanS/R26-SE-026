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
   * Master switch for auto trip recording, honoured by
   * `use-auto-trip-controller.ts` — false means the engine monitor still runs
   * and reports state, but engine start/stop never touch the trip recorder.
   *
   * Defaults to TRUE now that the voltage thresholds are calibrated against a
   * real car and the seam is live. It defaulted to false during the
   * observe-only pass; leaving it there would have meant shipping the feature
   * switched off for every existing install, since nothing writes this key
   * until a driver explicitly opts out. A driver who does opt out gets
   * `enabled: false` persisted, which survives this default.
   */
  enabled: boolean;
  /** vehicleId -> recent resting (engine-off) voltage samples, newest last. */
  restingSamples: Record<string, number[]>;
  /**
   * Which generation of this file wrote `enabled`. See SETTINGS_VERSION.
   * Absent on every file written before auto-recording went live.
   */
  settingsVersion?: number;
}

/**
 * Bumped when a stored `enabled` can no longer be trusted to mean what it says.
 *
 * THE PROBLEM THIS SOLVES: during the observe-only pass `enabled` defaulted to
 * FALSE, and `persist()` writes the whole settings object every time a resting
 * voltage sample is recorded — which the monitor does routinely, on its own,
 * without anyone touching a setting. So every phone that ever ran the
 * observe-only build has `enabled: false` sitting in its settings file, written
 * as a side effect of learning voltage baselines.
 *
 * That value then wins forever: `parsed.enabled ?? DEFAULTS.enabled` only falls
 * back for null/undefined, and `false` is neither. Flipping the default to true
 * therefore changed nothing on exactly the installs that needed it, and the
 * feature silently stayed off with `ENGINE START ignored — auto recording is
 * switched off` as the only clue.
 *
 * A stored `false` from that era cannot be a deliberate opt-out, because there
 * was no way to opt out — no UI ever called setAutoTripEnabled. So a file with
 * no version marker has its `enabled` treated as "never chosen" and the current
 * default applies. Files written from now on carry the marker, and their
 * `enabled` IS a real choice and is honoured.
 */
const SETTINGS_VERSION = 2;

const DEFAULTS: AutoTripSettings = { enabled: true, restingSamples: {}, settingsVersion: SETTINGS_VERSION };

// In-memory mirror so the monitor's hot path never awaits a file read.
let cache: AutoTripSettings | null = null;
let writeChain: Promise<void> = Promise.resolve();

export async function loadAutoTripSettings(): Promise<AutoTripSettings> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
    if (!info.exists) {
      cache = { ...DEFAULTS, restingSamples: {}, settingsVersion: SETTINGS_VERSION };
      return cache;
    }
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_FILE)) as Partial<AutoTripSettings>;
    // Only honour a stored `enabled` if the file is new enough for it to be a
    // real choice. Resting samples are kept either way — they are measurements,
    // not preferences, and re-learning them costs a drive.
    const trusted = (parsed.settingsVersion ?? 0) >= SETTINGS_VERSION;
    cache = {
      enabled: trusted ? (parsed.enabled ?? DEFAULTS.enabled) : DEFAULTS.enabled,
      restingSamples: parsed.restingSamples ?? {},
      settingsVersion: SETTINGS_VERSION,
    };
    if (!trusted) {
      console.log(
        "[autoTripSettings] settings file predates auto-recording going live — " +
        `adopting enabled=${DEFAULTS.enabled} (stored value was ${parsed.enabled}, ` +
        "written by the observe-only build as a side effect, not chosen)"
      );
    }
  } catch {
    // Corrupt or unreadable — start clean rather than blocking the monitor.
    cache = { ...DEFAULTS, restingSamples: {}, settingsVersion: SETTINGS_VERSION };
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
  if (!cache) cache = { ...DEFAULTS, restingSamples: {}, settingsVersion: SETTINGS_VERSION };
  cache.enabled = value;
  persist();
}

/**
 * Record a resting (engine-off) voltage for this vehicle. Keeps a rolling
 * window; the baseline is the MEDIAN of it, not the mean, so one bad reading
 * from a clone can't drag the baseline with it.
 */
export function recordRestingVoltage(vehicleId: string, volts: number): void {
  if (!cache) cache = { ...DEFAULTS, restingSamples: {}, settingsVersion: SETTINGS_VERSION };
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
