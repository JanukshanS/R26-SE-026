/**
 * A live trouble code, rendered for a driver rather than a mechanic.
 *
 * Two variants of one component so the health screen and the component screen
 * cannot drift apart in what they claim about the same fault:
 *
 *   compact  - the health dashboard. Enough to decide whether to act.
 *   full     - the component screen. Causes, consequence and conditions.
 *
 * WHAT IS DELIBERATELY NOT HERE: any suggestion the driver clear the code. It
 * would erase the freeze frame a mechanic needs and reset the readiness
 * monitors an emissions test depends on, so the app never offers it.
 */
import { Pressable, Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { VehicleFault } from "@lib/maintenanceApi";
import { useT, type Translate } from "@lib/i18n";

/** Severity drives colour everywhere, so it is resolved in exactly one place. */
export function faultTone(severity: VehicleFault["severity"]) {
  if (severity === "urgent") return { fg: palette.danger, bg: palette.dangerSoft };
  if (severity === "soon") return { fg: palette.warning, bg: palette.warningSoft };
  return { fg: palette.textMuted, bg: palette.surfaceMuted };
}

function severityLabel(fault: VehicleFault, t: Translate): string {
  if (fault.status === "pending") return t("components.fault.severityPending");
  if (fault.severity === "urgent") return t("components.fault.severityUrgent");
  if (fault.severity === "soon") return t("components.fault.severitySoon");
  return t("components.fault.severityWatch");
}

/**
 * "Seen on 3 trips", plus the recurrence note when there is one.
 *
 * A code that came back after being cleared is the more interesting fact: it
 * usually means the light was reset without the cause being repaired, and a
 * driver who paid for that repair deserves to see it said plainly.
 */
function seenSummary(fault: VehicleFault, t: Translate): string {
  const trips = t("components.fault.seenOnTrips", { count: fault.times_seen });
  if (fault.recurrences > 0) return `${trips} · ${t("components.fault.recurred")}`;
  return trips;
}

export function FaultCard({
  fault,
  variant = "full",
  onPress,
}: {
  fault: VehicleFault;
  variant?: "compact" | "full";
  onPress?: () => void;
}) {
  const t = useT();
  const tone = faultTone(fault.severity);
  const compact = variant === "compact";

  const body = (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.sm,
        borderLeftWidth: 4,
        borderLeftColor: tone.fg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="TriangleAlert" size={15} color={tone.fg} />
        <Text style={{ ...typography.caption, color: tone.fg, fontWeight: "700", flex: 1 }}>
          {severityLabel(fault, t)}
        </Text>
        <Text style={{ ...typography.micro, color: palette.textMuted }}>{fault.code}</Text>
      </View>

      <Text style={{ ...typography.bodyStrong, color: palette.text }}>{fault.title}</Text>

      {/* The consequence. This is the predictive half and the reason to act
          now rather than at the next service, so it stays in both variants. */}
      {fault.leads_to.length > 0 ? (
        <Text style={{ ...typography.caption, color: palette.text, lineHeight: 19 }}>
          <Text style={{ fontWeight: "700" }}>{t("components.fault.ifNotFixed")}</Text>
          {fault.leads_to[0]}
          {fault.cost_multiplier ? (
            <Text style={{ fontWeight: "700" }}>
              {" "}
              {t("components.fault.costMultiplier", {
                multiplier: Math.round(fault.cost_multiplier),
              })}
            </Text>
          ) : null}
        </Text>
      ) : null}

      {!compact && fault.likely_causes.length > 0 ? (
        <View style={{ gap: 4, paddingTop: spacing.xs }}>
          <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "700" }}>
            {t("components.fault.likelyCauses")}
          </Text>
          {fault.likely_causes.map((cause, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: palette.textMuted,
                  marginTop: 7,
                }}
              />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                {cause}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Freeze frame: what the engine was doing when the fault set. It tells
          a mechanic which situation to try to reproduce, which is why it is
          worth showing rather than summarising away. */}
      {!compact && fault.freeze_frame && Object.keys(fault.freeze_frame).length > 0 ? (
        <Text style={{ ...typography.caption, color: palette.textMuted, lineHeight: 19 }}>
          <Text style={{ fontWeight: "700" }}>{t("components.fault.recordedAt")}</Text>
          {Object.entries(fault.freeze_frame)
            .map(([key, value]) => `${key.replace(/_/g, " ")} ${value}`)
            .join(" · ")}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...typography.micro, color: palette.textMuted, flex: 1 }}>
          {seenSummary(fault, t)}
          {/* A family match knows the area, not the defect. Saying so stops the
              screen asserting a specific fault it cannot actually identify. */}
          {fault.is_generic ? ` · ${t("components.fault.generic")}` : ""}
        </Text>
        {onPress ? <Icon name="ChevronRight" size={15} color={tone.fg} /> : null}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("components.fault.a11y", {
        title: fault.title,
        severity: severityLabel(fault, t),
      })}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}
