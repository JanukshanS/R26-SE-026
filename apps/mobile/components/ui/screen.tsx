import { ScrollView, View, type ViewStyle, type StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, spacing } from "@theme/index";

type Props = {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  background?: "default" | "surface";
  footer?: React.ReactNode;
  padded?: boolean;
  edges?: ("top" | "bottom")[];
};

export function Screen({
  children,
  contentContainerStyle,
  scrollable = true,
  background = "default",
  footer,
  padded = true,
  edges = ["top", "bottom"],
}: Props) {
  const insets = useSafeAreaInsets();
  const bg = background === "surface" ? palette.surface : palette.background;

  const paddingTop = edges.includes("top") ? insets.top : 0;
  const paddingBottom = edges.includes("bottom") ? insets.bottom : 0;

  const innerHorizontal = padded ? spacing.xl : 0;
  const innerTop = (padded ? spacing.xl : 0) + paddingTop;
  const innerBottom = padded ? spacing.xl : 0;

  if (scrollable) {
    return (
      <View style={{ flex: 1, backgroundColor: bg }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            {
              flexGrow: 1,
              paddingTop: innerTop,
              paddingBottom: innerBottom,
              paddingHorizontal: innerHorizontal,
              gap: spacing.lg,
            },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.md,
              paddingBottom: paddingBottom + spacing.md,
              gap: spacing.md,
              backgroundColor: bg,
            }}
          >
            {footer}
          </View>
        ) : (
          <View style={{ height: paddingBottom, backgroundColor: bg }} />
        )}
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        paddingTop: innerTop,
        paddingHorizontal: innerHorizontal,
        paddingBottom: footer ? 0 : innerBottom + paddingBottom,
        gap: spacing.lg,
      }}
    >
      {children}
      {footer ? (
        <View
          style={{
            marginHorizontal: -innerHorizontal,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.md,
            paddingBottom: paddingBottom + spacing.md,
            gap: spacing.md,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
