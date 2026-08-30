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
import { useT } from "@lib/i18n";
import { useEmergency, type ElectricalChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<ElectricalChoice>; titleKey: string; descriptionKey: string }[] = [
  { value: "ALL_DEAD_NO_LIGHTS", titleKey: "emergency.electrical.allDeadTitle",   descriptionKey: "emergency.electrical.allDeadDesc" },
  { value: "DIM_LIGHTS",         titleKey: "emergency.electrical.dimTitle",       descriptionKey: "emergency.electrical.dimDesc" },
  { value: "SOME_LIGHTS_ON",     titleKey: "emergency.electrical.someNormalTitle", descriptionKey: "emergency.electrical.someNormalDesc" },
];

export default function ElectricalScreen() {
  const t = useT();
  const { electrical, setElectrical } = useEmergency();

  return (
    <QuestionScreen
      route="electrical"
      prompt={t("emergency.electrical.prompt")}
      canNext={!!electrical}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={t(o.titleKey)}
          description={t(o.descriptionKey)}
          selected={electrical === o.value}
          onPress={() => setElectrical(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
