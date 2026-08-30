import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useT } from "@lib/i18n";
import { useEmergency, type SmellChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<SmellChoice>; titleKey: string; descriptionKey: string; tone?: "danger" | "warning" }[] = [
  { value: "BURNING_ELECTRICAL", titleKey: "emergency.smells.electricalTitle", descriptionKey: "emergency.smells.electricalDesc", tone: "danger" },
  { value: "BURNING_OIL",        titleKey: "emergency.smells.oilTitle",        descriptionKey: "emergency.smells.oilDesc" },
  { value: "FUEL_SMELL",         titleKey: "emergency.smells.fuelTitle",       descriptionKey: "emergency.smells.fuelDesc",       tone: "danger" },
  { value: "ROTTEN_EGGS",        titleKey: "emergency.smells.sulfurTitle",     descriptionKey: "emergency.smells.sulfurDesc" },
  { value: "SWEET",              titleKey: "emergency.smells.sweetTitle",      descriptionKey: "emergency.smells.sweetDesc" },
  { value: "NO_SMELL",           titleKey: "emergency.smells.noneTitle",       descriptionKey: "emergency.smells.noneDesc" },
];

export default function SmellsScreen() {
  const t = useT();
  const { smells, setSmells } = useEmergency();

  return (
    <QuestionScreen
      route="smells"
      prompt={t("emergency.smells.prompt")}
      canNext={!!smells}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          accent={o.tone}
          badgeTone={o.tone}
          selected={smells === o.value}
          onPress={() => setSmells(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
