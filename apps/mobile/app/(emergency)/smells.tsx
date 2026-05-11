import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";
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
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!smells}
          onPress={() => router.push("/(emergency)/recent")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Do you notice any unusual smells?
      </Text>

      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          badge={o.tone ? "⚠" : undefined}
          badgeTone={o.tone}
          selected={smells === o.value}
          onPress={() => setSmells(o.value)}
        />
      ))}
    </Screen>
  );
}
