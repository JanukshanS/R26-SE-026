import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type SmellChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<SmellChoice>; title: string; description: string; tone?: "danger" | "warning" }[] = [
  { value: "BURNING_ELECTRICAL", title: "Burning plastic / electrical", description: "Wiring or alternator overheating", tone: "danger" },
  { value: "BURNING_OIL",        title: "Burning oil / rubber",         description: "Oil leak onto exhaust or belt slipping" },
  { value: "FUEL_SMELL",         title: "Strong petrol / diesel smell", description: "Possible fuel leak — do not start", tone: "danger" },
  { value: "ROTTEN_EGGS",        title: "Rotten eggs / sulfur",         description: "Catalytic converter or battery overcharge" },
  { value: "SWEET",              title: "Sweet smell",                  description: "Coolant leak (antifreeze)" },
  { value: "NO_SMELL",           title: "No unusual smell",             description: "Nothing different" },
];

export default function SmellsScreen() {
  const { smells, setSmells } = useEmergency();

  return (
    <QuestionScreen
      route="smells"
      prompt={"Do you notice any unusual smells?"}
      canNext={!!smells}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          accent={o.tone}
          badgeTone={o.tone}
          selected={smells === o.value}
          onPress={() => setSmells(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
