import * as Location from 'expo-location';

const POSITION_TIMEOUT_MS = 15000;

/**
 * getCurrentPositionAsync takes no timeout and can wait indefinitely with no sky view
 * (car park, tunnel, dense city). Every caller here runs it behind a blocked control —
 * the insurer call button, a task card, the upload's progress rows — so an unbounded
 * wait reads as a dead button. Resolves null once the wait is over instead, letting the
 * caller fall into its existing "no location" path.
 */
export async function getCurrentPositionOrNull(): Promise<Location.LocationObject | null> {
  const position = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  // Detached handler, not a .catch() inside the race: a rejection after the timeout has
  // already won would otherwise surface as an unhandled rejection, while a rejection
  // before it must still propagate to the caller's own catch.
  position.catch(() => {});
  return Promise.race([
    position,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
  ]);
}
