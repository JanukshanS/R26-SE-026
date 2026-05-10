import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

const LIGHTS: { id: string; icon: IconName; label: string }[] = [
  { id: "engine", icon: "Cog", label: "Engine" },
  { id: "oil", icon: "Droplet", label: "Oil" },
  { id: "battery", icon: "BatteryWarning", label: "Battery" },
  { id: "brake", icon: "OctagonAlert", label: "Brake" },
  { id: "abs", icon: "CircleSlash2", label: "ABS" },
  { id: "fuel", icon: "Fuel", label: "Fuel" },
  { id: "tyre", icon: "CircleDot", label: "Tyre" },
  { id: "temp", icon: "Thermometer", label: "Temp" },
  { id: "other", icon: "TriangleAlert", label: "Other" },
];

export default function DiagnosisLightsScreen() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          onPress={() => router.push("/(emergency)/diagnosis-result")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Which dashboard lights are on?
      </Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>
        Tap all warning lights you see on your dashboard.
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.md,
        }}
      >
        {LIGHTS.map((light) => {
          const active = selected.has(light.id);
          return (
            <Pressable
              key={light.id}
              onPress={() => toggle(light.id)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                width: "30%",
                aspectRatio: 1,
                backgroundColor: active ? palette.text : palette.surface,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: active ? palette.text : palette.border,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              })}
            >
              <Icon
                name={light.icon}
                size={28}
                color={active ? palette.warning : palette.textMuted}
              />
              <Text
                style={{
                  ...typography.caption,
                  color: active ? palette.warning : palette.textMuted,
                  fontWeight: "600",
                }}
              >
                {light.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
