import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

export default function ConnectedScreen() {
  return (
    <Screen
      footer={
        <Button
          title="Back to Home screen"
          variant="secondary"
          onPress={() => router.replace("/(driver)/home")}
        />
      }
    >
      <HeaderBar
        right={
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
            }}
          >
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.success }}
            />
            <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>
              Connected
            </Text>
          </View>
        }
      />
      <Text style={{ ...typography.h1, color: palette.text }}>Connected to Mechanic</Text>

      <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: palette.surfaceMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 24 }}>👨‍🔧</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>Richardson P</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Mobile Mechanic · 4.9 ★
          </Text>
        </View>
        <ActionPill icon="💬" />
        <ActionPill icon="📞" tone="brand" />
      </Card>

      <View
        style={{
          height: 220,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Text style={{ fontSize: 48 }}>🗺️</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          Live route preview
        </Text>
      </View>

      <Card>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              Estimated Arrival
            </Text>
            <Text style={{ ...typography.h2, color: palette.text }}>5 minutes</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              Distance
            </Text>
            <Text style={{ ...typography.h2, color: palette.text }}>2.3 km</Text>
          </View>
        </View>
      </Card>
    </Screen>
  );
}

function ActionPill({ icon, tone }: { icon: string; tone?: "brand" }) {
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: tone === "brand" ? palette.brand : palette.surfaceMuted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
    </View>
  );
}
