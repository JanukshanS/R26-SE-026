import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getIncompleteUploadStatus, type IncompleteUploadStatus } from '@/lib/claim-upload-reminder';

/**
 * Reactive "is there an interrupted Report Accident upload right now" status, re-checked
 * whenever the screen gains focus or the app returns to the foreground. Drives the red-dot
 * badge on the Insurance entry points and lets a tap resume straight into the upload screen.
 */
export function useIncompleteUploadStatus(): IncompleteUploadStatus | null {
  const [status, setStatus] = useState<IncompleteUploadStatus | null>(null);

  const refresh = useCallback(() => {
    void getIncompleteUploadStatus().then(setStatus);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return status;
}
