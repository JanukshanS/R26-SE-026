import { ScrollView, View, type ViewStyle, type StyleProp } from "react-native";
import { palette, spacing } from "@theme/index";

type Props = {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  background?: "default" | "surface";
  footer?: React.ReactNode;
  padded?: boolean;
};

export function Screen({
  children,
  contentContainerStyle,
  scrollable = true,
  background = "default",
  footer,
  padded = true,
}: Props) {
  const bg = background === "surface" ? palette.surface : palette.background;

  const content = (
    <View
      style={[
        {
          flex: 1,
          padding: padded ? spacing.xl : 0,
          gap: spacing.lg,
        },
      ]}
    >
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {scrollable ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            {
              flexGrow: 1,
              padding: padded ? spacing.xl : 0,
              gap: spacing.lg,
            },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        content
      )}
      {footer ? (
        <View
          style={{
            padding: spacing.xl,
            paddingTop: spacing.md,
            gap: spacing.md,
            backgroundColor: bg,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
