/**
 * Q_brake_detail — only reached when intent = BRAKE.
 *
 *   SQUEALING     → pad wear indicator (still functional)
 *   GRINDING      → pads gone, metal-on-metal (URGENT)
 *   PULL_ONE_SIDE → caliper or hose issue
 *   SOFT_PEDAL    → hydraulic failure — DO NOT DRIVE
 */
import { OptionCard } from "@components/ui/option-card";
import { QuestionScreen } from "@components/ui/question-screen";
import { useEmergency, type BrakeDetailChoice } from "@lib/emergencyContext";

const OPTIONS: { value: NonNullable<BrakeDetailChoice>; title: string; description: string; tone?: "warning" | "danger" }[] = [
  { value: "SQUEALING",     title: "Squealing under braking",  description: "Pad wear indicator — replace pads soon" },
  { value: "GRINDING",      title: "Grinding (metal-on-metal)", description: "Pads are gone — replace immediately",        tone: "warning" },
  { value: "PULL_ONE_SIDE", title: "Pulls to one side",         description: "Caliper or hose issue" },
  { value: "SOFT_PEDAL",    title: "Pedal is soft / sinks",     description: "Hydraulic failure — DO NOT DRIVE",            tone: "danger" },
];

export default function BrakeDetailScreen() {
  const { brakeDetail, setBrakeDetail } = useEmergency();

  return (
    <QuestionScreen
      route="brake-detail"
      prompt={"What's the brake doing?"}
      canNext={!!brakeDetail}
    >
      {OPTIONS.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          accent={o.tone}
          badgeTone={o.tone}
          selected={brakeDetail === o.value}
          onPress={() => setBrakeDetail(o.value)}
        />
      ))}
    </QuestionScreen>
  );
}
