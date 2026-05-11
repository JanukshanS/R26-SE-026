/**
 * Q4 noise-detail — only reached when running-issue = NOISE.
 * Each noise type maps strongly to a specific fault family:
 *   - SQUEAL → belt slipping / wearing
 *   - KNOCK  → engine timing / fuel quality issue
 *   - GRIND  → brakes (pad gone) or starter / bearing
 *   - WHINE  → alternator bearing / power steering pump
 *   - CLUNK  → drivetrain (CV joints, mounts, suspension)
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
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
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!noiseDetail}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What kind of noise are you hearing?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={noiseDetail === o.value}
          onPress={() => setNoiseDetail(o.value)}
        />
      ))}
    </Screen>
  );
}
