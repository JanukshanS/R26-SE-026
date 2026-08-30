/**
 * Q4 noise-detail — only reached when running-issue = NOISE.
 * Each noise type maps strongly to a specific fault family:
 *   - SQUEAL → belt slipping / wearing
 *   - KNOCK  → engine timing / fuel quality issue
 *   - GRIND  → brakes (pad gone) or starter / bearing
 *   - WHINE  → alternator bearing / power steering pump
 *   - CLUNK  → drivetrain (CV joints, mounts, suspension)
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type NoiseChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<NoiseChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "SQUEAL", titleKey: "emergency.noiseDetail.squealTitle", descriptionKey: "emergency.noiseDetail.squealDesc" },
  { value: "KNOCK",  titleKey: "emergency.noiseDetail.knockTitle",  descriptionKey: "emergency.noiseDetail.knockDesc" },
  { value: "GRIND",  titleKey: "emergency.noiseDetail.grindTitle",  descriptionKey: "emergency.noiseDetail.grindDesc" },
  { value: "WHINE",  titleKey: "emergency.noiseDetail.whineTitle",  descriptionKey: "emergency.noiseDetail.whineDesc" },
  { value: "CLUNK",  titleKey: "emergency.noiseDetail.clunkTitle",  descriptionKey: "emergency.noiseDetail.clunkDesc" },
];

export default function NoiseDetailScreen() {
  const t = useT();
  const { noiseDetail, setNoiseDetail } = useEmergency();

  return (
    <QuestionScreen
      route="noise-detail"
      prompt={t("emergency.noiseDetail.prompt")}
      canNext={!!noiseDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={noiseDetail === o.value}
          onPress={() => setNoiseDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
