/**
 * One fault code, with the same treatment a worn component gets.
 *
 * WHY A SEPARATE SCREEN FROM component-detail. That screen is built around a
 * wear bar and a remaining-life figure. A fault has neither - a cylinder
 * misfire is not a percentage of anything - and a third of the codes we
 * catalogue (transmission, evaporative, fuel cap) map to no component at all,
 * so there is no component screen to send them to.
 *
 * Rather than leave those as a dead end, every fault gets a page: what it is,
 * what it damages if ignored, where to fix it, and what the mechanic will
 * actually do. The wear reading appears as CONTEXT when the fault maps to a
 * component, and is simply absent when it does not.
 *
 * The health figures on this screen are never modified by the fault. A misfire
 * does not consume engine life, so the wear number beside it stays exactly what
 * the model said.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ErrorState } from "@components/ui/error-state";
import { FaultCard } from "@components/ui/fault-card";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { getFaultPlan, type FaultPlan } from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";
import { getCurrentDriverLocation } from "@lib/driverLocation";

/** Component key -> the label and route used by the wear screens. */
const COMPONENT_LABEL: Record<string, string> = {
  engine: "Engine",
  brake: "Brake Pads",
  tire: "Tyres",
  battery: "Battery",
};

export default function FaultDetailScreen() {
  const insets = useSafeAreaInsets();
  const { selectedVehicle } = useVehicle();
  const { code } = useLocalSearchParams<{ code: string }>();
  const faultCode = (code ?? "").toUpperCase();
  const vehicleId = selectedVehicle?.plateNumber;

  const [plan, setPlan] = useState<FaultPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!vehicleId || !faultCode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);

    // Location is best-effort, exactly as on the component screen: without a
    // fix the request omits lat/lon, garages rank by rating, and the model is
    // told the location is unknown rather than handed a default to argue from.
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

    const result = await getFaultPlan(vehicleId, faultCode, {
      lat,
      lon,
      vehicle: selectedVehicle
        ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim()
        : undefined,
    });
    setPlan(result);
    setFailed(result === null);
    setLoading(false);
  }, [vehicleId, faultCode, selectedVehicle]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !plan) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
        <FaultHeader code={faultCode} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {loading ? (
            <PlanSkeleton />
          ) : (
            <ErrorState
              title="Couldn't load this fault"
              message={
                !vehicleId
                  ? "Select a vehicle on Home to see its faults."
                  : `We couldn't reach the maintenance service to read ${faultCode}. Check your connection and try again.`
              }
              onRetry={vehicleId ? load : undefined}
            />
          )}
        </View>
      </View>
    );
  }

  const { fault, recommendation: rec } = plan;
  const recGarage = rec?.garage_id
    ? plan.garages.find((g) => g.id === rec.garage_id) ?? null
    : null;
  const componentLabel = COMPONENT_LABEL[fault.component];
  const sourceDocs = Array.from(
    new Set((rec?.sources ?? []).map((s) => s.split(" - ")[0].trim()).filter(Boolean))
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <FaultHeader code={faultCode} />

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
        }}
      >
        {/* The fault itself, in full: causes, consequence, freeze frame. */}
        <FaultCard fault={fault} variant="full" />

        {/* Wear context. Present only when this fault belongs to a component
            we model, and stated as UNAFFECTED on purpose - a driver seeing a
            critical fault next to a 94% engine should be told plainly that the
            two measure different things, not left to assume one is wrong. */}
        {componentLabel && plan.component_health ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(driver)/component-detail",
                params: { component: fault.component },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${componentLabel} wear health`}
            style={({ pressed }) => ({
              backgroundColor: pressed ? palette.homeBackground : palette.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
              gap: spacing.sm,
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="Gauge" size={16} color={palette.brand} />
              <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>
                {componentLabel} wear
              </Text>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {Math.round(plan.component_health.health_pct)}%
              </Text>
              <Icon name="ChevronRight" size={16} color={palette.brand} />
            </View>
            <Text style={{ ...typography.caption, color: palette.textMuted, lineHeight: 19 }}>
              Unchanged by this fault — wear is how much life the part has left, a
              fault is a separate defect. Tap to see the wear detail.
            </Text>
          </Pressable>
        ) : null}

        {/* Where to fix it. */}
        {rec && rec.garage_name ? (
          <SectionCard icon="MapPin" title="Best garage" accent>
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.h3, color: palette.text }}>{rec.garage_name}</Text>

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
                    <Chip icon="Star" text={recGarage.rating.toFixed(1)} />
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
                  Around LKR {Math.round(rec.estimated_total_lkr).toLocaleString("en-LK")}{" "}
                  <Text style={{ ...typography.micro, color: palette.textMuted }}>
                    part + fitting
                  </Text>
                </Text>
              ) : null}

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
                  onPress={() => router.push("/(driver)/marketplace")}
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

        {/* What the mechanic will actually do. */}
        {rec && rec.how_its_done ? (
          <SectionCard icon="Wrench" title="How they will fix it">
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
                Expert says
              </Text>
              <Text style={{ ...typography.body, color: palette.text, lineHeight: 22 }}>
                {rec.how_its_done}
              </Text>
              {sourceDocs.length ? (
                <Text style={{ ...typography.micro, color: palette.textMuted }}>
                  Based on {sourceDocs.length === 1 ? "our guide" : "our guides"}:{" "}
                  {sourceDocs.join(" · ")}
                </Text>
              ) : (
                <Text style={{ ...typography.micro, color: palette.textMuted }}>
                  General guidance — your mechanic may work differently
                </Text>
              )}
            </View>
          </SectionCard>
        ) : null}

        {/* Parts, when this fault maps to something we stock for. */}
        {plan.parts.length > 0 ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(driver)/order-parts",
                params: { component: fault.component },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Order parts"
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
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>Order parts</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {plan.parts.length} {plan.parts.length === 1 ? "option" : "options"} that fit
                your vehicle
              </Text>
            </View>
            <Icon name="ChevronRight" size={18} color={palette.brand} />
          </Pressable>
        ) : null}

        {/* No recommendation at all: say why, rather than showing an empty page. */}
        {!rec ? (
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
              gap: spacing.sm,
            }}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              No suggestion available
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted, lineHeight: 19 }}>
              We couldn't reach the assistant just now. The fault details above are
              from your vehicle and are unaffected.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FaultHeader({ code }: { code: string }) {
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
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Icon name="ChevronLeft" size={24} color={palette.text} />
      </Pressable>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>Fault</Text>
      <Icon name="ChevronRight" size={14} color={palette.textMuted} />
      <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>{code}</Text>
    </View>
  );
}

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
 * Placeholder cards in the shape of the real ones.
 *
 * Same reasoning as the component screen: the wait is a language-model call and
 * can run several seconds, and a bare spinner reads as "stuck" where a skeleton
 * reads as work in progress.
 */
function PlanSkeleton() {
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity, gap: spacing.md }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.xs,
        }}
      >
        <ActivityIndicator size="small" color={palette.brand} />
        <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
          Working out what to do…
        </Text>
      </View>
      {["What is wrong", "Best garage", "How they will fix it"].map((title) => (
        <View
          key={title}
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{title}</Text>
          <View style={{ gap: spacing.sm }}>
            <View
              style={{ height: 12, borderRadius: radii.pill, backgroundColor: palette.border }}
            />
            <View
              style={{
                height: 12,
                width: "60%",
                borderRadius: radii.pill,
                backgroundColor: palette.border,
              }}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}
