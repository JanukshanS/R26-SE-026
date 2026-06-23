export const MIN_PHOTOS = 5; // Keep the number of photos to 5 for small accidents
export const MAX_OVERLAP_STEP_DEG = 12; // Max movement allowed between captures
export const MIN_OVERLAP_STEP_DEG = 2.5; // Prevents duplicate shots with near-zero movement
/**
 * Denominator for overlap %, motion bar, and haptic target (not the same as MAX_OVERLAP_STEP_DEG).
 * Use a **smaller** value than the max step so large-radius walks (e.g. around a car) reach
 * "enough" rotation on the bar with less yaw per meter than a tight path (e.g. a chair).
 */
export const OVERLAP_PROGRESS_REFERENCE_DEG = 7.5;
/** Haptic / auto-capture when overlap reaches this % of the allowed step. */
export const OVERLAP_TARGET_PERCENT = 70;
/** Motion bar fills (and turns green) at this overlap % — easier than 70% for everyday users. */
export const MOTION_BAR_FILL_TARGET_PERCENT = 70;
export const MAX_VERTICAL_PITCH_DELTA_DEG = 5; // Small up/down tolerance while sweeping
export const DIRECTION_REVERSAL_TOLERANCE_DEG = 1.0; // Ignore tiny yaw noise / smoothing lag before locking direction
/**
 * Min yaw change after first photo to infer left vs right when the user did not pick a direction
 * when sweep was not set from URL or the direction modal (fallback only).
 */
export const SWEEP_INFER_MIN_YAW_DEG = 2.5;
export const MAX_GYRO_SPEED_RAD = 0.45; // Locks shutter while phone is rotating quickly
export const MAX_FLAT_Z_COMPONENT = 0.72; // Requires upright phone (portrait/landscape), not flat
/**
 * Poll interval for accelerometer + magnetometer (upright / tilt-compensated heading).
 * Slightly slower is fine here; avoids noisy pitch/roll.
 */
export const SENSOR_LOW_FREQ_INTERVAL_MS = 100;
/**
 * Gyro drives integrated yaw and the motion bar — faster interval = snappier bar (less “lag”).
 * Can’t go too low on all devices; ~50–60ms is a good balance with smoothing.
 */
export const GYROSCOPE_UPDATE_INTERVAL_MS = 55;
/** Same as `SENSOR_LOW_FREQ_INTERVAL_MS` — kept if anything still expects one shared accel interval. */
export const SENSOR_UPDATE_INTERVAL_MS = SENSOR_LOW_FREQ_INTERVAL_MS;
/**
 * Exponential smoothing for accel / gyro / mag (0–1). Higher = more responsive, less lag.
 * Paired with faster gyro interval, ~0.3 keeps the bar quick without huge jitter.
 */
export const SENSOR_SMOOTHING_ALPHA = 0.3;
/** Yaw rate (rad/s) below this counts as still — cuts gyro noise integration drift. */
export const GYRO_Z_DEADBAND_RAD_S = 0.075;
/**
 * Per update, blend toward magnetometer heading delta (0 = gyro only, 1 = snap to mag).
 * Low value keeps smooth gyro for small pans; mag corrects drift and helps large-radius walks.
 */
export const HEADING_MAG_FUSION_GAIN = 0.055;
/** EMA on horizontal mag vector components (0–1). Slightly higher tracks turns faster. */
export const HEADING_MAG_VECTOR_SMOOTH_ALPHA = 0.32;
/** Ignore absurd one-tick magnetometer spikes vs gyro (deg). */
export const HEADING_MAG_ANOMALY_CAP_DEG = 35;
/** Pause after overlap-target haptic before firing auto-capture (ms). */
export const AUTO_CAPTURE_AFTER_HAPTIC_MS = 180;
