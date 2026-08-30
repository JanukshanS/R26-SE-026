import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Card } from "@components/ui/card";
import { QuestionScreen } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, type SLContext } from "@lib/emergencyContext";
import { submitTriage, DispatchApiError } from "@lib/dispatchApi";
import { readObdFromElm327, isElm327Paired } from "@lib/elm327";
import { useT } from "@lib/i18n";

const LOCATION_OPTIONS: { value: SLContext["location_type"]; labelKey: string }[] = [
  { value: "COASTAL", labelKey: "emergency.context.locationCoastal" },
  { value: "HILL",    labelKey: "emergency.context.locationHill" },
  { value: "URBAN",   labelKey: "emergency.context.locationUrban" },
  { value: "RURAL",   labelKey: "emergency.context.locationRural" },
];
const RAIN_OPTIONS: { value: SLContext["recent_rain"]; labelKey: string }[] = [
  { value: "NONE",          labelKey: "emergency.context.rainNone" },
  { value: "YESTERDAY",     labelKey: "emergency.context.rainYesterday" },
  { value: "WITHIN_3_DAYS", labelKey: "emergency.context.rainThreeDays" },
  { value: "MONSOON",       labelKey: "emergency.context.rainMonsoon" },
];
const PARK_OPTIONS: { value: SLContext["parked_overnight"]; labelKey: string }[] = [
  { value: "INDOOR",  labelKey: "emergency.context.parkIndoor" },
  { value: "OUTDOOR", labelKey: "emergency.context.parkOutdoor" },
];
const AGE_OPTIONS: { value: SLContext["vehicle_age_bucket"]; labelKey: string }[] = [
  { value: "UNDER_3", labelKey: "emergency.context.ageUnder3" },
  { value: "3_7",     labelKey: "emergency.context.age3to7" },
  { value: "8_15",    labelKey: "emergency.context.age8to15" },
  { value: "OVER_15", labelKey: "emergency.context.ageOver15" },
];
const FUEL_OPTIONS: { value: SLContext["last_fueled"]; labelKey: string }[] = [
  { value: "TODAY_NEW_STATION", labelKey: "emergency.context.fuelTodayNew" },
  { value: "TODAY_USUAL",       labelKey: "emergency.context.fuelTodayUsual" },
  { value: "WITHIN_WEEK",       labelKey: "emergency.context.fuelWithinWeek" },
  { value: "OVER_WEEK",         labelKey: "emergency.context.fuelOverWeek" },
];

export default function ContextScreen() {
  const t = useT();
  const {
    slContext, setSLContext,
    incidentId, buildTriageResponses,
    setTriageResult, setError,
  } = useEmergency();
  const [submitting, setSubmitting] = useState(false);
  const [obdState, setObdState] = useState<"unknown" | "yes" | "no">("unknown");
  const obdPaired = isElm327Paired();
  // `submitting` only disables the button on the next render, which leaves a
  // double-tap window open that would submit triage twice.
  const inFlightRef = useRef(false);

  /**
   * Final submit:
   *   1. Read live OBD telemetry from the paired ELM327 (or `null` if no
   *      sensor is paired — the vehicle is "manual" and Tier-1 is fine).
   *   2. Build the triage request from collected questionnaire answers.
   *   3. POST to /api/v1/triage/submit. Backend auto-selects Tier-2 when
   *      `obdData.available === true`.
   */
  async function handleSubmit() {
    if (!incidentId) {
      Alert.alert(
        t("emergency.context.lostRequestTitle"),
        t("emergency.context.lostRequestBody"),
        [
          { text: t("emergency.action.notNow"), style: "cancel" },
          { text: t("emergency.action.goHome"), onPress: () => router.replace("/(driver)/home") },
        ]
      );
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Read OBD directly from the (simulated) ELM327 dongle. No dependency
      // on Herath's maintenance service — fully owned by dispatch. Passing
      // incidentId so the ELM327 stub re-randomizes the vehicle's "current
      // condition" per emergency (otherwise every dispatch would return the
      // same diagnosis for the entire session).
      const obd = await readObdFromElm327(incidentId);
      setObdState(obd ? "yes" : "no");

      const responses = buildTriageResponses();
      const triage = await submitTriage({
        incidentId,
        responses,
        obdData: obd ? { ...obd } : undefined,
      });
      setTriageResult(triage.result);
      router.push("/(emergency)/diagnosis-result");
    } catch (err) {
      const reachable = err instanceof DispatchApiError;
      const msg = reachable
        ? t("emergency.error.withStatus", { message: err.message, status: err.status })
        : (err as Error).message;
      setError(msg);
      Alert.alert(
        t("emergency.context.diagnosisFailedTitle"),
        reachable
          ? t("emergency.context.diagnosisFailedBody", { message: msg })
          : t("emergency.context.diagnosisUnreachableBody") + (
              __DEV__ ? `\n\n[dev] ${msg}` : ""
            )
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <QuestionScreen
      route="context"
      prompt={t("emergency.context.prompt")}
      nextLabel={submitting ? t("emergency.context.diagnosing") : t("emergency.context.getDiagnosis")}
      canNext={!submitting}
      onNext={handleSubmit}
    >

      <Card>
        <Field label={t("emergency.context.fieldLocation")}>
          <Chips
            options={LOCATION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            value={slContext.location_type}
            onChange={(v) => setSLContext({ location_type: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t("emergency.context.fieldRain")}>
          <Chips
            options={RAIN_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            value={slContext.recent_rain}
            onChange={(v) => setSLContext({ recent_rain: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t("emergency.context.fieldParked")}>
          <Chips
            options={PARK_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            value={slContext.parked_overnight}
            onChange={(v) => setSLContext({ parked_overnight: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t("emergency.context.fieldAge")}>
          <Chips
            options={AGE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            value={slContext.vehicle_age_bucket}
            onChange={(v) => setSLContext({ vehicle_age_bucket: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label={t("emergency.context.fieldFuel")}>
          <Chips
            options={FUEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            value={slContext.last_fueled}
            onChange={(v) => setSLContext({ last_fueled: v })}
          />
        </Field>
      </Card>

      {/* Tell the user up-front whether ELM327 is paired so they know what
          tier to expect. */}
      {!submitting && obdState === "unknown" && (
        <Text style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}>
          {obdPaired
            ? t("emergency.context.obdPaired")
            : t("emergency.context.obdNotPaired")}
        </Text>
      )}
      {submitting && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {obdPaired ? t("emergency.context.runningObd") : t("emergency.context.runningMl")}
          </Text>
        </View>
      )}
      {obdState !== "unknown" && !submitting && (
        <Text style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}>
          {obdState === "yes"
            ? t("emergency.context.obdAttached")
            : t("emergency.context.obdAbsent")}
        </Text>
      )}
    </QuestionScreen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Chips<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 2,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: active ? palette.brand : palette.border,
                backgroundColor: active ? palette.brand : palette.surface,
              })}
            >
              <Text
                style={{
                  ...typography.caption,
                  fontWeight: "600",
                  color: active ? palette.textOnBrand : palette.text,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
