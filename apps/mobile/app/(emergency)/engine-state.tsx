import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type EngineStateChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<EngineStateChoice>; title: string; description: string }[] = [
  { value: "STARTS_NORMAL",    title: "Starts and runs normally", description: "Engine fires up and idles" },
  { value: "STARTS_BUT_ISSUE", title: "Starts but runs rough",     description: "Stalls, shakes, or misfires" },
  { value: "CRANKS_NO_START",  title: "Cranks but won't fire",     description: "Engine turns but doesn't catch" },
  { value: "NO_CRANK",         title: "Completely dead",           description: "No response at all when key turned" },
];

export default function EngineStateScreen() {
  const { engineState, setEngineState } = useEmergency();

  /**
   * Adaptive routing based on what the engine is doing:
   *   - STARTS_NORMAL / STARTS_BUT_ISSUE → Q2b running-issue (which itself
   *     branches into overheat / noise / smoke deep-dives)
   *   - CRANKS_NO_START → Q3 sound (best signal for fuel / starter / ignition)
   *   - NO_CRANK        → Q3b electrical (battery / starter / wiring)
   */
  function handleNext() {
    if (!engineState) return;
    if (engineState === "CRANKS_NO_START") {
      router.push("/(emergency)/diagnosis-sound");
    } else if (engineState === "NO_CRANK") {
      router.push("/(emergency)/electrical");
    } else {
      // STARTS_NORMAL or STARTS_BUT_ISSUE
      router.push("/(emergency)/running-issue");
    }
  }

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!engineState}
          onPress={handleNext}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What&apos;s the engine doing right now?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={engineState === o.value}
          onPress={() => setEngineState(o.value)}
        />
      ))}
    </Screen>
  );
}
