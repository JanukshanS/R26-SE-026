import { createLocationSnapshotStore, type LocationSnapshotMeta } from '@/lib/location-snapshot-store';

export type DrunkTestEntryMeta = LocationSnapshotMeta;

const store = createLocationSnapshotStore('drunk-test', 'entry-meta.json');
export const loadDrunkTestEntryMeta = store.load;
export const saveDrunkTestEntryMeta = store.save;
export const clearDrunkTestEntryMeta = store.clear;
