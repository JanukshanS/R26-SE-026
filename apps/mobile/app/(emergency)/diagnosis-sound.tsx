import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, MobileSoundId } from "@lib/emergencyContext";

/**
 * The 4 sound options shown in the UI. Each carries the backend's Q3_sound
 * enum value as its `id` so we map straight through when submitting triage.
 */
const SOUNDS: { id: MobileSoundId; label: string }[] = [
  { id: "RAPID_CLICKING",  label: "Rapid Clicking" },
  { id: "NORMAL_CRANKING", label: "Normal Cranking" },
  { id: "GRINDING",        label: "Grinding Noise" },
  { id: "NOTHING",         label: "Nothing at All" },
];

export default function DiagnosisSoundScreen() {
  const { sound, setSound } = useEmergency();

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!sound}
          // Only reached when engine-state = CRANKS_NO_START (the engine
          // turns over but won't fire). After capturing the sound we
          // proceed to dashboard lights.
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
        Select the sound that best matches when you turn the key.
      </Text>

      {SOUNDS.map((s) => (
        <SoundOption
          key={s.id}
          label={s.label}
          selected={sound === s.id}
          onPress={() => setSound(s.id)}
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
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
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
          backgroundColor: selected ? palette.brand : palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? <Icon name="Check" size={16} color={palette.textOnBrand} /> : null}
      </View>
    </Pressable>
  );
}
