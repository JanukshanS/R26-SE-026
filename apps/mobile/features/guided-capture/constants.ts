/** Number of stops the user walks to around the vehicle, unless overridden. */
export const DEFAULT_STOP_COUNT = 12;

/** Target angular walk between stops (not a full 360° orbit) — within the 12-16° overlap band. */
export const STOP_TRANSITION_TARGET_DEG = 15;
/** Poll interval for the gyroscope used to integrate walked angle between stops. */
export const GYRO_UPDATE_INTERVAL_MS = 50;
/** Ignore yaw rates below this (rad/s) so sensor noise doesn't accumulate while standing still. */
export const GYRO_NOISE_DEADBAND_RAD_S = 0.02;

/** Overhead: phone tilted ~30-45° downward over the vehicle (a forward-slash "/" angle). */
export const OVERHEAD_TILT_MIN_DEG = 30;
export const OVERHEAD_TILT_MAX_DEG = 50;

/** Chest/waist: phone held vertical/upright, tilt near 0°. */
export const VERTICAL_TILT_TOLERANCE_DEG = 12;

/** Poll interval for the accelerometer (pitch). Slightly slower avoids noisy readings. */
export const SENSOR_LOW_FREQ_INTERVAL_MS = 100;
/** Exponential smoothing for the accelerometer (0-1). Higher = more responsive, less lag. */
export const SENSOR_SMOOTHING_ALPHA = 0.3;

/** How long tilt must stay aligned (in Auto mode) before a haptic buzz + auto-capture fires. */
export const CAPTURE_STABILITY_HOLD_MS = 300;
