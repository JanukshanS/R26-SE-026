import { Pressable, Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { QuestionScreen } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, MobileSoundId } from "@lib/emergencyContext";
import { useT } from "@lib/i18n";

/**
 * The 4 sound options shown in the UI. Each carries the backend's Q3_sound
 * enum value as its `id` so we map straight through when submitting triage.
 */
const SOUNDS: { id: MobileSoundId; labelKey: string }[] = [
  { id: "RAPID_CLICKING",  labelKey: "emergency.sound.rapidClicking" },
  { id: "NORMAL_CRANKING", labelKey: "emergency.sound.normalCranking" },
  { id: "GRINDING",        labelKey: "emergency.sound.grinding" },
  { id: "NOTHING",         labelKey: "emergency.sound.nothing" },
];

export default function DiagnosisSoundScreen() {
  const t = useT();
  const { sound, setSound } = useEmergency();

  return (
    <QuestionScreen
      route="diagnosis-sound"
      prompt={t("emergency.sound.prompt")}
      hint={t("emergency.sound.hint")}
      canNext={!!sound}
    >

      {SOUNDS.map((s) => (
        <SoundOption
          key={s.id}
          label={t(s.labelKey)}
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
