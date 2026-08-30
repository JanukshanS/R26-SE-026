import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  FadeIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Icon } from "@components/ui/icon";
import { haptics } from "@lib/haptics";
import { useT } from "@lib/i18n";
import { palette, radii, spacing, typography } from "@theme/index";

const STAGE_KEYS = [
  "emergency.dispatchProgress.stageLocating",
  "emergency.dispatchProgress.stageScoring",
  "emergency.dispatchProgress.stageRanking",
] as const;
const STAGE_INTERVAL_MS = 1400;

type Props = {
  done: boolean;
  doneLabel?: string;
};

/**
 * Staged loading indicator for the dispatch pipeline. While loading it pulses
 * an icon and cycles through the pipeline stages; once `done` it swaps to a
 * success check and fires a success haptic. Replaces the bare ActivityIndicator
 * on the dispatch loading screens.
 */
export function DispatchProgress({ done, doneLabel }: Props) {
  const t = useT();
  const [stage, setStage] = useState(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 700 }),
        withTiming(1, { duration: 700 }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setStage((s) => (s + 1) % STAGE_KEYS.length);
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (done) haptics.success();
  }, [done]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={{ alignItems: "center", gap: spacing.lg }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? (
          <Animated.View entering={ZoomIn.springify()}>
            <Icon name="CircleCheck" size={36} color={palette.success} />
          </Animated.View>
        ) : (
          <Animated.View style={pulseStyle}>
            <Icon name="Wrench" size={36} color={palette.brand} />
          </Animated.View>
        )}
      </View>

      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>
        {done ? doneLabel ?? t("emergency.dispatchProgress.done") : t("emergency.dispatchProgress.searching")}
      </Text>

      {!done && (
        <Animated.Text
          key={stage}
          entering={FadeIn.duration(300)}
          style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
        >
          {t(STAGE_KEYS[stage])}
        </Animated.Text>
      )}
    </View>
  );
}
