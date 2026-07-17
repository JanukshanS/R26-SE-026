/** Number of stops the user walks to around the vehicle, unless overridden. */
export const DEFAULT_STOP_COUNT = 10;

export const HEIGHT_STEPS = ['overhead', 'chest', 'waist'] as const;
export type HeightStep = (typeof HEIGHT_STEPS)[number];

/** Accelerometer sampling + smoothing. */
export const TILT_SENSOR_UPDATE_INTERVAL_MS = 100;
export const TILT_SMOOTHING_ALPHA = 0.25;

/** Overhead: phone tilted ~30-45° downward over the vehicle (a forward-slash "/" angle). */
export const OVERHEAD_TILT_MIN_DEG = 30;
export const OVERHEAD_TILT_MAX_DEG = 45;

/** Chest/waist: phone held vertical/upright, tilt near 0°. */
export const VERTICAL_TILT_TOLERANCE_DEG = 12;

/** Vehicle bounding-box width as a fraction of frame width considered a good shooting distance. */
export const GOOD_DISTANCE_MIN_FRACTION = 0.3;
export const GOOD_DISTANCE_MAX_FRACTION = 0.85;

/** How long tilt + distance must stay aligned before auto-capture fires. */
export const CAPTURE_STABILITY_HOLD_MS = 300;

/**
 * No published package does on-device car/vehicle bounding-box detection
 * (`@react-native-ml-kit/object-detection` does not exist, and VisionCamera's
 * built-in `useObjectOutput` is iOS-only with no vehicle category). Real
 * detection needs a native model + inference pipeline wired into
 * `useCarDistance`. Until that's built, mock mode simulates a slowly
 * oscillating distance so the rest of the flow can be exercised end-to-end.
 */
export const CAR_DISTANCE_MOCK_MODE = true;
