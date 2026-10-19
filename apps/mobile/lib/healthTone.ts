import type { IconName } from "@components/ui/icon";
import { palette } from "@theme/index";

import type { ComponentStatus } from "@lib/maintenanceApi";

export interface StatusTone {
  fg: string;
  bg: string;
  icon: IconName;
}

/**
 * Colour and icon for a component's wear status, shared by the home card and
 * the health screen so the same status always looks the same.
 *
 * Driven by the server's status rather than recomputed from health_pct here:
 * the label beside it is that status too, and two thresholds that drift apart
 * are how a "Fair" part ends up drawn in red.
 */
export function statusTone(status: ComponentStatus): StatusTone {
  switch (status) {
    case "Good":
      return { fg: palette.success, bg: palette.successSoft, icon: "CheckCircle" };
    case "Fair":
      return { fg: palette.warning, bg: palette.warningSoft, icon: "AlertCircle" };
    case "Poor":
      return { fg: palette.danger, bg: palette.dangerSoft, icon: "AlertTriangle" };
    case "Critical":
      return { fg: palette.danger, bg: palette.dangerSoft, icon: "OctagonAlert" };
    default:
      return { fg: palette.textMuted, bg: palette.surfaceMuted, icon: "Info" };
  }
}
