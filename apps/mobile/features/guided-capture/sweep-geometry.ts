/**
 * Shortest signed angle from `fromDeg` to `toDeg` in degrees (-180, 180].
 */
export function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = toDeg - fromDeg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
