import * as FileSystem from 'expo-file-system/legacy';

export type ClaimantProfile = {
  fullName: string;
  nic: string;
  licenceNumber: string;
};

const DEFAULTS: ClaimantProfile = { fullName: '', nic: '', licenceNumber: '' };

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claimant-profile/';
const STATE_FILE = ROOT_DIR + 'profile.json';

export async function loadClaimantProfile(): Promise<ClaimantProfile> {
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return { ...DEFAULTS };
    const raw = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(raw) as Partial<ClaimantProfile>;
    return {
      fullName: typeof parsed.fullName === 'string' ? parsed.fullName : '',
      nic: typeof parsed.nic === 'string' ? parsed.nic : '',
      licenceNumber: typeof parsed.licenceNumber === 'string' ? parsed.licenceNumber : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveClaimantProfile(profile: ClaimantProfile): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(
    STATE_FILE,
    JSON.stringify({
      fullName: profile.fullName.trim(),
      nic: profile.nic.trim(),
      licenceNumber: profile.licenceNumber.trim(),
    })
  );
}
