import { Text, View } from "react-native";
import { palette, radii, spacing, typography } from "@theme/index";

type Props = {
  label: string;
};

/** Small neutral tag for a secondary fact on a card (a plate number, a policy
 * number) — distinct from `Badge`, which is for tone-colored status/state. */
export function Chip({ label }: Props) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        backgroundColor: palette.homeBackground,
      }}
    >
      <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
