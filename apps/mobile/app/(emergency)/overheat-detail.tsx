/**
 * Q7 overheat-detail — only reached when running-issue = OVERHEATING.
 * Distinguishes radiator-fan / coolant / thermostat / hill-climb cooling
 * failure modes that the SL data shows for Colombo traffic and Kandy hill
 * road conditions.
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
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
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!overheatDetail}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        When does the overheating happen?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={overheatDetail === o.value}
          onPress={() => setOverheatDetail(o.value)}
        />
      ))}
    </Screen>
  );
}
