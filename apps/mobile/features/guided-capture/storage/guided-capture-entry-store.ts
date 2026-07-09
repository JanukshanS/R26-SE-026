import { createLocationSnapshotStore, type LocationSnapshotMeta } from '@/lib/location-snapshot-store';

export type GuidedCaptureEntryMeta = LocationSnapshotMeta;

const store = createLocationSnapshotStore('guided-capture', 'entry-meta.json');
export const loadGuidedCaptureEntryMeta = store.load;
export const saveGuidedCaptureEntryMeta = store.save;
export const clearGuidedCaptureEntryMeta = store.clear;
