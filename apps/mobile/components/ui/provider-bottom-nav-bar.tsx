import { Platform, Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, spacing, typography } from "@theme/index";
import { haptics } from "@lib/haptics";

// Exported so screens can pad scrollable content correctly — same role as
// bottom-nav-bar.tsx's NAV_BAR_HEIGHT, kept separate since the two bars
// aren't the same height (no emergency-button overhang here).
export const PROVIDER_NAV_BAR_HEIGHT = 56;

type TabKey = "jobs" | "services" | "history" | "profile";
type TabDef = { key: TabKey; label: string; icon: IconName };

const TABS: TabDef[] = [
  { key: "jobs", label: "Jobs", icon: "ClipboardList" },
  { key: "services", label: "Services", icon: "Wrench" },
  { key: "history", label: "History", icon: "History" },
  { key: "profile", label: "Profile", icon: "User" },
];

const TAB_PATHS: Record<TabKey, string> = {
  jobs: "/available",
  services: "/services",
  history: "/history",
  profile: "/profile",
};

const TAB_ROUTES: Record<TabKey, string> = {
  jobs: "/(provider)/available",
  services: "/(provider)/services",
  history: "/(provider)/history",
  profile: "/(provider)/profile",
};

export function ProviderBottomNavBar({ activeTab }: { activeTab: TabKey }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm + insets.bottom,
          paddingHorizontal: spacing.xs,
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.06,
              shadowRadius: 4,
            },
            android: { elevation: 12 },
          }),
        }}
      >
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (pathname === TAB_PATHS[tab.key]) return;
                haptics.select();
                router.replace(TAB_ROUTES[tab.key] as Parameters<typeof router.replace>[0]);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.xs,
                gap: 2,
                minWidth: 62,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon name={tab.icon} size={22} color={active ? palette.brand : palette.textMuted} />
              <Text
                style={{
                  ...typography.micro,
                  fontSize: 10,
                  fontWeight: "600",
                  color: active ? palette.brand : palette.textMuted,
                  textAlign: "center",
                }}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
