/**
 * Q_brake_detail — only reached when intent = BRAKE.
 *
 *   SQUEALING     → pad wear indicator (still functional)
 *   GRINDING      → pads gone, metal-on-metal (URGENT)
 *   PULL_ONE_SIDE → caliper or hose issue
 *   SOFT_PEDAL    → hydraulic failure — DO NOT DRIVE
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type BrakeDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<BrakeDetailChoice>; titleKey: string; descriptionKey: string; tone?: "warning" | "danger" }[] = [
  { value: "SQUEALING",     titleKey: "emergency.brakeDetail.squealingTitle", descriptionKey: "emergency.brakeDetail.squealingDesc" },
  { value: "GRINDING",      titleKey: "emergency.brakeDetail.grindingTitle",  descriptionKey: "emergency.brakeDetail.grindingDesc",  tone: "warning" },
  { value: "PULL_ONE_SIDE", titleKey: "emergency.brakeDetail.pullTitle",      descriptionKey: "emergency.brakeDetail.pullDesc" },
  { value: "SOFT_PEDAL",    titleKey: "emergency.brakeDetail.softPedalTitle", descriptionKey: "emergency.brakeDetail.softPedalDesc", tone: "danger" },
];

export default function BrakeDetailScreen() {
  const t = useT();
  const { brakeDetail, setBrakeDetail } = useEmergency();

  return (
    <QuestionScreen
      route="brake-detail"
      prompt={t("emergency.brakeDetail.prompt")}
      canNext={!!brakeDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          accent={o.tone}
          badgeTone={o.tone}
          selected={brakeDetail === o.value}
          onPress={() => setBrakeDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
