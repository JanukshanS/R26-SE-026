import { Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { getPairing } from "@lib/elm327";
import { useT } from "@lib/i18n";

/**
 * Shows whether OBD-II data is coming from a real ELM327 over Bluetooth or
 * the on-device simulator — so a trip's data source is never ambiguous.
 * Renders nothing when unpaired.
 */
export function ObdSourceBadge() {
  const t = useT();
  const pairing = getPairing();
  if (!pairing) return null;

  const isReal = pairing.source === "ble" || pairing.source === "classic";
  const color = isReal ? palette.success : palette.warning;
  const bg = isReal ? palette.successSoft : palette.warningSoft;
  const label = isReal
    ? pairing.deviceName || t("components.obd.live")
    : t("components.obd.simulated");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: 5,
        borderRadius: radii.pill,
        backgroundColor: bg,
        alignSelf: "flex-start",
      }}
    >
      <Icon name={isReal ? "BluetoothConnected" : "FlaskConical"} size={13} color={color} />
      <Text style={{ ...typography.caption, color, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
