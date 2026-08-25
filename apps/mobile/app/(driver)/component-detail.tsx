import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ErrorState } from "@components/ui/error-state";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getVehicleHealth,
  rulToBanner,
  type ComponentHealth,
  type ComponentKey,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";
import { getComponentPlan, type ComponentPlan } from "@lib/maintenanceApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";

interface ComponentMeta {
  label: string;
  icon: string;
  whyReasons: (c: ComponentHealth) => string[];
  nextSteps: { title: string; price: string; icon: string; description: string }[];
}

const META: Record<ComponentKey, ComponentMeta> = {
  brake: {
    label: "Brake Pads",
    icon: "Disc",
    whyReasons: (c) => [
      `OBD readings: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Braking events: within normal frequency"
        : "Braking events: above normal frequency",
      c.status === "Good"
        ? "Driving behaviour: no heavy braking detected"
        : "Driving behaviour: heavy braking detected",
    ],
    nextSteps: [
      {
        title: "Order Brake Pads",
        price: "From LKR 11,500",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 2,500",
        icon: "Wrench",
        description: "Suggested garage & indicative fitting cost",
      },
    ],
  },
  engine: {
    label: "Engine Oil",
    icon: "Gauge",
    whyReasons: (c) => [
      `OBD readings: ${Math.round(c.health_pct)}%`,
      `Last oil change: ~${Math.round((c.max_lifespan_km - c.predicted_rul_km) / 1000)}k km ago`,
      c.status === "Good"
        ? "Coolant temp: within normal range"
        : "Coolant temp: elevated patterns detected",
    ],
    nextSteps: [
      {
        title: "Order Engine Oil",
        price: "From LKR 4,500",
        icon: "ShoppingBag",
        description: "Oil, filters & service kits · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 14,800",
        icon: "Droplets",
        description: "Suggested garage & indicative oil-change cost",
      },
    ],
  },
  tire: {
    label: "Tyres",
    icon: "Circle",
    whyReasons: (c) => [
      `Tread health: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Cornering events: within normal range"
        : "Cornering events: above normal frequency",
      c.status === "Good"
        ? "Tread wear: in line with expected rate"
        : "Tread wear: ahead of expected rate",
    ],
    nextSteps: [
      {
        title: "Order Tyres",
        price: "From LKR 7,800",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 1,500",
        icon: "RefreshCw",
        description: "Suggested garage & indicative rotation cost",
      },
    ],
  },
  battery: {
    label: "Battery",
    icon: "Battery",
    whyReasons: (c) => [
      `Battery health: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Voltage readings: stable"
        : "Voltage readings: outside normal range",
      c.status === "Good"
        ? "No voltage drops detected"
        : "Voltage drops detected under load",
    ],
    nextSteps: [
      {
        title: "Order Battery",
        price: "From LKR 16,000",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 500",
        icon: "Zap",
        description: "Suggested garage & indicative test cost",
      },
    ],
  },
};

export default function ComponentDetailScreen() {
  const insets = useSafeAreaInsets();
  const { selectedVehicle } = useVehicle();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  const meta = META[key];

  const vehicleId = selectedVehicle?.plateNumber;

  const [componentHealth, setComponentHealth] = useState<ComponentHealth | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  // Loaded separately from health: it is slower (it may call a language model)
  // and must never hold up the figures the driver came to see.
  const [advice, setAdvice] = useState<ComponentPlan | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);

  // This is the screen a driver reads before deciding to replace a part, so a
  // failed fetch shows the failure rather than a stand-in reading, and with no
  // vehicle selected we ask for one rather than reading some other plate.
  const load = useCallback(() => {
    if (!vehicleId) {
      setComponentHealth(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    getVehicleHealth(vehicleId)
      .then((d) => setComponentHealth(d.components[key]))
      .catch(() => {
        setComponentHealth(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [key, vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetched after health, and allowed to fail quietly: the screen is still
  // fully useful without it, so a slow or missing language model must not
  // block the numbers or surface an error the driver can do nothing about.
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setAdviceLoading(true);

    (async () => {
      // Location is best-effort. getCurrentDriverLocation never throws, and
      // without a real fix the request simply omits lat/lon - garages then
      // rank by rating and the model is told the location is unknown, rather
      // than being handed a default position it would argue from.
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const loc = await getCurrentDriverLocation();
        if (loc?.latitude != null && loc?.longitude != null) {
          lat = loc.latitude;
          lon = loc.longitude;
        }
      } catch {
        /* ranked by rating instead */
      }

      const result = await getComponentPlan(vehicleId, key, {
        lat,
        lon,
        vehicle: selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim() : undefined,
      });
      if (!cancelled) {
        setAdvice(result);
        setAdviceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId, key, selectedVehicle]);

  if (!componentHealth) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
        <DetailHeader label={meta.label} loading={loading} />
        <View style={{ padding: spacing.lg }}>
          {!vehicleId ? (
            <View style={{ gap: spacing.md }}>
              <ErrorState
                title="No vehicle selected"
                message={`Add a vehicle and select it on Home to see its ${meta.label.toLowerCase()} health.`}
              />
              <Pressable
                onPress={() => router.push("/(driver)/manage-vehicles")}
                accessibilityRole="button"
                accessibilityLabel="Manage vehicles"
                style={({ pressed }) => ({
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderColor: palette.brand,
                  backgroundColor: pressed ? palette.brandSoft : "transparent",
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                  Manage Vehicles
                </Text>
              </Pressable>
            </View>
          ) : error ? (
            <ErrorState
              title="Couldn't load health data"
              message={`We couldn't reach the maintenance service to read your ${meta.label.toLowerCase()}. Check your connection and try again.`}
              onRetry={load}
            />
          ) : (
            <ActivityIndicator size="small" color={palette.brand} />
          )}
        </View>
      </View>
    );
  }

  const health = componentHealth;
  const banner = rulToBanner(health);
  const rec = advice?.recommendation ?? null;
  // The full garage row behind the pick, for the phone number and the figures
  // beside the name. Looked up rather than duplicated into the recommendation
  // so the card and the garage list can never disagree about a rating.
  // Real prices for the button, so the figure matches the screen it opens.
  const partCount = advice?.parts.length ?? 0;
  const garageCount = advice?.garages.length ?? 0;
  // Citations arrive as "Document title - Section", and retrieval normally
  // returns several sections of one document. Only the document is worth
  // naming to a driver.
  //
  // NOT useMemo, deliberately. Everything from here down sits after the early
  // return for missing health data, so a hook here is called on some renders
  // and not others - which crashed this screen with "rendered more hooks than
  // during the previous render" the moment health arrived. Deduplicating four
  // short strings is far cheaper than the comparison a memo would do anyway.
  const sourceDocs = Array.from(
    new Set((rec?.sources ?? []).map((s) => s.split(" - ")[0].trim()).filter(Boolean))
  );
  const cheapestPart = advice?.parts.length
    ? Math.min(...advice.parts.map((p) => p.price_lkr))
    : null;
  const recGarage = rec?.garage_id
    ? advice?.garages.find((g) => g.id === rec.garage_id) ?? null
    : null;
  const noData = health.status === "No data";
  const isUrgent = health.predicted_rul_km < 2000;
  const isHealthy = health.status === "Good";

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <DetailHeader label={meta.label} loading={loading} />

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
        }}
      >
        {/* Title + urgency banner */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.h1, color: palette.text }}>{meta.label}</Text>

          {noData ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                backgroundColor: palette.surfaceMuted,
              }}
            >
              <Icon name="Info" size={16} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
                {banner}
              </Text>
            </View>
          ) : !isHealthy ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                backgroundColor: isUrgent ? palette.dangerSoft : palette.warningSoft,
              }}
            >
              <Icon
                name="AlertTriangle"
                size={16}
                color={isUrgent ? palette.danger : palette.warning}
              />
              <Text
                style={{
                  ...typography.caption,
                  color: isUrgent ? palette.danger : palette.warning,
                  fontWeight: "600",
                }}
              >
                {banner}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Health bar */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>Health Score</Text>
            <Text
              style={{
                ...typography.h2,
                color: noData ? palette.textMuted : healthColor(health.health_pct),
                fontWeight: "700",
              }}
            >
              {noData ? "—" : `${Math.round(health.health_pct)}%`}
            </Text>
          </View>
          <View
            style={{
              height: 8,
              borderRadius: radii.pill,
              backgroundColor: palette.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${health.health_pct}%`,
                height: "100%",
                borderRadius: radii.pill,
                backgroundColor: healthColor(health.health_pct),
              }}
            />
          </View>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {noData
              ? "Not enough trip data yet to estimate remaining life"
              : `${Math.round(health.predicted_rul_km).toLocaleString()} km remaining life estimated`}
          </Text>
        </View>

        {/* ── The analysis ────────────────────────────────────────────────
            Four cards, each answering exactly one question, in the order a
            driver actually asks them: why do you say that, what should I do,
            where do I go, and what will happen to my car.

            One question per card and no question answered twice. The earlier
            version put the whole thing in a single paragraph that restated
            the headline, then repeated the reasons again in a separate card
            further down the screen - so the driver read the same conclusion
            three times and still had to work out what to do about it.

            They arrive together because they come from one request, so they
            load as one block. A skeleton rather than a spinner: the shape of
            the answer is visible while it is being written, which makes the
            wait feel like progress instead of a stall. */}
        {noData ? (
          <SectionCard icon="Info" title="How we assess this">
            <Bullets
              items={[
                "No trips recorded yet, so there is nothing to analyse.",
                "Pair an OBD-II adapter and drive - we read live sensor data each trip.",
                "A health score appears once we have enough readings.",
              ]}
            />
          </SectionCard>
        ) : adviceLoading && !advice ? (
          <AnalysisSkeleton />
        ) : advice ? (
          <>
            {/* 1. Why. Server reasons are preferred over the local strings
                because they carry the actual figures, which is what makes the
                conclusion checkable rather than something to be taken on
                trust. The local ones remain as a fallback. */}
            <SectionCard icon="Activity" title="Why we think this">
              <Bullets
                items={
                  advice.advice.reasons.length
                    ? advice.advice.reasons
                    : meta.whyReasons(health)
                }
              />
            </SectionCard>

            {/* 2. What to do. Deterministic - decided by rules on the server,
                never by the model, because these are the words that send
                someone to a garage or leave them driving on worn pads. */}
            {advice.advice.actions.length ? (
              <SectionCard icon="ClipboardCheck" title="What to do">
                <View style={{ gap: spacing.sm }}>
                  {advice.advice.actions.map((action, i) => (
                    <View
                      key={i}
                      style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
                    >
                      <Icon name="Check" size={15} color={palette.brand} />
                      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
                        {action}
                      </Text>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {/* 3. Where. The name and every number beside it were checked
                against a real row on the server before being returned, so the
                driver can verify the claim against the garage list itself. */}
            {rec && rec.garage_name ? (
              <SectionCard icon="MapPin" title="Best garage" accent>
                <View style={{ gap: spacing.sm }}>
                  <Text style={{ ...typography.h3, color: palette.text }}>
                    {rec.garage_name}
                  </Text>

                  {rec.garage_reason ? (
                    <Text style={{ ...typography.body, color: palette.textMuted, lineHeight: 21 }}>
                      {rec.garage_reason}
                    </Text>
                  ) : null}

                  {recGarage ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                      {recGarage.distance_km != null ? (
                        <Chip icon="Navigation" text={`${recGarage.distance_km} km away`} />
                      ) : null}
                      {recGarage.rating != null ? (
                        <Chip icon="Star" text={`${recGarage.rating.toFixed(1)}`} />
                      ) : null}
                      {recGarage.opening_hours ? (
                        <Chip icon="Clock" text={recGarage.opening_hours} />
                      ) : null}
                    </View>
                  ) : null}

                  {rec.part_name ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Icon name="Package" size={14} color={palette.textMuted} />
                      <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                        Fitting {rec.part_name}
                      </Text>
                    </View>
                  ) : null}

                  {rec.estimated_total_lkr != null ? (
                    <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                      Around LKR{" "}
                      {Math.round(rec.estimated_total_lkr).toLocaleString("en-LK")}{" "}
                      <Text style={{ ...typography.micro, color: palette.textMuted }}>
                        part + fitting
                      </Text>
                    </Text>
                  ) : null}

                  {/* Quick links rather than buttons. Calling the garage is
                      the single most likely next action, so it is one tap from
                      the recommendation instead of three screens away. */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.lg,
                      paddingTop: spacing.xs,
                    }}
                  >
                    {recGarage && recGarage.phone ? (
                      <Pressable
                        onPress={() => Linking.openURL(`tel:${recGarage.phone}`)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${rec.garage_name}`}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <Icon name="Phone" size={14} color={palette.brand} />
                        <Text
                          style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}
                        >
                          Call
                        </Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/(driver)/auto-schedule",
                          params: { component: key },
                        })
                      }
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="See all garages"
                    >
                      <Text
                        style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}
                      >
                        See all garages →
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </SectionCard>
            ) : null}

            {/* 4. What will actually happen. This is the only part of the
                screen a rules engine could not have written: it is general
                automotive knowledge, not a claim about this vehicle's data,
                and it is what a driver most often does not know when handing
                over the keys. */}
            {rec && rec.how_its_done ? (
              <SectionCard icon="Wrench" title="How they will do it">
                <View style={{ gap: spacing.sm }}>
                  <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
                    Expert says
                  </Text>
                  <Text style={{ ...typography.body, color: palette.text, lineHeight: 22 }}>
                    {rec.how_its_done}
                  </Text>
                  {/* Provenance. The two states say genuinely different
                      things and must not be blurred together: with sources,
                      this text was written from documents we wrote and can
                      point at; without them, it is the model's own general
                      knowledge. A driver judging whether the work was done
                      properly deserves to know which one they are reading.

                      Titles are de-duplicated because retrieval usually
                      returns several sections of the same document, and
                      "Brake pad replacement" listed four times reads as a
                      rendering fault rather than as a citation. */}
                  {sourceDocs.length ? (
                    <View style={{ gap: 4 }}>
                      <Text style={{ ...typography.micro, color: palette.textMuted }}>
                        Based on {sourceDocs.length === 1 ? "our guide" : "our guides"}:{" "}
                        {sourceDocs.join(" · ")}
                      </Text>
                      <Text style={{ ...typography.micro, color: palette.textMuted }}>
                        Your mechanic may work differently
                        {advice.advice.is_estimated ? " · some figures are estimated" : ""}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ ...typography.micro, color: palette.textMuted }}>
                      General guidance - your mechanic may work differently
                      {advice.advice.is_estimated ? " · some figures are estimated" : ""}
                    </Text>
                  )}
                </View>
              </SectionCard>
            ) : advice.advice.is_estimated ? (
              <Text style={{ ...typography.micro, color: palette.textMuted }}>
                Some figures are estimated
              </Text>
            ) : null}
          </>
        ) : null}

        {/* ── Next steps ──────────────────────────────────────────────────
            Two cards, and only two: buy the part, book the fitting. That is
            the whole job, in the order it happens.

            The floating bar that used to sit here offered Auto Schedule,
            Select and schedule, and Not now - three buttons, two of which led
            to the same place as the cards directly above them, while the
            third did nothing but go back. It covered the bottom of the page
            on every scroll to repeat choices already on screen.

            Prices come from the parts actually returned for this vehicle
            whenever they are available, so the figure on the button matches
            the figure on the screen it opens. */}
        {!isHealthy && !noData && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Next steps
            </Text>

            <Pressable
              onPress={() =>
                router.push({ pathname: "/(driver)/order-parts", params: { component: key } })
              }
              accessibilityRole="button"
              accessibilityLabel={meta.nextSteps[0].title}
              style={({ pressed }) => ({
                backgroundColor: pressed ? palette.homeBackground : palette.surface,
                borderRadius: radii.lg,
                padding: spacing.lg,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                borderWidth: 1,
                borderColor: palette.border,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radii.md,
                  backgroundColor: palette.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="ShoppingBag" size={20} color={palette.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                  {meta.nextSteps[0].title}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {partCount
                    ? `${partCount} ${partCount === 1 ? "option" : "options"} that fit your vehicle`
                    : meta.nextSteps[0].description}
                </Text>
              </View>
              <Text style={{ ...typography.bodyStrong, color: palette.brand, fontWeight: "700" }}>
                {cheapestPart != null
                  ? `From LKR ${Math.round(cheapestPart).toLocaleString("en-LK")}`
                  : meta.nextSteps[0].price}
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                router.push({ pathname: "/(driver)/auto-schedule", params: { component: key } })
              }
              accessibilityRole="button"
              accessibilityLabel={
                rec?.garage_name ? `Book the fitting at ${rec.garage_name}` : "See garage options"
              }
              style={({ pressed }) => ({
                backgroundColor: pressed ? palette.homeBackground : palette.surface,
                borderRadius: radii.lg,
                padding: spacing.lg,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                borderWidth: 1,
                borderColor: palette.border,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radii.md,
                  backgroundColor: palette.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="Wrench" size={20} color={palette.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                  {rec?.garage_name ? `Book at ${rec.garage_name}` : "Book the fitting"}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {garageCount
                    ? `${garageCount} ${garageCount === 1 ? "garage" : "garages"} near you`
                    : "See garage options"}
                </Text>
              </View>
              {recGarage && recGarage.distance_km != null ? (
                <Text style={{ ...typography.bodyStrong, color: palette.brand, fontWeight: "700" }}>
                  {recGarage.distance_km} km
                </Text>
              ) : (
                <Icon name="ChevronRight" size={18} color={palette.brand} />
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>

    </View>
  );
}

function DetailHeader({ label, loading }: { label: string; loading: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: palette.surface,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
        <Icon name="ChevronLeft" size={24} color={palette.text} />
      </Pressable>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>Health</Text>
      <Icon name="ChevronRight" size={14} color={palette.textMuted} />
      <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>{label}</Text>
      {loading && <ActivityIndicator size="small" color={palette.brand} />}
    </View>
  );
}

function healthColor(pct: number): string {
  if (pct >= 75) return palette.success;
  if (pct >= 50) return palette.warning;
  return palette.danger;
}

/**
 * One card, one question. Every section of the analysis uses this, so the
 * cards read as a set of answers rather than as unrelated boxes, and adding a
 * fifth question later cannot accidentally invent a fifth visual style.
 *
 * `accent` tints the card for the recommendation, which is the one section
 * that is a suggestion rather than a finding.
 */
function SectionCard({
  icon,
  title,
  accent = false,
  children,
}: {
  icon: IconName;
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: accent ? palette.brandSoft : palette.surface,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={icon} size={16} color={palette.brand} />
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.brand,
              marginTop: 7,
            }}
          />
          <Text style={{ ...typography.body, color: palette.textMuted, flex: 1, lineHeight: 21 }}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Chip({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
        borderRadius: radii.pill,
        backgroundColor: palette.surface,
      }}
    >
      <Icon name={icon} size={12} color={palette.textMuted} />
      <Text style={{ ...typography.micro, color: palette.text, letterSpacing: 0 }}>{text}</Text>
    </View>
  );
}

/**
 * A slow opacity pulse, driven natively so it keeps running smoothly while the
 * JS thread is busy parsing the response it is waiting for - which is exactly
 * when a janky animation would be most noticeable.
 */
function Pulse({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    // Stopping on unmount matters: this screen is pushed and popped often, and
    // a leaked loop keeps a native animation driver alive per visit.
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function Bar({ width, height = 12 }: { width: number | `${number}%`; height?: number }) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radii.pill,
        backgroundColor: palette.border,
      }}
    />
  );
}

/**
 * Placeholder cards in the shape of the real ones.
 *
 * A bare spinner here read as "something is stuck", because the wait is a
 * language-model call and can run to several seconds. Showing the layout that
 * is coming makes the same wait read as work in progress, and the labels say
 * exactly which question each card will answer.
 */
function AnalysisSkeleton() {
  return (
    <Pulse>
      <View style={{ gap: spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.xs,
          }}
        >
          <Icon name="Sparkles" size={14} color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
            Working out your best options…
          </Text>
        </View>

        {[
          { title: "Why we think this", lines: 3 },
          { title: "What to do", lines: 2 },
          { title: "Best garage", lines: 2 },
        ].map((card) => (
          <View
            key={card.title}
            style={{
              backgroundColor: palette.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{card.title}</Text>
            <View style={{ gap: spacing.sm }}>
              {Array.from({ length: card.lines }).map((_, i) => (
                <Bar key={i} width={i === card.lines - 1 ? "60%" : "100%"} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Pulse>
  );
}
