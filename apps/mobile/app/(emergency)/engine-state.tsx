import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type EngineStateChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<EngineStateChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "STARTS_NORMAL",    titleKey: "emergency.engineState.startsNormalTitle",    descriptionKey: "emergency.engineState.startsNormalDesc" },
  { value: "STARTS_BUT_ISSUE", titleKey: "emergency.engineState.startsRoughTitle",     descriptionKey: "emergency.engineState.startsRoughDesc" },
  { value: "CRANKS_NO_START",  titleKey: "emergency.engineState.cranksNoStartTitle",   descriptionKey: "emergency.engineState.cranksNoStartDesc" },
  { value: "NO_CRANK",         titleKey: "emergency.engineState.noCrankTitle",         descriptionKey: "emergency.engineState.noCrankDesc" },
];

export default function EngineStateScreen() {
  const t = useT();
  const { engineState, setEngineState } = useEmergency();

  // Where this answer leads (running-issue vs sound vs electrical) is decided
  // by the branch predicates in lib/emergencyFlow.ts, not here.

  return (
    <QuestionScreen
      route="engine-state"
      prompt={t("emergency.engineState.prompt")}
      canNext={!!engineState}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={engineState === o.value}
          onPress={() => setEngineState(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
