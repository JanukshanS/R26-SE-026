import { Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, spacing, typography } from "@theme/index";
import { haptics } from "@lib/haptics";
import { useVehicle } from "@lib/vehicleContext";

// Exported so screens can calculate scroll content padding correctly
export const NAV_BAR_HEIGHT = 56;

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

export function BottomNavBar({ activeTab }: { activeTab: TabKey }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom,
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
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.xs,
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
        router.push("/(emergency)/safety-check");
      }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.88 : 1,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: palette.brand,
        alignItems: "center",
        justifyContent: "center",
        marginTop: -28,
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
  const { user } = useVehicle();
  const initials = user?.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Pressable
      onPress={() => {
        haptics.select();
        if (tab.key === "home") router.push("/(driver)/home");
        if (tab.key === "maintenance") router.push("/(driver)/health");
        if (tab.key === "store") router.push("/(driver)/order-parts");
        if (tab.key === "profile") router.push("/(driver)/profile");
      }}
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
