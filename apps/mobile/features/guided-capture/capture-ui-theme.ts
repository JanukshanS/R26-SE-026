/**
 * Color tokens for the Guided Capture camera flow and the wider Insurance
 * claim flow (Home, Driving Licence, User Verification, 3rd Party, Upload
 * Accident Details). Edit values here — screens should never hardcode a
 * hex/rgba color directly.
 */

/**
 * Shared primitives — every raw color value is defined exactly once here.
 * Every other export below aliases one of these; none should retype a literal
 * that already exists as a primitive or as another export's value.
 */
export const WHITE = '#ffffff';
export const BLACK = '#000000';
export const GRAY_900 = '#111111';
export const BORDER_LIGHT = '#d0d0d0';
export const GRAY_LIGHT = '#e0e0e0';
export const GRAY_LIGHTER = '#e8e8e8';
export const DANGER_RED = '#c62828';
/** Soft tint of DANGER_RED — dialog icon-circle backgrounds for destructive actions. */
export const DANGER_RED_SOFT = 'rgba(198, 40, 40, 0.12)';

export const CAPTURE_ACTION_BLUE = '#f97316';
export const CAPTURE_ACTION_BLUE_DISABLED = 'rgba(209, 209, 209, 0.76)';
/** Soft tint of CAPTURE_ACTION_BLUE — dialog icon-circle backgrounds for reset/retry actions. */
export const CAPTURE_ACTION_BLUE_SOFT = 'rgba(249, 115, 22, 0.14)';

/** Panel behind controls / modals (same family as overlay card). */
export const CAPTURE_PANEL_BORDER = 'rgb(15, 72, 157)';

/** Text and neutrals */
export const CAPTURE_TEXT_WHITE = 'rgb(255, 255, 255)';
export const CAPTURE_TEXT_BLUE = CAPTURE_PANEL_BORDER;

/** Overlays / backdrops */
export const CAPTURE_OVERLAY_BG = 'rgba(255, 255, 255, 0.90)';

/**
 * Full-screen camera modals (e.g. View Images, Reset): one tuned stack so blur matches everywhere.
 * Adjust only here unless a screen needs a deliberate exception.
 */
export const CAPTURE_MODAL_BLUR_TINT = 'light' as const;
export const CAPTURE_MODAL_BLUR_INTENSITY_ANDROID = 40;
export const CAPTURE_MODAL_BLUR_INTENSITY_IOS = 55;
export const CAPTURE_MODAL_UNIFORM_VEIL = 'rgba(255, 255, 255, 0.52)';
export const CAPTURE_MODAL_WEB_SCRIM = 'rgba(255, 255, 255, 0.88)';
export const CAPTURE_PROGRESS_TRACK_BG = 'rgba(255, 255, 255, 0.99)';

/** Screen surfaces */
export const CAPTURE_SCREEN_BG = BLACK;
export const CAPTURE_SCREEN_DARK_BG = GRAY_900;
export const CAPTURE_THUMBNAIL_BG = '#2a2a2a';
export const CAPTURE_SURFACE_WHITE = CAPTURE_TEXT_WHITE;

/** Guidance boundary and status */
export const CAPTURE_GUIDE_BORDER = 'rgba(255, 255, 255, 0.92)';
export const CAPTURE_GUIDE_FILL = 'rgba(255, 255, 255, 0.03)';
export const CAPTURE_OVERLAP_GUIDE_BORDER = 'rgba(255, 255, 255, 0.7)';
export const CAPTURE_VALID_BORDER = 'rgba(0, 219, 126, 0.9)';
/** Same color as CAPTURE_VALID_BORDER, as a plain hex — needed anywhere an alpha suffix
 * gets appended (e.g. GlowHalo's `${color}B3`), which rgba(...) strings can't take. */
export const CAPTURE_VALID_HEX = '#00db7e';
export const CAPTURE_INVALID_BORDER = 'rgba(255, 88, 88, 0.95)';
export const CAPTURE_VALID_BG = 'rgba(112, 255, 147, 0.15)';
export const CAPTURE_VALID_BORDER_SOFT = 'rgba(112, 255, 147, 0.5)';
export const CAPTURE_INVALID_BG = 'rgba(255, 128, 128, 0.15)';
export const CAPTURE_INVALID_BORDER_SOFT = 'rgba(255, 128, 128, 0.5)';

/** Orbit progress (walk-to-next-stop arc of dots) */
export const CAPTURE_ARC_DOT_DONE = CAPTURE_ACTION_BLUE;
export const CAPTURE_ARC_DOT_TARGET = 'rgba(0, 219, 126, 0.9)';
export const CAPTURE_ARC_DOT_UPCOMING = 'rgba(17, 17, 17, 0.25)';
export const CAPTURE_ARC_TRACK = 'rgba(17, 17, 17, 0.12)';
/** Thin outline color for the top-down car icon (line-art style, matching the
 * "Guided capture camera angles" intro screen's diagram). */
export const CAPTURE_ARC_CAR_LINE = '#333333';

/** Sweep direction UI */
export const SWEEP_CUE_BG = '#90b08d';
export const SWEEP_CUE_SHADOW = BLACK;
export const SWEEP_CUE_TEXT = '#f0f9ff';
export const SWEEP_CUE_TEXT_SHADOW = 'rgba(255, 255, 255, 0.9)';
export const SWEEP_MODAL_BACKDROP = 'rgba(48, 48, 48, 0.96)';
export const SWEEP_MODAL_BG = 'rgba(169, 169, 169, 0.45)';
export const SWEEP_MODAL_BORDER = 'rgba(178, 178, 178, 0.91)';
export const SWEEP_ACTION_BG = 'rgba(25, 163, 107, 0.2)';
export const SWEEP_ACTION_BORDER = 'rgba(72, 209, 149, 0.65)';

/** Scene video / recording screen */
export const CAPTURE_ACCENT_LIGHT_BLUE = '#9ecbff';
export const CAPTURE_TEXT_SILVER = '#c8c8c8';
export const CAPTURE_TEXT_EMPHASIS_ON_DARK = GRAY_LIGHTER;
export const CAPTURE_TEXT_PARAGRAPH_ON_DARK = GRAY_LIGHT;
export const CAPTURE_REC_BADGE_BG = 'rgba(220, 38, 38, 0.95)';
export const CAPTURE_STOP_DANGER_BG = DANGER_RED;
export const CAPTURE_BORDER_SUBTLE = '#555555';

/** Reset Capture dialog — cancel button border (distinct from CAPTURE_ACTION_BLUE). */
export const CAPTURE_RESET_CANCEL_BORDER = '#ff8801ff';

/**
 * Status pill (camera overlay) — grey "aligning" -> pulsing orange "almost"
 * -> green "steady" (which also triggers auto-capture). "almost" reuses
 * CAPTURE_ACTION_BLUE and "steady" reuses CAPTURE_VALID_BORDER so the pill
 * stays visually tied to the flow's existing accent/success colors.
 */
export const CAPTURE_STATUS_ALIGNING_BG = 'rgba(17, 17, 17, 0.55)';
export const CAPTURE_STATUS_PULSE_TINT = 'rgba(249, 115, 22, 0.3)';

/** Progress ring (camera overlay) track — subtle on the dark camera preview. */
export const CAPTURE_PROGRESS_RING_TRACK = 'rgba(255, 255, 255, 0.28)';

/** Viewfinder vignette — darkens outside the frame without a hard boundary line. */
export const CAPTURE_VIGNETTE_TINT = 'rgba(86, 86, 86, 0.55)';

/**
 * Guided Capture typography scale. One label size (chips, pills, captions)
 * and one headline size (screen titles, "Ready" prompts) — every hardcoded
 * font size in this flow's components should trace back to one of these.
 */
export const CAPTURE_TYPE_LABEL_SIZE = 13;
export const CAPTURE_TYPE_LABEL_WEIGHT = '600' as const;
export const CAPTURE_TYPE_HEADLINE_SIZE = 20;
export const CAPTURE_TYPE_HEADLINE_WEIGHT = '700' as const;

/* ------------------------------------------------------------------ */
/* Insurance flow — Home, Driving Licence, User Verification (drunk    */
/* test), 3rd Party, and Upload Accident Details screens.              */
/* ------------------------------------------------------------------ */

/** Text */
export const INSURANCE_TEXT = GRAY_900;
export const INSURANCE_TEXT_MUTED = '#666666';
export const INSURANCE_TEXT_MUTED_SOFT = '#9e9e9e';
export const INSURANCE_TEXT_DIM = '#333333';

/** Surfaces */
export const INSURANCE_SCREEN_BG = '#efefef';
export const INSURANCE_CAMERA_PLACEHOLDER_BG = '#d8d8d8';
export const INSURANCE_THUMBNAIL_BG = '#cccccc';

/** Borders */
export const INSURANCE_BORDER = BORDER_LIGHT;
export const INSURANCE_BORDER_SOFT = GRAY_LIGHT;

/** Pressed / hover overlays */
export const INSURANCE_PRESSED_SURFACE = '#f5f5f5';
export const INSURANCE_PRESSED_SURFACE_SOFT = '#fafafa';
export const INSURANCE_PRESSED_SURFACE_FAINT = '#f8f8f8';

/** Actions / links */
export const INSURANCE_PRIMARY = CAPTURE_ACTION_BLUE;
export const INSURANCE_CTA_LINK = '#1565c0';
/** Only the drunk-test camera/mic permission buttons use this blue instead of INSURANCE_PRIMARY. */
export const INSURANCE_PERMISSION_BLUE = '#1f8bff';

/** Upload Accident Details */
export const INSURANCE_PROGRESS_DONE = CAPTURE_ACTION_BLUE;
export const INSURANCE_CARD_BORDER_ACCENT = '#ff6b35';

/** Insurance home — step badges, status pills, report button */
export const INSURANCE_STEP_BADGE_BG = '#ffdda742';
export const INSURANCE_PILL_INCOMPLETE_BG = '#ffdda742';
export const INSURANCE_PILL_INCOMPLETE_TEXT = '#ff6b35';
export const INSURANCE_REPORT_BG = '#ff5c5c';
export const INSURANCE_REPORT_DISABLED_BG = GRAY_LIGHTER;
export const DONE_PRIMARY = '#21bb10ff';
export const DONE_BADGE_BG = '#70f06e2d';

/** User Verification (drunk test) screen extras */
export const INSURANCE_SCRIPT_BOX_BG = '#fff0e6';
export const INSURANCE_RECORDING_BAR_BG = 'rgba(220, 220, 220, 0.88)';
export const INSURANCE_VIDEO_TILE_BG = 'rgba(20, 20, 20, 0.85)';
export const INSURANCE_VIDEO_TILE_SUBTEXT = 'rgba(255, 255, 255, 0.75)';

/** Corner preview tile shadow (licence / third-party screens) */
export const INSURANCE_SHADOW_COLOR = BLACK;

