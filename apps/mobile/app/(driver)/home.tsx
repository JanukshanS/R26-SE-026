import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { QuickAction } from "@components/ui/quick-action";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

export default function DriverHomeScreen() {
  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.xl, gap: spacing.lg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ ...typography.body, color: palette.textMuted }}>
            Hi, <Text style={{ color: palette.text, fontWeight: "600" }}>Janukshan!</Text>
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            paddingVertical: spacing.sm,
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
            <Text style={{ color: palette.brand }}>▾</Text>
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
            <Indicator label="Breaks Due" value="in 4 weeks" tone="warning" />
            <Indicator label="Breaks D..." value="" tone="warning" />
          </View>
        </Card>

        <View style={{ gap: spacing.md }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Quick Actions</Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction icon="🛞" label="Tyre" />
            <QuickAction icon="⛽" label="Fuel" />
            <QuickAction icon="🔑" label="Locksmith" />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction icon="🛠️" label="Service" />
            <QuickAction icon="📦" label="Order parts" />
            <QuickAction icon="🛡️" label="Insurance" />
          </View>
        </View>

        <Button
          title="1990 - Emergency Ambulance"
          variant="danger"
          onPress={() => {}}
        />

        <Button
          title="Get the Support"
          onPress={() => router.push("/(emergency)/safety-check")}
        />
      </View>

      <BottomTabs />
    </Screen>
  );
}

function Indicator({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warning" | "danger";
}) {
  const color = tone === "warning" ? palette.warning : palette.danger;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <View
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
      />
      <Text style={{ ...typography.caption, color: palette.text }}>
        {label} <Text style={{ color: palette.textMuted }}>{value}</Text>
      </Text>
    </View>
  );
}

function BottomTabs() {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        backgroundColor: palette.surface,
        borderTopWidth: 1,
        borderTopColor: palette.border,
      }}
    >
      <TabIcon icon="🏠" active />
      <TabIcon icon="👤" />
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: palette.brand,
          alignItems: "center",
          justifyContent: "center",
          marginTop: -28,
          boxShadow: "0 4px 12px rgba(249, 115, 22, 0.3)",
        }}
      >
        <Text style={{ fontSize: 24 }}>🚨</Text>
      </View>
      <TabIcon icon="📍" />
      <TabIcon icon="💬" />
    </View>
  );
}

function TabIcon({ icon, active }: { icon: string; active?: boolean }) {
  return (
    <View style={{ alignItems: "center", padding: spacing.sm }}>
      <Text style={{ fontSize: 22, opacity: active ? 1 : 0.4 }}>{icon}</Text>
    </View>
  );
}
