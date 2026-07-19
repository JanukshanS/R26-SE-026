import * as FileSystem from 'expo-file-system/legacy';
import { requireNativeModule } from 'expo-modules-core';
import { Image } from 'react-native';

/** Match your TFLite / Core ML Zero-DCE input if different (e.g. 256). */
export const ZERO_DCE_MAX_EDGE_PX = 512;

/** Upper bound for JPEG payload before Zero-DCE (e.g. upload / model I/O budget). */
export const ZERO_DCE_TARGET_MAX_BYTES = 80 * 1024;

type ManipulatorModule = typeof import('expo-image-manipulator');

const EXPO_IMAGE_MANIPULATOR_NATIVE = 'ExpoImageManipulator';

let manipulatorPromise: Promise<ManipulatorModule | null> | null = null;

function isImageManipulatorNativeAvailable(): boolean {
  try {
    requireNativeModule(EXPO_IMAGE_MANIPULATOR_NATIVE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads `expo-image-manipulator` only if the native module is linked.
 * Avoids `import('expo-image-manipulator')` when missing — that import runs JS that
 * immediately calls `requireNativeModule` and would log a redbox even inside `.catch()`.
 */
function getManipulator(): Promise<ManipulatorModule | null> {
  if (manipulatorPromise !== null) {
    return manipulatorPromise;
  }
  if (!isImageManipulatorNativeAvailable()) {
    manipulatorPromise = Promise.resolve(null);
    return manipulatorPromise;
  }
  manipulatorPromise = import('expo-image-manipulator')
    .then((m) => m)
    .catch(() => null);
  return manipulatorPromise;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err ?? new Error('Image.getSize failed'))
    );
  });
}

async function localUriByteLength(uri: string): Promise<number> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return blob.size;
}

async function resizeOriginalToMaxEdge(
  manipulator: ManipulatorModule,
  sourceUri: string,
  maxEdgePx: number
): Promise<{ uri: string; width: number; height: number }> {
  const { manipulateAsync, SaveFormat } = manipulator;
  const { width: w, height: h } = await getImageSize(sourceUri);
  const maxDim = Math.max(w, h);
  if (maxDim <= maxEdgePx) {
    return { uri: sourceUri, width: w, height: h };
  }
  const scale = maxEdgePx / maxDim;
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const out = await manipulateAsync(sourceUri, [{ resize: { width, height } }], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  return { uri: out.uri, width: out.width, height: out.height };
}

async function reencodeJpegSameDimensions(
  manipulator: ManipulatorModule,
  uri: string,
  compress: number
): Promise<string> {
  const { manipulateAsync, SaveFormat } = manipulator;
  const out = await manipulateAsync(uri, [], { compress, format: SaveFormat.JPEG });
  return out.uri;
}

/**
 * Downscales and JPEG-compresses a captured photo so file size is typically ≤ `targetMaxBytes`
 * (best-effort), for a downstream Zero-DCE pass. Does not run Zero-DCE itself.
 *
 * If `ExpoImageManipulator` is not in the app binary, returns `sourceUri` unchanged (no error).
 * To link it: from `frontend`, run `npx expo prebuild --clean` then `npx expo run:android` (or iOS),
 * uninstall the old app from the device, then install the new build.
 */
export async function prepareImageForZeroDce(
  sourceUri: string,
  options?: { maxEdgePx?: number; targetMaxBytes?: number }
): Promise<string> {
  const manipulator = await getManipulator();
  if (!manipulator) {
    return sourceUri;
  }

  const maxEdgePx = options?.maxEdgePx ?? ZERO_DCE_MAX_EDGE_PX;
  const targetMaxBytes = options?.targetMaxBytes ?? ZERO_DCE_TARGET_MAX_BYTES;

  try {
    const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
    if (!sourceInfo.exists) {
      return sourceUri;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const edge = Math.max(200, Math.round(maxEdgePx * Math.pow(0.85, attempt)));
      const { uri: resizedUri } = await resizeOriginalToMaxEdge(manipulator, sourceUri, edge);
      let size = await localUriByteLength(resizedUri);
      if (size <= targetMaxBytes) {
        return resizedUri;
      }

      let lo = 0.12;
      let hi = 0.95;
      let bestUri = resizedUri;
      let bestSize = size;

      for (let i = 0; i < 12 && hi - lo > 0.035; i++) {
        const mid = (lo + hi) / 2;
        const candidate = await reencodeJpegSameDimensions(manipulator, resizedUri, mid);
        const candidateSize = await localUriByteLength(candidate);
        if (candidateSize <= targetMaxBytes) {
          bestUri = candidate;
          bestSize = candidateSize;
          lo = mid;
        } else {
          hi = mid;
        }
      }

      if (bestSize <= targetMaxBytes) {
        return bestUri;
      }
    }

    return sourceUri;
  } catch {
    return sourceUri;
  }
}
