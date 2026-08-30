/**
 * MapPreview (web) — placeholder for the web build.
 *
 * `react-native-maps` is native-only and crashes the web bundle if imported,
 * so Metro picks THIS file when bundling for web (`.web.tsx` extension wins
 * over `.tsx`). Native targets load map-preview.tsx instead.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { ProviderRecord } from "@lib/dispatchApi";
import { useT } from "@lib/i18n";

interface MapPreviewProps {
  driverLocation: { latitude: number; longitude: number };
  provider:       ProviderRecord | null;
  etaText?:       string | null;
  distanceText?:  string | null;
}

export function MapPreview({ etaText, distanceText }: MapPreviewProps) {
  const t = useT();
  return (
    <View
      style={{
        height: 240,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        backgroundColor: palette.surfaceMuted,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        padding: spacing.lg,
      }}
    >
      <Icon name="Map" size={48} color={palette.textMuted} />
      <Text
        style={{
          ...typography.caption,
          color: palette.textMuted,
          textAlign: "center",
        }}
      >
        {t("components.map.webPlaceholder")}
      </Text>
      {(etaText || distanceText) && (
        <Text
          style={{
            ...typography.micro,
            color: palette.textMuted,
            textAlign: "center",
          }}
        >
          {etaText} {etaText && distanceText ? "·" : ""} {distanceText}
        </Text>
      )}
    </View>
  );
}
