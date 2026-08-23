import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type EngineStateChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<EngineStateChoice>; title: string; description: string }[] = [
  { value: "STARTS_NORMAL",    title: "Starts and runs normally", description: "Engine fires up and idles" },
  { value: "STARTS_BUT_ISSUE", title: "Starts but runs rough",     description: "Stalls, shakes, or misfires" },
  { value: "CRANKS_NO_START",  title: "Cranks but won't fire",     description: "Engine turns but doesn't catch" },
  { value: "NO_CRANK",         title: "Completely dead",           description: "No response at all when key turned" },
];

export default function EngineStateScreen() {
  const { engineState, setEngineState } = useEmergency();

  // Where this answer leads (running-issue vs sound vs electrical) is decided
  // by the branch predicates in lib/emergencyFlow.ts, not here.

  return (
    <QuestionScreen
      route="engine-state"
      prompt={"What's the engine doing right now?"}
      canNext={!!engineState}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={engineState === o.value}
          onPress={() => setEngineState(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
