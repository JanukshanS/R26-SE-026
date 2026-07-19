import { createLocationSnapshotStore, type LocationSnapshotMeta } from '@/lib/location-snapshot-store';

export type ReportAccidentEntryMeta = LocationSnapshotMeta;

const store = createLocationSnapshotStore('report-accident', 'entry-meta.json');
export const loadReportAccidentEntryMeta = store.load;
export const saveReportAccidentEntryMeta = store.save;
export const clearReportAccidentEntryMeta = store.clear;
