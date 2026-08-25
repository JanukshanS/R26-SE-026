import { Platform, Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, spacing, typography } from "@theme/index";
import { haptics } from "@lib/haptics";
import { useVehicleOptional } from "@lib/vehicleContext";

// Exported so screens can calculate scroll content padding correctly
export const NAV_BAR_HEIGHT = 56;

// How far the emergency button overhangs the top of the bar. The outer container
// reserves the same amount as transparent padding: on Android a touch landing
// outside a parent's bounds is never dispatched, so without it the overhanging
// top half of the button is not tappable.
const EMERGENCY_OVERHANG = 28;

type TabKey = "home" | "maintenance" | "store" | "profile";
type TabDef = { key: TabKey; label: string; icon: IconName };

const TABS_LEFT: TabDef[] = [
  { key: "home", label: "Home", icon: "House" },
  { key: "maintenance", label: "Maintenance", icon: "Wrench" },
];
const TABS_RIGHT: TabDef[] = [
  { key: "store", label: "Store", icon: "Store" },
  { key: "profile", label: "Profile", icon: "User" },
];

// Resolved pathnames of each tab's destination (route groups don't appear in
// the URL). Compared against the current path so a tab is only inert when it
// really is the screen on screen — "maintenance" is the active tab on
// service-records and trip-summary too, and must still return to health.
const TAB_PATHS: Record<TabKey, string> = {
  home: "/home",
  maintenance: "/health",
  store: "/marketplace",
  profile: "/profile",
};

export function BottomNavBar({ activeTab }: { activeTab: TabKey }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: EMERGENCY_OVERHANG,
      }}
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
        {TABS_LEFT.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={tab.key === activeTab} />
        ))}
        <EmergencyCenterButton />
        {TABS_RIGHT.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={tab.key === activeTab} />
        ))}
      </View>
    </View>
  );
}

function EmergencyCenterButton() {
  return (
    <Pressable
      onPress={() => {
        haptics.press();
        router.push("/(emergency)/whats-wrong");
      }}
      accessibilityRole="button"
      accessibilityLabel="Emergency assistance"
      style={({ pressed }) => ({
        opacity: pressed ? 0.88 : 1,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: palette.brand,
        alignItems: "center",
        justifyContent: "center",
        marginTop: -EMERGENCY_OVERHANG,
        ...Platform.select({
          ios: {
            shadowColor: palette.brand,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.35,
            shadowRadius: 10,
          },
          android: { elevation: 6 },
        }),
      })}
    >
      <Icon name="Siren" size={26} color={palette.textOnBrand} />
    </Pressable>
  );
}

function TabItem({ tab, active }: { tab: TabDef; active: boolean }) {
  // Optional: this bar now also renders inside route groups (e.g. (insurance))
  // that don't mount VehicleProvider — falls back to the plain profile icon there.
  const user = useVehicleOptional()?.user ?? null;
  const pathname = usePathname();
  const initials = user?.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // replace, not push: these are tabs, so switching between them must not stack a
  // new screen every time — home blocks the Android back button, so a stack built
  // by tab-hopping can never be popped again.
  return (
    <Pressable
      onPress={() => {
        if (pathname === TAB_PATHS[tab.key]) return;
        haptics.select();
        if (tab.key === "home") router.replace("/(driver)/home");
        if (tab.key === "maintenance") router.replace("/(driver)/health");
        if (tab.key === "store") router.replace("/(driver)/marketplace");
        if (tab.key === "profile") router.replace("/(driver)/profile");
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
      {tab.key === "profile" && user ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: palette.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: "700", color: palette.textOnBrand }}>
            {initials}
          </Text>
        </View>
      ) : (
        <Icon name={tab.icon} size={22} color={active ? palette.brand : palette.textMuted} />
      )}
      <Text
        style={{
          ...typography.micro,
          fontSize: 10,
          fontWeight: "600",
          color: active ? palette.brand : palette.textMuted,
          textAlign: "center",
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}
