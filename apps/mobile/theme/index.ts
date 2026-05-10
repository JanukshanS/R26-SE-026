export const palette = {
  brand: "#F97316",
  brandPressed: "#EA6A0F",
  brandSoft: "#FFEDD5",
  background: "#FFF7E6",
  surface: "#FFFFFF",
  surfaceMuted: "#FAF1DC",
  border: "#F0E2C8",
  borderStrong: "#D6C39A",
  text: "#1B1B1B",
  textMuted: "#6B7280",
  textOnBrand: "#FFFFFF",
  success: "#10B981",
  successSoft: "#D1FAE5",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
  danger: "#EF4444",
  dangerSoft: "#FEE2E2",
  overlay: "rgba(15, 15, 15, 0.4)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: "700" as const, lineHeight: 38 },
  h1: { fontSize: 24, fontWeight: "700" as const, lineHeight: 30 },
  h2: { fontSize: 20, fontWeight: "600" as const, lineHeight: 26 },
  h3: { fontSize: 16, fontWeight: "600" as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
  micro: { fontSize: 11, fontWeight: "500" as const, lineHeight: 14, letterSpacing: 0.6 },
} as const;

export const shadows = {
  card: "0 1px 2px rgba(15, 15, 15, 0.06)",
  raised: "0 4px 12px rgba(15, 15, 15, 0.08)",
} as const;
