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
import { useT } from "@lib/i18n";
import { useEmergency, type SmokeColorChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<SmokeColorChoice>; titleKey: string; descriptionKey: string; tone?: "warning" | "danger" }[] = [
  { value: "WHITE",              titleKey: "emergency.smokeColor.whiteTitle",      descriptionKey: "emergency.smokeColor.whiteDesc",      tone: "warning" },
  { value: "BLUE_GREY",          titleKey: "emergency.smokeColor.blueGreyTitle",   descriptionKey: "emergency.smokeColor.blueGreyDesc",   tone: "warning" },
  { value: "BLACK",              titleKey: "emergency.smokeColor.blackTitle",      descriptionKey: "emergency.smokeColor.blackDesc" },
  { value: "ELECTRICAL_BURNING", titleKey: "emergency.smokeColor.electricalTitle", descriptionKey: "emergency.smokeColor.electricalDesc", tone: "danger" },
];

export default function SmokeColorScreen() {
  const t = useT();
  const { smokeColor, setSmokeColor } = useEmergency();

  return (
    <QuestionScreen
      route="smoke-color"
      prompt={t("emergency.smokeColor.prompt")}
      canNext={!!smokeColor}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          accent={o.tone}
          badgeTone={o.tone}
          selected={smokeColor === o.value}
          onPress={() => setSmokeColor(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
