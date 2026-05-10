import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

const LIGHTS = [
  { id: "engine", icon: "⚙️", label: "Engine" },
  { id: "oil", icon: "🛢️", label: "Oil" },
  { id: "battery", icon: "🔋", label: "Battery" },
  { id: "brake", icon: "🛑", label: "Brake" },
  { id: "abs", icon: "🅰️", label: "ABS" },
  { id: "fuel", icon: "⛽", label: "Fuel" },
  { id: "tyre", icon: "🛞", label: "Tyre" },
  { id: "temp", icon: "🌡️", label: "Temp" },
  { id: "other", icon: "❗", label: "Other" },
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
                gap: spacing.xs,
              })}
            >
              <Text style={{ fontSize: 28 }}>{light.icon}</Text>
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
