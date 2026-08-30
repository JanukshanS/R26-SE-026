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
 *
 * Which screen is *last* varies by branch (engine vs brake vs gear, and which
 * running-issue/engine-state answer was picked), so there's no single "final"
 * screen to hang the triage submission off of. Instead, whichever screen
 * `nextRoute` has nothing after becomes the final step for that driver's
 * path, and this file submits from there — every question screen stays a
 * plain "pick an answer, tap Next" component with no submit logic of its own.
 */
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { nextRoute, stepPath, stepPosition, stepTitle, type StepRoute } from "@lib/emergencyFlow";
import { submitTriage, DispatchApiError } from "@lib/dispatchApi";
import { readObdFromElm327 } from "@lib/elm327";

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
  /** Label for the primary button. Defaults to "Next", or "Get Diagnosis" on
   *  the final step of a branch (overridden automatically while submitting). */
  nextLabel?: string;
  children: React.ReactNode;
};

/**
 * "Advance to whatever step comes next for these answers, or — if this is
 * the last active step on this branch — read OBD telemetry, submit the
 * triage, and move to the result screen."
 *
 * Exposed separately so a screen with its own submit logic (diagnosis-lights
 * files the incident before anything else can run) can still reach
 * `isFinalStep`/`submitting` without adopting this default advance behavior.
 */
export function useNextStep(route: StepRoute): {
  advance: () => void;
  isFinalStep: boolean;
  submitting: boolean;
} {
  const {
    q1Intent, engineState, runningIssue,
    incidentId, buildTriageResponses, setTriageResult, setError,
  } = useEmergency();
  const [submitting, setSubmitting] = useState(false);
  // `submitting` only disables the button on the next render, which leaves a
  // double-tap window open that would submit triage twice.
  const inFlightRef = useRef(false);
  const next = nextRoute({ q1Intent, engineState, runningIssue }, route);

  const submitFinal = useCallback(async () => {
    if (!incidentId) {
      Alert.alert(
        "We lost your request",
        "Your answers were never filed with dispatch, so we can't run the diagnosis. Start the emergency flow again from the home screen.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Go home", onPress: () => router.replace("/(driver)/home") },
        ]
      );
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Read OBD directly from the (simulated) ELM327 dongle. Passing
      // incidentId so the stub re-randomizes the vehicle's "current
      // condition" per emergency (otherwise every dispatch would return the
      // same diagnosis for the entire session).
      const obd = await readObdFromElm327(incidentId);
      const responses = buildTriageResponses();
      const triage = await submitTriage({
        incidentId,
        responses,
        obdData: obd ? { ...obd } : undefined,
      });
      setTriageResult(triage.result);
      router.push("/(emergency)/diagnosis-result");
    } catch (err) {
      const reachable = err instanceof DispatchApiError;
      const msg = reachable
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error).message;
      setError(msg);
      Alert.alert(
        "Couldn't run the diagnosis",
        reachable
          ? `${msg}\n\nYour answers are saved. Tap Get Diagnosis to try again.`
          : `Couldn't reach the diagnosis service. Check your connection — your answers are saved, so tap Get Diagnosis to try again.${
              __DEV__ ? `\n\n[dev] ${msg}` : ""
            }`
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [incidentId, buildTriageResponses, setTriageResult, setError]);

  const advance = useCallback(() => {
    if (next) {
      router.push(stepPath(next));
      return;
    }
    submitFinal();
  }, [next, submitFinal]);

  return { advance, isFinalStep: next === null, submitting };
}

export function QuestionScreen({
  route,
  prompt,
  hint,
  canNext = true,
  onNext,
  nextLabel,
  children,
}: Props) {
  const { q1Intent, engineState, runningIssue } = useEmergency();
  const { index, total } = stepPosition({ q1Intent, engineState, runningIssue }, route);
  const { advance, isFinalStep, submitting } = useNextStep(route);

  const label =
    nextLabel ?? (isFinalStep ? (submitting ? "Diagnosing…" : "Get Diagnosis") : "Next");

  return (
    <Screen
      footer={
        <>
          <Button
            title={label}
            disabled={!canNext || submitting}
            onPress={onNext ?? advance}
          />
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
