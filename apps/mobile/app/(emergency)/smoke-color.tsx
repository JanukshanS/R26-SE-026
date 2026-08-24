/**
 * Q8 smoke-color — only reached when running-issue = SMOKE.
 * Smoke colour is the most diagnostic single signal for engine faults:
 *   - WHITE       → coolant / head gasket (water vapour)
 *   - BLUE_GREY   → burning oil (worn rings / valve seals)
 *   - BLACK       → too much fuel (injector, air filter)
 *   - ELECTRICAL  → wiring fire — STOP ENGINE
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
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
    <QuestionScreen
      route="smoke-color"
      prompt={"What colour is the smoke?"}
      canNext={!!smokeColor}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          accent={o.tone}
          badgeTone={o.tone}
          selected={smokeColor === o.value}
          onPress={() => setSmokeColor(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
