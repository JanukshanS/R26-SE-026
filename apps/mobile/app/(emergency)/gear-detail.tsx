/**
 * Q_gear_detail — only reached when intent = GEAR.
 *
 *   SLIPPING     → clutch slipping (revs rise without speed)
 *   WONT_ENGAGE  → gear refuses to engage — auto transmission issue
 *   GRINDING     → synchros worn / clutch not disengaging fully
 *   CLUTCH_SOFT  → clutch hydraulic / master-cylinder
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type GearDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<GearDetailChoice>; title: string; description: string }[] = [
  { value: "SLIPPING",    title: "Revs rise but no speed gain",          description: "Clutch slipping" },
  { value: "WONT_ENGAGE", title: "Gear won't engage",                    description: "Transmission issue" },
  { value: "GRINDING",    title: "Grinding when shifting",                description: "Synchros worn / clutch not disengaging" },
  { value: "CLUTCH_SOFT", title: "Clutch pedal soft / sinks to the floor", description: "Clutch hydraulic failure" },
];

export default function GearDetailScreen() {
  const { gearDetail, setGearDetail } = useEmergency();

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!gearDetail}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What&apos;s the gearbox doing?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={gearDetail === o.value}
          onPress={() => setGearDetail(o.value)}
        />
      ))}
    </Screen>
  );
}
