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
import { useEmergency, type NoiseChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<NoiseChoice>; title: string; description: string }[] = [
  { value: "SQUEAL", title: "High-pitched squealing", description: "Belt slipping or worn" },
  { value: "KNOCK",  title: "Knocking (rhythmic)",    description: "Engine timing or fuel-quality issue" },
  { value: "GRIND",  title: "Grinding",                description: "Brakes, starter, or bearing" },
  { value: "WHINE",  title: "High-pitched whining",    description: "Alternator or power-steering" },
  { value: "CLUNK",  title: "Clunking (intermittent)", description: "Drivetrain or suspension" },
];

export default function NoiseDetailScreen() {
  const { noiseDetail, setNoiseDetail } = useEmergency();

  return (
    <QuestionScreen
      route="noise-detail"
      prompt={"What kind of noise are you hearing?"}
      canNext={!!noiseDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={noiseDetail === o.value}
          onPress={() => setNoiseDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
