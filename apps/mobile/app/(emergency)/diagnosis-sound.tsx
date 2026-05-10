import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";

const SOUNDS = [
  "Rapid Clicking",
  "Normal Cranking",
  "Grinding Noise",
  "Nothing at All",
] as const;

export default function DiagnosisSoundScreen() {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!picked}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What sound does your vehicle make?
      </Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>
        Tap ▶ to hear a sample, then select the one that matches.
      </Text>

      {SOUNDS.map((sound) => (
        <SoundOption
          key={sound}
          label={sound}
          selected={picked === sound}
          onPress={() => setPicked(sound)}
        />
      ))}
    </Screen>
  );
}

function SoundOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.brand : palette.border,
        padding: spacing.lg,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      })}
    >
      <Text style={{ ...typography.body, color: palette.text }}>{label}</Text>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: palette.brand }}>▶</Text>
      </View>
    </Pressable>
  );
}
