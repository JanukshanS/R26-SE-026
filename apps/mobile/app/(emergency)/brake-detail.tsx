/**
 * Q_brake_detail — only reached when intent = BRAKE.
 *
 *   SQUEALING     → pad wear indicator (still functional)
 *   GRINDING      → pads gone, metal-on-metal (URGENT)
 *   PULL_ONE_SIDE → caliper or hose issue
 *   SOFT_PEDAL    → hydraulic failure — DO NOT DRIVE
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type BrakeDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<BrakeDetailChoice>; title: string; description: string; tone?: "warning" | "danger" }[] = [
  { value: "SQUEALING",     title: "Squealing under braking",  description: "Pad wear indicator — replace pads soon" },
  { value: "GRINDING",      title: "Grinding (metal-on-metal)", description: "Pads are gone — replace immediately",        tone: "warning" },
  { value: "PULL_ONE_SIDE", title: "Pulls to one side",         description: "Caliper or hose issue" },
  { value: "SOFT_PEDAL",    title: "Pedal is soft / sinks",     description: "Hydraulic failure — DO NOT DRIVE",            tone: "danger" },
];

export default function BrakeDetailScreen() {
  const { brakeDetail, setBrakeDetail } = useEmergency();

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!brakeDetail}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What&apos;s the brake doing?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          badge={o.tone ? "⚠" : undefined}
          badgeTone={o.tone}
          selected={brakeDetail === o.value}
          onPress={() => setBrakeDetail(o.value)}
        />
      ))}
    </Screen>
  );
}
