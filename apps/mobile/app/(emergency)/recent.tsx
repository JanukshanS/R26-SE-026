import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, type RecentSign } from "@lib/emergencyContext";

const OPTIONS: { value: RecentSign; title: string; subtitle: string }[] = [
  { value: "HARD_START",         title: "Engine was harder to start",  subtitle: "Cranking has been getting slower" },
  { value: "LIGHTS_FLICKER",     title: "Dashboard lights flickering", subtitle: "Lights dim or flicker while driving" },
  { value: "LOSS_OF_POWER",      title: "Lost power while driving",    subtitle: "Sudden drop in acceleration" },
  { value: "OVERHEATING_BEFORE", title: "Temperature gauge went up",   subtitle: "Engine ran hot before" },
  { value: "UNUSUAL_NOISE",      title: "Unusual noise recently",      subtitle: "New rattle, squeal, or grind" },
  { value: "SMELL_BEFORE",       title: "Noticed a smell in past days", subtitle: "Something didn't smell right" },
  { value: "NO_SIGNS",           title: "No warning signs",            subtitle: "Happened suddenly with no warning" },
];

export default function RecentScreen() {
  const { recentSigns, toggleRecentSign } = useEmergency();

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={recentSigns.size === 0}
          onPress={() => router.push("/(emergency)/context")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Any warning signs in the past few days?
      </Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>
        Tap all that apply.
      </Text>

      {OPTIONS.map((o) => {
        const active = recentSigns.has(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => toggleRecentSign(o.value)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              backgroundColor: active ? palette.brandSoft : palette.surface,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: active ? 2 : 1,
              borderColor: active ? palette.brand : palette.border,
              padding: spacing.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
            })}
          >
            <View
              style={{
                width: 24, height: 24, borderRadius: 6,
                borderWidth: 2,
                borderColor: active ? palette.brand : palette.border,
                backgroundColor: active ? palette.brand : "transparent",
                alignItems: "center", justifyContent: "center",
              }}
            >
              {active && <Icon name="Check" size={14} color={palette.textOnBrand} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>{o.title}</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>{o.subtitle}</Text>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}
