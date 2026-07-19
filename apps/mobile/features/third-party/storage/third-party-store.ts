import * as FileSystem from 'expo-file-system/legacy';

export type ThirdPartyCaptureStep = 'driverFront' | 'driverBack' | 'revenue';

export type ThirdPartyState = {
  step: ThirdPartyCaptureStep;
  driverLicenceFrontUri: string | null;
  driverLicenceBackUri: string | null;
  revenueLicenceUri: string | null;
  notApplicable: boolean;
  libraryUris: string[];
};

const EMPTY_STATE: ThirdPartyState = {
  step: 'driverFront',
  driverLicenceFrontUri: null,
  driverLicenceBackUri: null,
  revenueLicenceUri: null,
  notApplicable: false,
  libraryUris: [],
};

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'third-party/';
const PHOTOS_DIR = ROOT_DIR + 'photos/';
const STATE_FILE = ROOT_DIR + 'state.json';

async function ensureStorageReady() {
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
}

function getFileExtension(uri: string): string {
  const path = uri.split('?')[0] ?? uri;
  const index = path.lastIndexOf('.');
  if (index < 0) return 'jpg';
  return path.slice(index + 1);
}

async function uriExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

async function normalizeOptionalUri(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null;
  return (await uriExists(raw)) ? raw : null;
}

export function nextStepAfterCapture(step: ThirdPartyCaptureStep): ThirdPartyCaptureStep {
  if (step === 'driverFront') return 'driverBack';
  if (step === 'driverBack') return 'revenue';
  return 'revenue';
}

function reconcileStep(state: ThirdPartyState): ThirdPartyCaptureStep {
  if (state.notApplicable) return 'driverFront';
  if (!state.driverLicenceFrontUri) return 'driverFront';
  if (!state.driverLicenceBackUri) return 'driverBack';
  if (!state.revenueLicenceUri) return 'revenue';
  return 'revenue';
}

export function isThirdPartyStepComplete(state: ThirdPartyState): boolean {
  if (state.notApplicable) return true;
  return (
    state.driverLicenceFrontUri != null &&
    state.driverLicenceBackUri != null &&
    state.revenueLicenceUri != null
  );
}

export async function loadThirdPartyState(): Promise<ThirdPartyState> {
  try {
    await ensureStorageReady();
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return EMPTY_STATE;
    const content = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const hasNewShape =
      typeof parsed.driverLicenceFrontUri !== 'undefined' ||
      typeof parsed.step !== 'undefined' ||
      (Array.isArray(parsed.libraryUris) && parsed.libraryUris.length > 0);

    if (!hasNewShape && typeof parsed.revenueLicenceUri === 'string') return EMPTY_STATE;

    const driverLicenceFrontUri = await normalizeOptionalUri(parsed.driverLicenceFrontUri);
    const driverLicenceBackUri = await normalizeOptionalUri(parsed.driverLicenceBackUri);
    const revenueLicenceUri = await normalizeOptionalUri(parsed.revenueLicenceUri);
    const rawStep = parsed.step;
    const step: ThirdPartyCaptureStep =
      rawStep === 'driverBack' || rawStep === 'revenue' || rawStep === 'driverFront' ? rawStep : 'driverFront';

    const rawLibrary = Array.isArray(parsed.libraryUris) ? (parsed.libraryUris as unknown[]) : [];
    const libraryChecks = await Promise.all(
      rawLibrary.map(async (u) => (typeof u === 'string' && (await uriExists(u)) ? u : null))
    );
    let libraryUris = libraryChecks.filter((u): u is string => u != null);

    const notApplicableRaw = parsed.notApplicable === true;
    const notApplicable =
      notApplicableRaw && driverLicenceFrontUri == null && driverLicenceBackUri == null && revenueLicenceUri == null;

    const capturedTriplet = [driverLicenceFrontUri, driverLicenceBackUri, revenueLicenceUri].filter(
      (u): u is string => u != null
    );
    if (libraryUris.length === 0 && capturedTriplet.length > 0) libraryUris = capturedTriplet;

    const base: ThirdPartyState = {
      step,
      driverLicenceFrontUri,
      driverLicenceBackUri,
      revenueLicenceUri,
      notApplicable,
      libraryUris,
    };
    return { ...base, step: reconcileStep(base) };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveThirdPartyState(state: ThirdPartyState): Promise<void> {
  await ensureStorageReady();
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
}

export async function persistThirdPartyPhoto(sourceUri: string): Promise<string> {
  await ensureStorageReady();
  const info = await FileSystem.getInfoAsync(sourceUri);
  if (!info.exists) return sourceUri;
  const ext = getFileExtension(sourceUri);
  const destUri = PHOTOS_DIR + `third-party-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destUri });
  return destUri;
}

export async function deleteThirdPartyPhoto(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // best-effort
  }
}

export async function deleteThirdPartyPhotos(uris: string[]): Promise<void> {
  for (const uri of [...new Set(uris)]) {
    await deleteThirdPartyPhoto(uri);
  }
}
