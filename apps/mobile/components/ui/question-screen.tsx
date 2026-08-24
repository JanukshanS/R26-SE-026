/**
 * Shell for every screen in the adaptive questionnaire.
 *
 * Replaces three things each question screen used to hand-roll:
 *   - a headline (all 13 said "Diagnosis Process", so the driver had no idea
 *     whether they were on question 2 or question 9)
 *   - a hardcoded router.push to the next screen
 *   - nothing at all for "I don't want to answer nine questions, send someone"
 *
 * The step counter and the Next destination both come from lib/emergencyFlow,
 * so reordering the questionnaire is a one-array edit.
 */
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { nextRoute, stepPath, stepPosition, stepTitle, type StepRoute } from "@lib/emergencyFlow";

type Props = {
  /** Which step this is. Drives the title, the counter and where Next goes. */
  route: StepRoute;
  /** The actual question, e.g. "Does the engine start?" */
  prompt?: string;
  /** Extra line under the prompt, e.g. "Tap all that apply." */
  hint?: string;
  /** Next is disabled until this is true. */
  canNext?: boolean;
  /** Overrides the default "advance to the next active step". */
  onNext?: () => void;
  /** Label for the primary button. Defaults to "Next". */
  nextLabel?: string;
  children: React.ReactNode;
};

/**
 * "Advance to whatever step comes next for these answers." Exposed separately
 * so screens with their own submit logic (diagnosis-lights files the incident,
 * context posts the triage) can run it without hardcoding a destination.
 */
export function useNextStep(route: StepRoute): () => void {
  const { q1Intent, engineState, runningIssue } = useEmergency();
  return useCallback(() => {
    const next = nextRoute({ q1Intent, engineState, runningIssue }, route);
    if (next) router.push(stepPath(next));
  }, [q1Intent, engineState, runningIssue, route]);
}

export function QuestionScreen({
  route,
  prompt,
  hint,
  canNext = true,
  onNext,
  nextLabel = "Next",
  children,
}: Props) {
  const { q1Intent, engineState, runningIssue } = useEmergency();
  const { index, total } = stepPosition({ q1Intent, engineState, runningIssue }, route);
  const goNext = useNextStep(route);
  const advance = onNext ?? goNext;

  return (
    <Screen
      footer={
        <>
          <Button title={nextLabel} disabled={!canNext} onPress={advance} />
          <SkipToHelp />
        </>
      }
    >
      {/* Pill goes in the title slot, not `right` - HeaderBar drops its
          one-tap "home" escape when `right` is supplied, and abandoning the
          flow entirely should stay one tap away. */}
      <HeaderBar title={`Step ${index} of ${total}`} />

      <View style={{ gap: spacing.sm }}>
        <StepProgress index={index} total={total} />
        <Text style={{ ...typography.h1, color: palette.text }}>{stepTitle(route)}</Text>
        {prompt ? (
          <Text style={{ ...typography.body, color: palette.textMuted }}>{prompt}</Text>
        ) : null}
        {hint ? (
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{hint}</Text>
        ) : null}
      </View>

      {children}
    </Screen>
  );
}

/**
 * The escape hatch, on every question. Deliberately a full-width button in the
 * footer rather than a quiet text link — the driver who needs it most is the
 * one least able to go hunting for it.
 *
 * Routes to quick-dispatch with no intent param, which makes it file the
 * answers collected so far instead of a fast-path payload.
 */
function SkipToHelp() {
  return (
    <Pressable
      onPress={() => router.push("/(emergency)/quick-dispatch")}
      accessibilityRole="button"
      accessibilityLabel="Skip the questions and send help now"
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        alignItems: "center",
        paddingVertical: spacing.md,
      })}
    >
      <Text style={{ ...typography.bodyStrong, color: palette.supportCoral }}>
        Skip — send help now
      </Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>
        We&apos;ll use what you&apos;ve answered so far
      </Text>
    </Pressable>
  );
}

function StepProgress({ index, total }: { index: number; total: number }) {
  const pct = total > 0 ? Math.min(1, index / total) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: index }}
      style={{
        height: 4,
        borderRadius: radii.pill,
        backgroundColor: palette.border,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: palette.brand }} />
    </View>
  );
}
