import { createLocationSnapshotStore, type LocationSnapshotMeta } from '@/lib/location-snapshot-store';

export type InsurerCallMeta = LocationSnapshotMeta;

const store = createLocationSnapshotStore('insurer-call', 'meta.json');
export const loadInsurerCallMeta = store.load;
export const saveInsurerCallMeta = store.save;
export const clearInsurerCallMeta = store.clear;
