import { Pressable, Text, View } from "react-native";
import { useAudioPlayer } from "expo-audio";
import { Icon } from "@components/ui/icon";
import { QuestionScreen } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, MobileSoundId } from "@lib/emergencyContext";

/**
 * The 4 sound options shown in the UI. Each carries the backend's Q3_sound
 * enum value as its `id` so we map straight through when submitting triage.
 *
 * `clip` is a short synthesized reference clip a driver can play to compare
 * against what their own car is doing — a text label like "Grinding Noise"
 * is hard to judge against an unfamiliar sound in the moment. "Nothing at
 * All" has none; there's nothing to demonstrate.
 */
const SOUNDS: { id: MobileSoundId; label: string; clip?: ReturnType<typeof require> }[] = [
  { id: "RAPID_CLICKING",  label: "Rapid Clicking",  clip: require("@assets/sounds/rapid-clicking.wav") },
  { id: "NORMAL_CRANKING", label: "Normal Cranking", clip: require("@assets/sounds/normal-cranking.wav") },
  { id: "GRINDING",        label: "Grinding Noise",  clip: require("@assets/sounds/grinding.wav") },
  { id: "NOTHING",         label: "Nothing at All" },
];

export default function DiagnosisSoundScreen() {
  const { sound, setSound } = useEmergency();

  return (
    <QuestionScreen
      route="diagnosis-sound"
      prompt="What sound does your vehicle make?"
      hint="Tap the speaker to hear each one, then select the closest match."
      canNext={!!sound}
    >

      {SOUNDS.map((s) => (
        <SoundOption
          key={s.id}
          label={s.label}
          clip={s.clip}
          selected={sound === s.id}
          onPress={() => setSound(s.id)}
        />
      ))}
    </QuestionScreen>
  );
}

function SoundOption({
  label,
  clip,
  selected,
  onPress,
}: {
  label: string;
  clip?: ReturnType<typeof require>;
  selected: boolean;
  onPress: () => void;
}) {
  // A player with no source is inert — safe to always call the hook (React
  // requires hooks called unconditionally) even for "Nothing at All".
  const player = useAudioPlayer(clip ?? null);

  function playClip() {
    player.seekTo(0);
    player.play();
  }

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
        gap: spacing.md,
      })}
    >
      {clip ? (
        <Pressable
          onPress={playClip}
          accessibilityRole="button"
          accessibilityLabel={`Play the ${label} reference sound`}
          hitSlop={8}
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <Icon name="Volume2" size={18} color={palette.brand} />
        </Pressable>
      ) : (
        <View style={{ width: 40, height: 40 }} />
      )}

      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>{label}</Text>

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
