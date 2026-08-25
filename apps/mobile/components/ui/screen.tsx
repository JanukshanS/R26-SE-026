import { ScrollView, View, type ViewStyle, type StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, spacing } from "@theme/index";

type Props = {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  background?: "default" | "surface" | "home";
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
  const bg =
    background === "surface"
      ? palette.surface
      : background === "home"
        ? palette.homeBackground
        : palette.background;

  const paddingTop = edges.includes("top") ? insets.top : 0;
  const paddingBottom = edges.includes("bottom") ? insets.bottom : 0;

  const innerHorizontal = padded ? spacing.xl : 0;
  const innerTop = (padded ? spacing.xl : 0) + paddingTop;
  const innerBottom = padded ? spacing.xl : 0;

  if (scrollable) {
    return (
      <View style={{ flex: 1, backgroundColor: bg }}>
        {/* Reserves the status-bar safe area as a fixed spacer OUTSIDE the
            ScrollView, not as top padding on its content. Padding on the
            scrollable content only protects the very first frame — the moment
            the user scrolls, later content slides up underneath the
            (transparent, edge-to-edge) status bar with nothing reserved for
            it any more. A fixed sibling above the ScrollView stays put
            regardless of scroll position, the same way the footer spacer
            below already does for the bottom inset. */}
        <View style={{ height: paddingTop, backgroundColor: bg }} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            {
              flexGrow: 1,
              paddingTop: padded ? spacing.xl : 0,
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
