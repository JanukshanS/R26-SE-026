/**
 * Q_gear_detail — only reached when intent = GEAR.
 *
 *   SLIPPING     → clutch slipping (revs rise without speed)
 *   WONT_ENGAGE  → gear refuses to engage — auto transmission issue
 *   GRINDING     → synchros worn / clutch not disengaging fully
 *   CLUTCH_SOFT  → clutch hydraulic / master-cylinder
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type GearDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<GearDetailChoice>; title: string; description: string }[] = [
  { value: "SLIPPING",    title: "Revs rise but no speed gain",          description: "Clutch slipping" },
  { value: "WONT_ENGAGE", title: "Gear won't engage",                    description: "Transmission issue" },
  { value: "GRINDING",    title: "Grinding when shifting",                description: "Synchros worn / clutch not disengaging" },
  { value: "CLUTCH_SOFT", title: "Clutch pedal soft / sinks to the floor", description: "Clutch hydraulic failure" },
];

export default function GearDetailScreen() {
  const { gearDetail, setGearDetail } = useEmergency();

  return (
    <QuestionScreen
      route="gear-detail"
      prompt={"What's the gearbox doing?"}
      canNext={!!gearDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={gearDetail === o.value}
          onPress={() => setGearDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
