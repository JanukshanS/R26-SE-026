/**
 * Tilt-compensated horizontal magnetic vector (device frame) from accelerometer gravity + magnetometer.
 * Returns components in the horizontal plane for atan2; not yet normalized.
 */
export function tiltCompensatedHorizontalMag(
  ax: number,
  ay: number,
  az: number,
  mx: number,
  my: number,
  mz: number
): { xh: number; yh: number } {
  const roll = Math.atan2(ay, az);
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  const xh = mx * cosPitch + my * sinPitch * sinRoll + mz * sinPitch * cosRoll;
  const yh = my * cosRoll - mz * sinRoll;
  return { xh, yh };
}

export function headingDegFromHorizontalMag(xh: number, yh: number): number {
  return (Math.atan2(-yh, xh) * 180) / Math.PI;
}
