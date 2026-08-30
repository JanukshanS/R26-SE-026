/**
 * Q_gear_detail — only reached when intent = GEAR.
 *
 *   SLIPPING     → clutch slipping (revs rise without speed)
 *   WONT_ENGAGE  → gear refuses to engage — auto transmission issue
 *   GRINDING     → synchros worn / clutch not disengaging fully
 *   CLUTCH_SOFT  → clutch hydraulic / master-cylinder
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type GearDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<GearDetailChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "SLIPPING",    titleKey: "emergency.gearDetail.slippingTitle",   descriptionKey: "emergency.gearDetail.slippingDesc" },
  { value: "WONT_ENGAGE", titleKey: "emergency.gearDetail.wontEngageTitle", descriptionKey: "emergency.gearDetail.wontEngageDesc" },
  { value: "GRINDING",    titleKey: "emergency.gearDetail.grindingTitle",   descriptionKey: "emergency.gearDetail.grindingDesc" },
  { value: "CLUTCH_SOFT", titleKey: "emergency.gearDetail.clutchSoftTitle", descriptionKey: "emergency.gearDetail.clutchSoftDesc" },
];

export default function GearDetailScreen() {
  const t = useT();
  const { gearDetail, setGearDetail } = useEmergency();

  return (
    <QuestionScreen
      route="gear-detail"
      prompt={t("emergency.gearDetail.prompt")}
      canNext={!!gearDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={gearDetail === o.value}
          onPress={() => setGearDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
