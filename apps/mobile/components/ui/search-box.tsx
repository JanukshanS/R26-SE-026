import { Pressable, TextInput, View } from "react-native";

import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";

/** Search field and centred-state wrapper shared by the Garages and Parts screens. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        backgroundColor: palette.surfaceMuted,
        borderRadius: radii.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      <Icon name="Search" size={18} color={palette.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={{ flex: 1, ...typography.body, color: palette.text, paddingVertical: 2 }}
      />
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={8}>
          <Icon name="X" size={16} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>{children}</View>;
}
