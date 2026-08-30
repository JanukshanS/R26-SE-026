/**
 * Q2b running-issue — only reached when engine-state is STARTS_NORMAL or
 * STARTS_BUT_ISSUE. The answer routes into one of three deep-dive screens
 * (overheat / noise / smoke) or skips straight to lights for NO_POWER/STALLING.
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type RunningIssueChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<RunningIssueChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "OVERHEATING", titleKey: "emergency.runningIssue.overheatingTitle", descriptionKey: "emergency.runningIssue.overheatingDesc" },
  { value: "NOISE",       titleKey: "emergency.runningIssue.noiseTitle",       descriptionKey: "emergency.runningIssue.noiseDesc" },
  { value: "NO_POWER",    titleKey: "emergency.runningIssue.noPowerTitle",     descriptionKey: "emergency.runningIssue.noPowerDesc" },
  { value: "SMOKE",       titleKey: "emergency.runningIssue.smokeTitle",       descriptionKey: "emergency.runningIssue.smokeDesc" },
  { value: "STALLING",    titleKey: "emergency.runningIssue.stallingTitle",    descriptionKey: "emergency.runningIssue.stallingDesc" },
];

export default function RunningIssueScreen() {
  const t = useT();
  const { runningIssue, setRunningIssue } = useEmergency();


  return (
    <QuestionScreen
      route="running-issue"
      prompt={t("emergency.runningIssue.prompt")}
      canNext={!!runningIssue}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={runningIssue === o.value}
          onPress={() => setRunningIssue(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
