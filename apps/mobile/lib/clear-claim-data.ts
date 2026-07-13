import {
  deleteGuidedCapturePhotos,
  loadGuidedCaptureStoreState,
  saveGuidedCaptureStoreState,
} from '@/features/guided-capture/storage/guided-capture-store';
import { clearGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { clearInsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { clearReportAccidentEntryMeta } from '@/features/report-accident/storage/report-accident-entry-store';
import {
  deleteDrivingLicencePhotos,
  loadDrivingLicenceState,
  saveDrivingLicenceState,
} from '@/features/driving-licence/storage/driving-licence-store';
import {
  deleteDrunkTestVideo,
  loadDrunkTestState,
  saveDrunkTestState,
} from '@/features/drunk-test/storage/drunk-test-store';
import {
  deleteThirdPartyPhotos,
  loadThirdPartyState,
  saveThirdPartyState,
} from '@/features/third-party/storage/third-party-store';
import { clearAllPhotoGps } from '@/lib/photo-gps-store';
import { clearPersistedClaimUploadSuccess } from '@/lib/claim-upload-dedupe';

/**
 * Clears all data from a completed claim so the app is ready for a new one.
 * Claimant profile (name, NIC, licence) is intentionally preserved.
 */
export async function clearAllClaimData(): Promise<void> {
  const [guidedState, licenceState, drunkState, thirdPartyState] = await Promise.all([
    loadGuidedCaptureStoreState(),
    loadDrivingLicenceState(),
    loadDrunkTestState(),
    loadThirdPartyState(),
  ]);

  await Promise.all([
    // Delete photo and video files from device storage
    deleteGuidedCapturePhotos([...guidedState.activePhotoUris, ...guidedState.libraryPhotoUris]),
    deleteDrivingLicencePhotos(licenceState.libraryUris),
    deleteDrunkTestVideo(drunkState.videoUri),
    deleteThirdPartyPhotos(thirdPartyState.libraryUris),

    // Clear GPS entries and upload tracking
    clearAllPhotoGps(),
    clearPersistedClaimUploadSuccess(),

    // Clear location metadata for all 3 steps
    clearInsurerCallMeta(),
    clearGuidedCaptureEntryMeta(),
    clearReportAccidentEntryMeta(),

    // Reset store state files to empty (next load returns defaults)
    saveGuidedCaptureStoreState({ activeAngles: [], activePhotoUris: [], libraryPhotoUris: [] }),
    saveDrivingLicenceState({ side: 'front', frontUri: null, backUri: null, selfieUri: null, libraryUris: [] }),
    saveDrunkTestState({ videoUri: null }),
    saveThirdPartyState({
      step: 'driverFront',
      driverLicenceFrontUri: null,
      driverLicenceBackUri: null,
      revenueLicenceUri: null,
      notApplicable: false,
      libraryUris: [],
    }),
  ]);
}
