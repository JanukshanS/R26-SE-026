/**
 * Q2b running-issue — only reached when engine-state is STARTS_NORMAL or
 * STARTS_BUT_ISSUE. The answer routes into one of three deep-dive screens
 * (overheat / noise / smoke) or skips straight to lights for NO_POWER/STALLING.
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type RunningIssueChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<RunningIssueChoice>; title: string; description: string }[] = [
  { value: "OVERHEATING", title: "Overheating",                description: "Temperature gauge climbing into the red" },
  { value: "NOISE",       title: "Strange noise",              description: "Squeal, knock, grind, whine, clunk" },
  { value: "NO_POWER",    title: "No power / won't accelerate",description: "Engine runs but loses power under load" },
  { value: "SMOKE",       title: "Smoke from engine",          description: "Visible smoke from the engine bay or exhaust" },
  { value: "STALLING",    title: "Engine stalls / dies",       description: "Cuts out while idling or driving" },
];

export default function RunningIssueScreen() {
  const { runningIssue, setRunningIssue } = useEmergency();

  function handleNext() {
    if (!runningIssue) return;
    if (runningIssue === "OVERHEATING") router.push("/(emergency)/overheat-detail");
    else if (runningIssue === "NOISE")  router.push("/(emergency)/noise-detail");
    else if (runningIssue === "SMOKE")  router.push("/(emergency)/smoke-color");
    // NO_POWER / STALLING — no further detail screen; head to dashboard lights.
    else router.push("/(emergency)/diagnosis-lights");
  }

  return (
    <Screen footer={<Button title="Next Step" disabled={!runningIssue} onPress={handleNext} />}>
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What&apos;s the main problem while the engine runs?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={runningIssue === o.value}
          onPress={() => setRunningIssue(o.value)}
        />
      ))}
    </Screen>
  );
}
