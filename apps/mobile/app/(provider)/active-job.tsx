import { Text, View } from "react-native";
import { router } from "expo-router";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

export default function ActiveJobScreen() {
  return (
    <Screen
      footer={
        <Button
          title="ACCEPT JOB"
          onPress={() => router.replace("/(provider)/available")}
        />
      }
    >
      <HeaderBar />

      <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: palette.surfaceMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="UserRound" size={22} color={palette.textMuted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Priyantha
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            6.4 km · Galle Road, Colombo 03
          </Text>
        </View>
        <Badge label="Online" tone="success" withDot />
      </Card>

      <Card>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
        >
          <Icon name="TriangleAlert" size={22} color={palette.danger} />
          <Text style={{ ...typography.h3, color: palette.danger }}>Battery Dead</Text>
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          1.6 km away · Galle Road, Colombo 03
        </Text>
      </Card>

      <View
        style={{
          height: 180,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
        }}
      >
        <Icon name="Map" size={36} color={palette.textMuted} />
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          Route preview
        </Text>
      </View>

      <Card>
        <Row label="VEHICLE" value="Honda Civic - KB 1234" />
        <Row label="SERVICE" value="Jump Start" />
        <Row
          label="PRICE"
          value="LKR 1,000"
          valueColor={palette.brand}
          valueStyle={{ ...typography.h2, fontWeight: "700" }}
        />
        <Row
          label="TRAFFIC"
          value="HIGH"
          valueColor={palette.danger}
          valueStyle={{ ...typography.bodyStrong, fontWeight: "700" }}
        />
        <Row label="ETA" value="6 min" />
      </Card>
    </Screen>
  );
}

function Row({
  label,
  value,
  valueColor,
  valueStyle,
}: {
  label: string;
  value: string;
  valueColor?: string;
  valueStyle?: object;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
      }}
    >
      <Text style={{ ...typography.micro, color: palette.textMuted }}>{label}</Text>
      <Text
        style={{
          ...typography.bodyStrong,
          color: valueColor ?? palette.text,
          ...(valueStyle ?? {}),
        }}
      >
        {value}
      </Text>
    </View>
  );
}
