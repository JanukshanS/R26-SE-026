/**
 * Q3b electrical — only reached when engine-state = NO_CRANK
 * ("Completely dead" — no response when turning the key).
 *
 *   ALL_DEAD_NO_LIGHTS → battery flat / terminal completely disconnected
 *   DIM_LIGHTS         → battery weak but some power → jump-start candidate
 *   SOME_LIGHTS_ON     → starter motor / ignition switch (battery is fine)
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type ElectricalChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<ElectricalChoice>; title: string; description: string }[] = [
  { value: "ALL_DEAD_NO_LIGHTS", title: "No lights at all",         description: "Dashboard completely dark — battery flat or terminal off" },
  { value: "DIM_LIGHTS",         title: "Lights dim or flickering", description: "Battery has some charge but not enough to crank" },
  { value: "SOME_LIGHTS_ON",     title: "Some lights normal",       description: "Power is there — starter or ignition fault" },
];

export default function ElectricalScreen() {
  const { electrical, setElectrical } = useEmergency();

  return (
    <QuestionScreen
      route="electrical"
      prompt={"What are the dashboard lights doing?"}
      canNext={!!electrical}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={electrical === o.value}
          onPress={() => setElectrical(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
