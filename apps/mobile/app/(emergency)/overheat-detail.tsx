/**
 * Q7 overheat-detail — only reached when running-issue = OVERHEATING.
 * Distinguishes radiator-fan / coolant / thermostat / hill-climb cooling
 * failure modes that the SL data shows for Colombo traffic and Kandy hill
 * road conditions.
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type OverheatChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<OverheatChoice>; title: string; description: string }[] = [
  { value: "TRAFFIC_ONLY", title: "Only in heavy traffic / when stopped", description: "Cools down when moving — typical radiator-fan failure" },
  { value: "ALWAYS",       title: "Even when driving normally",            description: "Constant overheat — coolant loss or head gasket" },
  { value: "HILL_CLIMB",   title: "Only when climbing hills",               description: "Engine load too high for the cooling system" },
  { value: "WITH_AC",      title: "Only when AC is running",                description: "Extra heat load from the AC condenser" },
];

export default function OverheatDetailScreen() {
  const { overheatDetail, setOverheatDetail } = useEmergency();

  return (
    <QuestionScreen
      route="overheat-detail"
      prompt={"When does the overheating happen?"}
      canNext={!!overheatDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={overheatDetail === o.value}
          onPress={() => setOverheatDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
