/**
 * Q7 overheat-detail — only reached when running-issue = OVERHEATING.
 * Distinguishes radiator-fan / coolant / thermostat / hill-climb cooling
 * failure modes that the SL data shows for Colombo traffic and Kandy hill
 * road conditions.
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type OverheatChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<OverheatChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "TRAFFIC_ONLY", titleKey: "emergency.overheatDetail.trafficTitle",   descriptionKey: "emergency.overheatDetail.trafficDesc" },
  { value: "ALWAYS",       titleKey: "emergency.overheatDetail.alwaysTitle",    descriptionKey: "emergency.overheatDetail.alwaysDesc" },
  { value: "HILL_CLIMB",   titleKey: "emergency.overheatDetail.hillClimbTitle", descriptionKey: "emergency.overheatDetail.hillClimbDesc" },
  { value: "WITH_AC",      titleKey: "emergency.overheatDetail.withAcTitle",    descriptionKey: "emergency.overheatDetail.withAcDesc" },
];

export default function OverheatDetailScreen() {
  const t = useT();
  const { overheatDetail, setOverheatDetail } = useEmergency();

  return (
    <QuestionScreen
      route="overheat-detail"
      prompt={t("emergency.overheatDetail.prompt")}
      canNext={!!overheatDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={overheatDetail === o.value}
          onPress={() => setOverheatDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
