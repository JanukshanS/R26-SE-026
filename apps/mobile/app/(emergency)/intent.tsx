/**
 * Intent picker — runs right after safety-check (when there's no major
 * crash). Selects the top-level cohort the adaptive form drills into:
 *
 *   ENGINE → engine-state (Q2) → sound / electrical / running-issue subtree
 *   BRAKE  → brake-detail   (Q_brake_detail) → tail
 *   GEAR   → gear-detail    (Q_gear_detail)  → tail
 *
 * This is the entry point that activates the brake / gear branches the
 * decision tree was trained on.
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type IntentCohort } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<IntentCohort>; title: string; description: string }[] = [
  { value: "ENGINE", title: "Engine / Starting / Strange behavior", description: "Won't start, runs rough, overheat, smoke, weird noise" },
  { value: "BRAKE",  title: "Brake problem",                        description: "Squealing, grinding, soft pedal, pulls to one side" },
  { value: "GEAR",   title: "Gear / Transmission / Clutch",          description: "Slipping, won't engage, grinding gears, soft clutch" },
];

export default function IntentScreen() {
  const { intent, setIntent } = useEmergency();

  function handleNext() {
    if (!intent) return;
    if (intent === "ENGINE") router.push("/(emergency)/engine-state");
    else if (intent === "BRAKE") router.push("/(emergency)/brake-detail");
    else if (intent === "GEAR")  router.push("/(emergency)/gear-detail");
  }

  return (
    <Screen footer={<Button title="Next Step" disabled={!intent} onPress={handleNext} />}>
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What kind of problem are you having?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={intent === o.value}
          onPress={() => setIntent(o.value)}
        />
      ))}
    </Screen>
  );
}
