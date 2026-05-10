import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon, type IconName } from "@components/ui/icon";
import { QuickAction } from "@components/ui/quick-action";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

const TABS: { name: string; icon: IconName; active?: boolean }[] = [
  { name: "Home", icon: "House", active: true },
  { name: "Profile", icon: "User" },
  { name: "Map", icon: "MapPin" },
  { name: "Chat", icon: "MessageCircle" },
];

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Screen
        edges={["top"]}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
      >
        <Text style={{ ...typography.body, color: palette.textMuted }}>
          Hi, <Text style={{ color: palette.text, fontWeight: "600" }}>Janukshan!</Text>
        </Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <Text style={{ ...typography.h1, color: palette.text }}>Toyota Aqua</Text>
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: spacing.md,
              paddingVertical: 4,
              borderRadius: radii.pill,
              backgroundColor: palette.brandSoft,
            }}
          >
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              2010-2012
            </Text>
            <Icon name="ChevronDown" size={14} color={palette.brand} />
          </Pressable>
        </View>

        <Card>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Vehicle Health
            </Text>
            <Badge label="Good" tone="success" />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              gap: spacing.xs,
            }}
          >
            <Text style={{ ...typography.display, color: palette.text }}>87</Text>
            <Text style={{ ...typography.h2, color: palette.textMuted }}>%</Text>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.surfaceMuted,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: "87%",
                height: "100%",
                backgroundColor: palette.success,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              gap: spacing.lg,
              marginTop: spacing.xs,
            }}
          >
            <Indicator label="Brakes Due" value="in 4 weeks" />
            <Indicator label="Service Due" value="in 2 weeks" />
          </View>
        </Card>

        <View style={{ gap: spacing.md }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Quick Actions</Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction icon="CircleDot" label="Tyre" />
            <QuickAction icon="Fuel" label="Fuel" />
            <QuickAction icon="Key" label="Locksmith" />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction icon="Wrench" label="Service" />
            <QuickAction icon="Package" label="Order parts" />
            <QuickAction icon="ShieldCheck" label="Insurance" />
          </View>
        </View>

        <Button
          title="1990 - Emergency Ambulance"
          variant="danger"
          leftIcon={<Icon name="Siren" size={18} color={palette.textOnBrand} />}
          onPress={() => {}}
        />

        <Button
          title="Get the Support"
          onPress={() => router.push("/(emergency)/safety-check")}
        />
      </Screen>

      <BottomTabs />
    </View>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning }} />
      <Text style={{ ...typography.caption, color: palette.text }}>
        {label} <Text style={{ color: palette.textMuted }}>{value}</Text>
      </Text>
    </View>
  );
}

function BottomTabs() {
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
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
        }}
      >
        <TabItem item={TABS[0]} />
        <TabItem item={TABS[1]} />
        <Pressable
          style={({ pressed }) => ({
            opacity: pressed ? 0.85 : 1,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: palette.brand,
            alignItems: "center",
            justifyContent: "center",
            marginTop: -28,
            boxShadow: "0 6px 14px rgba(249, 115, 22, 0.35)",
          })}
        >
          <Icon name="Siren" size={26} color={palette.textOnBrand} />
        </Pressable>
        <TabItem item={TABS[2]} />
        <TabItem item={TABS[3]} />
      </View>
    </View>
  );
}

function TabItem({ item }: { item: (typeof TABS)[number] }) {
  return (
    <View style={{ alignItems: "center", padding: spacing.sm, gap: 2 }}>
      <Icon
        name={item.icon}
        size={22}
        color={item.active ? palette.brand : palette.textMuted}
      />
      <Text
        style={{
          ...typography.micro,
          color: item.active ? palette.brand : palette.textMuted,
          fontWeight: "600",
          fontSize: 10,
        }}
      >
        {item.name}
      </Text>
    </View>
  );
}
