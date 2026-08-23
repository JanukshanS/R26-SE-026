import { Pressable, Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { QuestionScreen } from "@components/ui/question-screen";
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
    <QuestionScreen
      route="diagnosis-sound"
      prompt="What sound does your vehicle make?"
      hint="Select the sound that best matches when you turn the key."
      canNext={!!sound}
    >

      {SOUNDS.map((s) => (
        <SoundOption
          key={s.id}
          label={s.label}
          selected={sound === s.id}
          onPress={() => setSound(s.id)}
        />
      ))}
    </QuestionScreen>
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
