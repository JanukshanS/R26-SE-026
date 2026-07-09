import { useEffect, useRef, useState } from 'react';
import {
  loadGuidedCaptureStoreState,
  saveGuidedCaptureStoreState,
} from '@/features/guided-capture/storage/guided-capture-store';
import type { CaptureAngle } from '@/features/guided-capture/types';

export type UseGuidedCaptureStoreResult = {
  capturedAngles: CaptureAngle[];
  capturedPhotoUris: string[];
  libraryPhotoUris: string[];
  isStoreHydrated: boolean;
  setCapturedAngles: React.Dispatch<React.SetStateAction<CaptureAngle[]>>;
  setCapturedPhotoUris: React.Dispatch<React.SetStateAction<string[]>>;
  setLibraryPhotoUris: React.Dispatch<React.SetStateAction<string[]>>;
};

export function useGuidedCaptureStore(): UseGuidedCaptureStoreResult {
  const [capturedAngles, setCapturedAngles] = useState<CaptureAngle[]>([]);
  const [capturedPhotoUris, setCapturedPhotoUris] = useState<string[]>([]);
  const [libraryPhotoUris, setLibraryPhotoUris] = useState<string[]>([]);
  const [isStoreHydrated, setIsStoreHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await loadGuidedCaptureStoreState();
        if (cancelled) return;
        setCapturedAngles(state.activeAngles);
        setCapturedPhotoUris(state.activePhotoUris);
        setLibraryPhotoUris(
          state.libraryPhotoUris.length > 0 ? state.libraryPhotoUris : state.activePhotoUris
        );
        hydratedRef.current = true;
      } finally {
        if (!cancelled) setIsStoreHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveGuidedCaptureStoreState({
      activeAngles: capturedAngles,
      activePhotoUris: capturedPhotoUris,
      libraryPhotoUris,
    });
  }, [capturedAngles, capturedPhotoUris, libraryPhotoUris]);

  return {
    capturedAngles,
    capturedPhotoUris,
    libraryPhotoUris,
    isStoreHydrated,
    setCapturedAngles,
    setCapturedPhotoUris,
    setLibraryPhotoUris,
  };
}
