/**
 * Guided capture color tokens.
 * Edit these values to tweak UI colors in one place.
 */
export const CAPTURE_ACTION_BLUE = 'rgb(0, 128, 255)';
export const CAPTURE_ACTION_BLUE_DISABLED = 'rgba(209, 209, 209, 0.76)';

/** Panel behind controls / modals (same family as overlay card). */
export const CAPTURE_PANEL_BORDER = 'rgb(15, 72, 157)';

/** Text and neutrals */
export const CAPTURE_TEXT_WHITE = 'rgb(255, 255, 255)';
export const CAPTURE_TEXT_BLUE = 'rgb(15, 72, 157)';

/** Overlays / backdrops */
export const CAPTURE_OVERLAY_BG = 'rgba(255, 255, 255, 0.90)';

/**
 * Full-screen camera modals (e.g. View Images, Reset): one tuned stack so blur matches everywhere.
 * Adjust only here unless a screen needs a deliberate exception.
 */
export const CAPTURE_MODAL_BLUR_TINT = 'light' as const;
export const CAPTURE_MODAL_BLUR_INTENSITY_ANDROID = 40;
export const CAPTURE_MODAL_BLUR_INTENSITY_IOS = 55;
export const CAPTURE_MODAL_BLUR_REDUCTION_ANDROID = 8;
export const CAPTURE_MODAL_UNIFORM_VEIL = 'rgba(255, 255, 255, 0.52)';
export const CAPTURE_MODAL_WEB_SCRIM = 'rgba(255, 255, 255, 0.88)';
export const CAPTURE_PROGRESS_TRACK_BG = 'rgba(255, 255, 255, 0.99)';

/** Screen surfaces */
export const CAPTURE_SCREEN_BG = '#000';
export const CAPTURE_SCREEN_DARK_BG = '#111';
export const CAPTURE_THUMBNAIL_BG = '#2a2a2a';
export const CAPTURE_SURFACE_WHITE = 'rgb(255, 255, 255)';

/** Guidance boundary and status */
export const CAPTURE_GUIDE_BORDER = 'rgba(255, 255, 255, 0.92)';
export const CAPTURE_GUIDE_FILL = 'rgba(255, 255, 255, 0.03)';
export const CAPTURE_OVERLAP_GUIDE_BORDER = 'rgba(255, 255, 255, 0.7)';
export const CAPTURE_VALID_BORDER = 'rgba(0, 219, 126, 0.9)';
export const CAPTURE_INVALID_BORDER = 'rgba(255, 88, 88, 0.95)';
export const CAPTURE_VALID_BG = 'rgba(112, 255, 147, 0.15)';
export const CAPTURE_VALID_BORDER_SOFT = 'rgba(112, 255, 147, 0.5)';
export const CAPTURE_INVALID_BG = 'rgba(255, 128, 128, 0.15)';
export const CAPTURE_INVALID_BORDER_SOFT = 'rgba(255, 128, 128, 0.5)';

/** Sweep direction UI */
export const SWEEP_CUE_BG = '#90b08d';
export const SWEEP_CUE_SHADOW = '#000';
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
export const CAPTURE_TEXT_EMPHASIS_ON_DARK = '#e8e8e8';
export const CAPTURE_TEXT_PARAGRAPH_ON_DARK = '#e0e0e0';
export const CAPTURE_REC_BADGE_BG = 'rgba(220, 38, 38, 0.95)';
export const CAPTURE_STOP_DANGER_BG = '#c62828';
export const CAPTURE_BORDER_SUBTLE = '#555555';
