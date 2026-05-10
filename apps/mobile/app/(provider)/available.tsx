import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";

const SERVICES = [
  "Battery Jump Start",
  "Battery Replacement",
  "Flat Tire Change",
  "Fuel Delivery",
  "Basic Mechanical Diagnosis",
  "Towing",
];

export default function ProviderAvailableScreen() {
  const [online, setOnline] = useState(true);

  return (
    <Screen padded={false}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.xl,
          paddingBottom: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
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
            <Text style={{ fontSize: 22 }}>👤</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>Priyantha</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>Mobile Mechanic</Text>
          </View>
        </View>
        <Badge label={online ? "Online" : "Offline"} tone={online ? "success" : "neutral"} withDot />
      </View>

      <View style={{ padding: spacing.xl, gap: spacing.lg }}>
        <Card>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {online ? "Available" : "Offline"}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Since 07:30 AM
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.sm }}>
            <Button
              title={online ? "GO OFFLINE" : "GO ONLINE"}
              variant="secondary"
              size="md"
              onPress={() => setOnline((v) => !v)}
            />
            <Button title="UPDATE LOCATION" size="md" onPress={() => {}} />
          </View>
        </Card>

        <Card variant="muted" style={{ alignItems: "center", paddingVertical: spacing.xxl }}>
          <Text style={{ fontSize: 40 }}>📭</Text>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            No pending jobs in your area
          </Text>
          <Text
            style={{
              ...typography.caption,
              color: palette.textMuted,
              textAlign: "center",
            }}
          >
            We'll notify you when a request comes in.
          </Text>
        </Card>

        <View style={{ gap: spacing.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ ...typography.h3, color: palette.text }}>My Services</Text>
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              Edit Services
            </Text>
          </View>
          <Card>
            {SERVICES.map((service, idx) => (
              <View key={service}>
                <Text style={{ ...typography.body, color: palette.text }}>{service}</Text>
                {idx < SERVICES.length - 1 ? (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: palette.border,
                      marginVertical: spacing.sm,
                    }}
                  />
                ) : null}
              </View>
            ))}
          </Card>
        </View>

        <Button
          title="Preview an Active Job"
          variant="secondary"
          onPress={() => router.push("/(provider)/active-job")}
        />
      </View>
    </Screen>
  );
}
