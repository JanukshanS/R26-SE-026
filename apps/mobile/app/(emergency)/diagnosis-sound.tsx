import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useVideoPlayer } from "expo-video";
import { Icon } from "@components/ui/icon";
import { QuestionScreen } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, MobileSoundId } from "@lib/emergencyContext";
import { useT } from "@lib/i18n";

/**
 * The 4 sound options shown in the UI. Each carries the backend's Q3_sound
 * enum value as its `id` so we map straight through when submitting triage.
 *
 * `clip` is a short reference sound the driver can compare against what
 * their own car is doing — "Grinding Noise" is hard to judge from the words
 * alone in the moment. "Nothing at All" has none; there is nothing to play.
 *
 * Played through expo-video rather than expo-audio: it handles an audio-only
 * source fine, and it is already in the app's native build (the guided-capture
 * pose illustrations use it), so adding sound here needs no new native module
 * and no rebuild.
 */
const SOUNDS: { id: MobileSoundId; labelKey: string; clip: number | null }[] = [
  { id: "RAPID_CLICKING",  labelKey: "emergency.sound.rapidClicking",  clip: require("@assets/sounds/rapid-clicking.wav") },
  { id: "NORMAL_CRANKING", labelKey: "emergency.sound.normalCranking", clip: require("@assets/sounds/normal-cranking.wav") },
  { id: "GRINDING",        labelKey: "emergency.sound.grinding",       clip: require("@assets/sounds/grinding.wav") },
  { id: "NOTHING",         labelKey: "emergency.sound.nothing",        clip: null },
];

export default function DiagnosisSoundScreen() {
  const t = useT();
  const { sound, setSound } = useEmergency();
  const [playing, setPlaying] = useState<MobileSoundId | null>(null);

  // One player, re-pointed at whichever clip was tapped. Four players (one
  // per option) would each hold a decoder open for a sound most drivers
  // never play.
  const player = useVideoPlayer(null);

  /**
   * Tapping an option both selects it and plays its sound — the driver is
   * picking by ear, so hearing it IS the selection gesture. Tapping the
   * already-selected one replays it.
   */
  async function pick(option: (typeof SOUNDS)[number]) {
    setSound(option.id);
    if (!option.clip) {
      setPlaying(null);
      return;
    }
    try {
      await player.replaceAsync(option.clip);
      player.currentTime = 0;
      player.play();
      setPlaying(option.id);
    } catch {
      // Playback is a convenience, never a blocker — the answer is already
      // recorded above, so a device that cannot play audio still works.
      setPlaying(null);
    }
  }

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
          audible={s.clip !== null}
          selected={sound === s.id}
          playing={playing === s.id}
          onPress={() => pick(s)}
        />
      ))}
    </QuestionScreen>
  );
}

function SoundOption({
  label,
  audible,
  selected,
  playing,
  onPress,
}: {
  label: string;
  audible: boolean;
  selected: boolean;
  playing: boolean;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={audible ? t("emergency.sound.a11yPlay", { name: label }) : label}
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
        gap: spacing.md,
      })}
    >
      {audible ? (
        <Icon
          name={playing ? "Volume2" : "Play"}
          size={18}
          color={playing ? palette.brand : palette.textMuted}
        />
      ) : (
        <Icon name="VolumeX" size={18} color={palette.textMuted} />
      )}

      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>{label}</Text>

      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
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
