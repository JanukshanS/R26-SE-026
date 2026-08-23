/**
 * Q2b running-issue — only reached when engine-state is STARTS_NORMAL or
 * STARTS_BUT_ISSUE. The answer routes into one of three deep-dive screens
 * (overheat / noise / smoke) or skips straight to lights for NO_POWER/STALLING.
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
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


  return (
    <QuestionScreen
      route="running-issue"
      prompt={"What's the main problem while the engine runs?"}
      canNext={!!runningIssue}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={runningIssue === o.value}
          onPress={() => setRunningIssue(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
