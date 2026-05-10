import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

export default function DiagnosisResultScreen() {
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
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Result</Text>

      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: palette.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 16 }}>🤖</Text>
          </View>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Service Assistant says
          </Text>
        </View>
        <View
          style={{
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: palette.border,
            gap: spacing.sm,
          }}
        >
          <Row label="DIAGNOSIS" value="Battery Dead" valueColor={palette.danger} />
          <Row label="SERVICE" value="Jump Start needed" />
        </View>
      </Card>

      <Card variant="muted" style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 40 }}>🔧</Text>
        </View>
        <Text style={{ ...typography.h3, color: palette.text }}>
          Fetching a Service Provider
        </Text>
        <Text
          style={{
            ...typography.caption,
            color: palette.textMuted,
            textAlign: "center",
          }}
        >
          You will be connected to a Mobile Mechanic
        </Text>
      </Card>

      <Button
        title="See Connected Mechanic"
        onPress={() => router.push("/(emergency)/connected")}
      />
    </Screen>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Text style={{ ...typography.micro, color: palette.textMuted, width: 88 }}>
        {label}
      </Text>
      <Text
        style={{
          ...typography.bodyStrong,
          color: valueColor ?? palette.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
