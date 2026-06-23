import { Redirect } from 'expo-router';

/** Legacy route: sweep is chosen on `/capture` via `SweepDirectionOverlay` (in-screen, not a native Modal). */
export default function GuidedCaptureDirectionScreen() {
  return <Redirect href="/(insurance)/capture" />;
}
