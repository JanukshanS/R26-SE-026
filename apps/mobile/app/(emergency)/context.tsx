import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, type SLContext } from "@lib/emergencyContext";
import { submitTriage, DispatchApiError } from "@lib/dispatchApi";
import { readObdFromElm327, isElm327Paired } from "@lib/elm327";

const LOCATION_OPTIONS: { value: SLContext["location_type"]; label: string }[] = [
  { value: "COASTAL", label: "Coastal" },
  { value: "HILL",    label: "Hill country" },
  { value: "URBAN",   label: "City / town" },
  { value: "RURAL",   label: "Rural" },
];
const RAIN_OPTIONS: { value: SLContext["recent_rain"]; label: string }[] = [
  { value: "NONE",          label: "No rain" },
  { value: "YESTERDAY",     label: "Yesterday" },
  { value: "WITHIN_3_DAYS", label: "Past 3 days" },
  { value: "MONSOON",       label: "Monsoon — heavy" },
];
const PARK_OPTIONS: { value: SLContext["parked_overnight"]; label: string }[] = [
  { value: "INDOOR",  label: "Garage / covered" },
  { value: "OUTDOOR", label: "Open / street" },
];
const AGE_OPTIONS: { value: SLContext["vehicle_age_bucket"]; label: string }[] = [
  { value: "UNDER_3", label: "< 3 yr" },
  { value: "3_7",     label: "3-7 yr" },
  { value: "8_15",    label: "8-15 yr" },
  { value: "OVER_15", label: "> 15 yr" },
];
const FUEL_OPTIONS: { value: SLContext["last_fueled"]; label: string }[] = [
  { value: "TODAY_NEW_STATION", label: "Today — new station" },
  { value: "TODAY_USUAL",       label: "Today — usual station" },
  { value: "WITHIN_WEEK",       label: "Within past week" },
  { value: "OVER_WEEK",         label: "Over a week ago" },
];

export default function ContextScreen() {
  const {
    slContext, setSLContext,
    incidentId, buildTriageResponses,
    setTriageResult, setError,
  } = useEmergency();
  const [submitting, setSubmitting] = useState(false);
  const [obdState, setObdState] = useState<"unknown" | "yes" | "no">("unknown");
  const obdPaired = isElm327Paired();

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
      Alert.alert("Missing incident", "Restart the emergency flow from the home screen.");
      return;
    }
    setSubmitting(true);
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
      const msg = err instanceof DispatchApiError
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error).message;
      setError(msg);
      Alert.alert("Triage failed", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <Button
          title={submitting ? "Diagnosing..." : "Get Diagnosis"}
          disabled={submitting}
          onPress={handleSubmit}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>One last thing</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        These help us narrow down the most likely fault for Sri Lankan conditions.
      </Text>

      <Card>
        <Field label="Where are you?">
          <Chips
            options={LOCATION_OPTIONS}
            value={slContext.location_type}
            onChange={(v) => setSLContext({ location_type: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label="Recent rain in your area?">
          <Chips
            options={RAIN_OPTIONS}
            value={slContext.recent_rain}
            onChange={(v) => setSLContext({ recent_rain: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label="Where was it parked overnight?">
          <Chips
            options={PARK_OPTIONS}
            value={slContext.parked_overnight}
            onChange={(v) => setSLContext({ parked_overnight: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label="How old is the vehicle?">
          <Chips
            options={AGE_OPTIONS}
            value={slContext.vehicle_age_bucket}
            onChange={(v) => setSLContext({ vehicle_age_bucket: v })}
          />
        </Field>
      </Card>

      <Card>
        <Field label="When did you last fuel up?">
          <Chips
            options={FUEL_OPTIONS}
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
            ? "ELM327 dongle paired — diagnosis will run at Tier-2 (OBD-enhanced)."
            : "No OBD sensor paired — diagnosis will run at Tier-1 (questionnaire only)."}
        </Text>
      )}
      {submitting && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {obdPaired ? "Reading OBD-II telemetry + running ML..." : "Running ML decision tree..."}
          </Text>
        </View>
      )}
      {obdState !== "unknown" && !submitting && (
        <Text style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}>
          {obdState === "yes"
            ? "OBD telemetry attached — Tier-2 diagnosis."
            : "No OBD device paired — Tier-1 (questionnaire only)."}
        </Text>
      )}
    </Screen>
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
