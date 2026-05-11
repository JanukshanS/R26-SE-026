/**
 * Q8 smoke-color — only reached when running-issue = SMOKE.
 * Smoke colour is the most diagnostic single signal for engine faults:
 *   - WHITE       → coolant / head gasket (water vapour)
 *   - BLUE_GREY   → burning oil (worn rings / valve seals)
 *   - BLACK       → too much fuel (injector, air filter)
 *   - ELECTRICAL  → wiring fire — STOP ENGINE
 */
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
import { useEmergency, type SmokeColorChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<SmokeColorChoice>; title: string; description: string; tone?: "warning" | "danger" }[] = [
  { value: "WHITE",              title: "White smoke / steam",          description: "Coolant — possible head gasket",          tone: "warning" },
  { value: "BLUE_GREY",          title: "Blue / grey smoke",             description: "Burning oil — worn rings or valve seals", tone: "warning" },
  { value: "BLACK",              title: "Black smoke",                   description: "Too much fuel — injector / filter issue" },
  { value: "ELECTRICAL_BURNING", title: "Smoke from dashboard / bonnet", description: "STOP ENGINE — electrical fire risk",      tone: "danger" },
];

export default function SmokeColorScreen() {
  const { smokeColor, setSmokeColor } = useEmergency();

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!smokeColor}
          onPress={() => router.push("/(emergency)/diagnosis-lights")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        What colour is the smoke?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          badge={o.tone ? "⚠" : undefined}
          badgeTone={o.tone}
          selected={smokeColor === o.value}
          onPress={() => setSmokeColor(o.value)}
        />
      ))}
    </Screen>
  );
}
