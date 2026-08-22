import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { BottomNavBar } from "@components/ui/bottom-nav-bar";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { ObdSourceBadge } from "@components/ui/obd-source-badge";
import { EngineStateDebug } from "@components/ui/engine-state-debug";
import { QuickAction } from "@components/ui/quick-action";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getVehicleHealth,
  rulToLabel,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { isElm327Paired, isRealBleSupported, pairElm327Async, unpairElm327 } from "@lib/elm327";
import { useVehicle } from "@lib/vehicleContext";
import type { Vehicle } from "@lib/vehicleApi";
import { getVehicleInsurance, type VehicleInsurance } from "@lib/vehicleInsuranceApi";
import { isExpiringSoon } from "@lib/insurer-field-format";
import { useHardwareBack } from "@lib/useHardwareBack";
import { endTrip, isTripActive, startTrip } from "@lib/tripRecorder";
import { getCachedClaims, listMyClaims } from "@lib/claims-api";
import { loadDismissedClaimId } from "@lib/claim-upload-dedupe";
import { useIncompleteUploadStatus } from "@/features/report-accident/hooks/use-incomplete-upload-status";
import { ClaimUploadReminderModal } from "@/features/report-accident/components/claim-upload-reminder-modal";

const BOTTOM_SCROLL_PADDING = 112;

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const bottomReserve = BOTTOM_SCROLL_PADDING + insets.bottom;

  const { user, logout, selectedVehicle, vehicles, vehiclesLoading, selectVehicle } = useVehicle();
  const incompleteUpload = useIncompleteUploadStatus();

  // Home is the post-auth root: block the Android back button so it can never
  // pop back to the welcome/login screen. The only way off home is Log out.
  useHardwareBack(useCallback(() => true, []));
  const [health, setHealth] = useState<VehicleHealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [showObd, setShowObd] = useState(() => !isElm327Paired());
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  // Vehicle tapped in the picker, awaiting confirmation before actually switching.
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null);
  // True while the Insurance button's existing-claim check (a network call) is in
  // flight — shown as a spinner in place of the icon so the tap doesn't feel dead.
  const [checkingInsuranceStatus, setCheckingInsuranceStatus] = useState(false);
  // Shown when the selected vehicle's insurance is expiring soon and the driver taps Insurance.
  const [renewalReminderVisible, setRenewalReminderVisible] = useState(false);
  // Shown when the driver taps Insurance with no vehicle on file at all.
  const [noVehicleReminderVisible, setNoVehicleReminderVisible] = useState(false);
  // Real BLE pairing is async (scan + connect takes seconds). We show a
  // "Connecting…" state while it runs. pairElm327Async never rejects — it
  // falls back to the on-device simulation when no real dongle is reachable
  // (Expo Go, web, Bluetooth off, or nothing found) — so we don't need an
  // error branch here; we just close the modal once it settles.
  const [pairingObd, setPairingObd] = useState(false);
  // Set once pairElm327Async resolves, so the modal can show exactly what
  // happened (real dongle vs simulated fallback) instead of just closing
  // silently — the user has no other way to know which one they got.
  const [pairResult, setPairResult] = useState<{ source: "ble" | "classic" | "sim"; deviceName?: string } | null>(null);
  const isRealPairResult = pairResult?.source === "ble" || pairResult?.source === "classic";

  const vehicleId = selectedVehicle?.plateNumber ?? "";
  const vehicleLabel = selectedVehicle
  ? (selectedVehicle.nickname || `${selectedVehicle.make} ${selectedVehicle.model}`)
  : "No vehicle added";

  // Insurance lives in its own table (vehicle_insurance), not on the vehicle row itself,
  // so it's fetched separately whenever the selected vehicle changes. `undefined` (not yet
  // loaded) is distinguished from `null` (loaded, no insurance saved) so the "missing
  // details" badge doesn't flash on briefly while this is still resolving.
  const [vehicleInsurance, setVehicleInsurance] = useState<VehicleInsurance | null | undefined>(undefined);

  useEffect(() => {
    if (!selectedVehicle) {
      setVehicleInsurance(null);
      return;
    }
    let cancelled = false;
    setVehicleInsurance(undefined);
    getVehicleInsurance(selectedVehicle._id)
      .then((insurance) => {
        if (!cancelled) setVehicleInsurance(insurance);
      })
      .catch(() => {
        if (!cancelled) setVehicleInsurance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVehicle]);

  // No vehicle at all (e.g. the driver just deleted their only one) — Insurance has
  // nothing to attach a claim to, so it must not proceed into the flow.
  const hasNoVehicles = !vehiclesLoading && vehicles.length === 0;

  // Licence/NIC live on the profile — all five are required before the Insurance
  // flow is usable for the selected vehicle.
  const missingInsuranceDetails = Boolean(
    selectedVehicle &&
      vehicleInsurance !== undefined &&
      (!vehicleInsurance?.insuranceProvider ||
        !vehicleInsurance?.insurancePolicyNumber ||
        !vehicleInsurance?.insuranceExpireMonth ||
        !user?.licenceNumber ||
        !user?.nicNumber)
  );
  // Expiring this month, next month, or already lapsed — month-only granularity,
  // see isExpiringSoon. Only meaningful once an expiry month is actually on file.
  const insuranceExpiringSoon = Boolean(
    selectedVehicle &&
      vehicleInsurance?.insuranceExpireMonth &&
      isExpiringSoon(vehicleInsurance.insuranceExpireMonth)
  );

  // The Insurance button's actual destination logic — factored out so both a direct
  // tap (nothing wrong) and dismissing the renewal-reminder popup below can reach it.
  async function proceedToInsuranceFlow() {
    if (incompleteUpload) {
      router.push({
        pathname: "/(insurance)/upload-accident-details",
        params: {
          uploadKey: incompleteUpload.uploadKey,
          reportedAtIso: incompleteUpload.reportedAtIso,
          vehicleId: selectedVehicle?._id,
        },
      });
      return;
    }
    // Already have a finished claim on the server (from this session, an
    // older one, or a different device) — go straight to its submitted
    // view instead of the 4-steps screen. Local files aren't needed for
    // this, only the backend's own record of it. Prefer the cache warmed
    // at login (claims-api.ts) — instant, no spinner needed. Only fall back
    // to a live fetch (with a spinner, since this one takes a moment) if
    // that cache isn't ready yet for some reason.
    //
    // But if the driver already dismissed this exact claim via "Start New
    // Claim", don't redirect back to it even though the server hasn't seen a
    // newer one yet — they may be mid-way through a new claim's steps locally.
    const dismissedId = await loadDismissedClaimId();
    const cached = getCachedClaims();
    if (cached) {
      const latest = cached[0];
      if (latest && latest.status !== "uploading" && latest.id !== dismissedId) {
        router.push({
          pathname: "/(insurance)/upload-accident-details",
          params: { existingClaimId: latest.id, vehicleId: selectedVehicle?._id },
        });
        return;
      }
    } else {
      setCheckingInsuranceStatus(true);
      try {
        const claims = await listMyClaims();
        const latest = claims[0];
        if (latest && latest.status !== "uploading" && latest.id !== dismissedId) {
          router.push({
            pathname: "/(insurance)/upload-accident-details",
            params: { existingClaimId: latest.id, vehicleId: selectedVehicle?._id },
          });
          return;
        }
      } catch {
        // Best-effort — fall through to the normal 4-steps flow if this check fails.
      } finally {
        setCheckingInsuranceStatus(false);
      }
    }
    router.push({
      pathname: "/(insurance)",
      params: { vehicleId: selectedVehicle?._id },
    });
  }

  const handlePairObd = useCallback(async () => {
    setPairingObd(true);
    try {
      // Tries a real ELM327 dongle over Bluetooth first; transparently falls
      // back to the on-device simulation if none is reachable. Persists for
      // the session so subsequent triage submissions read live OBD telemetry
      // and run at Tier-2 (OBD-enhanced) on the dispatch backend.
      const info = await pairElm327Async(vehicleId);
      setPairResult({ source: info.source, deviceName: info.deviceName });
    } finally {
      setPairingObd(false);
    }
  }, [vehicleId]);

  // The card shows nothing rather than a stand-in score when the service can't
  // be reached — a driver decides on repairs from these numbers.
  const loadHealth = useCallback(() => {
    // No vehicle selected yet — nothing to score, and scoring some other
    // driver's plate would be worse than showing the empty state.
    if (!vehicleId) {
      setHealth(null);
      setHealthError(false);
      setLoadingHealth(false);
      return;
    }
    setLoadingHealth(true);
    setHealthError(false);
    getVehicleHealth(vehicleId)
      .then((d) => setHealth(d))
      .catch(() => {
        setHealth(null);
        setHealthError(true);
      })
      .finally(() => setLoadingHealth(false));
  }, [vehicleId]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const alertComponents = (["brake", "engine", "tire", "battery"] as const).filter(
    (k) => {
      const s = health?.components[k]?.status;
      // Only flag genuine wear (Fair/Poor/Critical). "No data" (no trips yet)
      // and a missing component are not alerts.
      return s != null && s !== "Good" && s !== "No data";
    }
  );
  const noData = health?.overall_status === "No data";

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <Screen
        background="home"
        edges={["top"]}
        contentContainerStyle={{ paddingBottom: bottomReserve, gap: spacing.lg }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <View style={{ gap: spacing.xs }}>
            {user?.location ? (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>{user.location}</Text>
            ) : null}
            <Text style={{ ...typography.body, color: palette.text }}>
              {user ? (
                <>
                  Hi <Text style={{ fontWeight: "700" }}>{user.name.split(" ")[0]}!</Text>
                </>
              ) : (
                "Welcome"
              )}
            </Text>
          </View>

          {/* Authenticated users get a real Log out (clears the session +
              unpairs the ELM327); guests get a Sign in shortcut instead — the
              same corner never shows "Log out" to someone who isn't signed in. */}
          {user ? (
            <Pressable
              onPress={async () => {
                // A recording left running would keep sampling under the previous
                // driver's id and surface as "Trip in progress" for whoever signs in next.
                if (isTripActive()) await endTrip().catch(() => {});
                unpairElm327();
                await logout();
                router.replace("/");
              }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              })}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Icon name="LogOut" size={14} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
                Log out
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push("/(driver)/auth")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: palette.brand,
                backgroundColor: palette.brandSoft,
              })}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <Icon name="LogIn" size={14} color={palette.brand} />
              <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
                Sign in
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => setShowVehiclePicker(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ flex: 1, ...typography.display, color: palette.text, fontSize: 28 }}>
            {vehicleLabel}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
              borderRadius: radii.md,
              backgroundColor: palette.brandSoft,
            }}
          >
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
              {selectedVehicle?.plateNumber ?? "Add vehicle"}
            </Text>
            <Icon name="ChevronDown" size={16} color={palette.brand} />
          </View>
        </Pressable>

        {/* Vehicle health card — taps through to health screen */}
        <Pressable
          onPress={() => {
            if (!vehicleId) return setShowVehiclePicker(true);
            if (healthError) return loadHealth();
            router.push("/(driver)/health");
          }}
        >
          <Card
            style={{
              borderLeftWidth: 4,
              borderLeftColor: palette.brand,
              boxShadow: "0 2px 10px rgba(15, 15, 15, 0.06)",
              gap: spacing.md * 0.9,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.lg * 0.9,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>Vehicle Health</Text>
              {loadingHealth ? (
                <ActivityIndicator size="small" color={palette.brand} />
              ) : health ? (
                <Badge
                  label={health.overall_status}
                  tone={
                    health.overall_status === "Good"
                      ? "success"
                      : health.overall_status === "Fair"
                      ? "warning"
                      : health.overall_status === "No data"
                      ? "neutral"
                      : "danger"
                  }
                  uppercase={false}
                />
              ) : null}
            </View>

            <View style={{ alignItems: "flex-start", paddingVertical: spacing.sm * 0.9 }}>
              <Text
                style={{
                  fontSize: 52,
                  fontWeight: "700",
                  color: !health || noData
                    ? palette.textMuted
                    : health.overall_health_pct >= 75
                      ? palette.success
                      : health.overall_health_pct >= 50
                      ? palette.warning
                      : palette.danger,
                  lineHeight: 52,
                }}
              >
                {!health || noData ? "—" : `${Math.round(health.overall_health_pct)}%`}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs * 0.9 }}
            >
              {!vehicleId ? (
                <HealthAlertPill text="Add a vehicle to track its health" danger={false} />
              ) : healthError ? (
                <HealthAlertPill text="Couldn't load vehicle health — tap to retry" />
              ) : loadingHealth || !health ? (
                <HealthAlertPill text="Loading vehicle health…" danger={false} />
              ) : noData ? (
                <HealthAlertPill text="No trips recorded yet — drive to assess" danger={false} />
              ) : alertComponents.length > 0 ? (
                alertComponents.map((k) => (
                  <HealthAlertPill
                    key={k}
                    text={`${k === "brake" ? "Brake Pads" : k === "engine" ? "Engine Oil" : k === "tire" ? "Tyres" : "Battery"}: ${rulToLabel(health.components[k])}`}
                  />
                ))
              ) : (
                <HealthAlertPill text="All components healthy" danger={false} />
              )}
            </ScrollView>
          </Card>
        </Pressable>

        {/* Trip recorder card */}
        <ObdSourceBadge />
        {/* Engine-state detection readout — dev builds only while the
            thresholds are still being validated against a real car. */}
        {__DEV__ && <EngineStateDebug />}
        <TripCard
          vehicleId={vehicleId}
          driverId={user?._id ?? ""}
          onNeedObd={() => setShowObd(true)}
        />

        <View style={{ gap: spacing.md }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Quick Actions</Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            {/* Quick actions = fast-path dispatch to the nearest provider of
                the relevant type. No diagnostic questions; we know what's
                needed. Routes through (emergency)/quick-dispatch which runs
                the full incident -> triage -> dispatch pipeline. */}
            <Animated.View entering={FadeInDown.delay(0).springify()} style={{ flex: 1 }}>
              <QuickAction
                icon="Disc"
                label="Tyre"
                onPress={() => router.push({
                  pathname: "/(emergency)/quick-dispatch",
                  params:   { intent: "FLAT_TIRE", label: "Flat tire" },
                })}
              />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(60).springify()} style={{ flex: 1 }}>
              <QuickAction
                icon="Fuel"
                label="Fuel"
                onPress={() => router.push({
                  pathname: "/(emergency)/quick-dispatch",
                  params:   { intent: "FUEL_EMPTY", label: "Fuel delivery" },
                })}
              />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(120).springify()} style={{ flex: 1 }}>
              <QuickAction
                icon="KeyRound"
                label="Locksmith"
                onPress={() => router.push({
                  pathname: "/(emergency)/quick-dispatch",
                  params:   { intent: "LOCKOUT", label: "Locksmith" },
                })}
              />
            </Animated.View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <Animated.View entering={FadeInDown.delay(180).springify()} style={{ flex: 1 }}>
              <QuickAction icon="Truck" label="Service" onPress={() => router.push("/(driver)/health")} />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(240).springify()} style={{ flex: 1 }}>
              {/* No component param — this is the store entrance, not a brake
                  alert, and pinning it to "brake" showed pads to a driver whose
                  brakes are fine. */}
              <QuickAction icon="Package" label="Order parts" onPress={() => router.push("/(driver)/order-parts")} />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(300).springify()} style={{ flex: 1 }}>
              <QuickAction
                icon="ShieldCheck"
                label="Insurance"
                badge={hasNoVehicles || incompleteUpload != null || missingInsuranceDetails || insuranceExpiringSoon}
                loading={checkingInsuranceStatus}
                onPress={() => {
                  void (async () => {
                    // No vehicle to attach a claim to at all — stop here, before any of the
                    // per-vehicle checks below (which would otherwise just no-op past a null
                    // selectedVehicle and fall through into a flow with nothing to work with).
                    if (hasNoVehicles) {
                      setNoVehicleReminderVisible(true);
                      return;
                    }
                    // Send the driver to complete missing details instead of letting them into
                    // a flow that can't call/identify an insurer yet.
                    if (missingInsuranceDetails && selectedVehicle) {
                      router.push({
                        pathname: "/(driver)/manage-vehicles",
                        params: { editVehicleId: selectedVehicle._id },
                      });
                      return;
                    }
                    // Warn about a lapsing policy before proceeding, rather than blocking —
                    // dismissing the popup continues into the normal flow below.
                    if (insuranceExpiringSoon) {
                      setRenewalReminderVisible(true);
                      return;
                    }
                    await proceedToInsuranceFlow();
                  })();
                }}
              />
            </Animated.View>
          </View>
        </View>

        <Pressable
          onPress={() => router.push("/(emergency)/safety-check")}
          style={({ pressed }) => ({
            opacity: pressed ? 0.92 : 1,
            borderRadius: radii.xl,
            borderCurve: "continuous",
            backgroundColor: palette.supportCoral,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.xl,
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            ...Platform.select({
              ios: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 8,
              },
              android: { elevation: 4 },
            }),
          })}
        >
          <Text style={{ ...typography.caption, color: palette.textOnBrand, opacity: 0.95 }}>
            Stuck on the road?
          </Text>
          <Text style={{ color: palette.textOnBrand, fontSize: 18, fontWeight: "700" }}>
            Get the Support
          </Text>
        </Pressable>
      </Screen>

      <BottomNavBar activeTab="home" />

      {/* Vehicle picker modal */}
      <Modal visible={showVehiclePicker} transparent animationType="slide">
        <Pressable
          style={{ flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" }}
          onPress={() => setShowVehiclePicker(false)}
        >
          <Pressable
            style={{
              backgroundColor: palette.surface,
              borderTopLeftRadius: 15,
              borderTopRightRadius: 15,
              paddingTop: spacing.lg,
              paddingHorizontal: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.md,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
                {user ? "Switch Vehicle" : "Your Vehicles"}
              </Text>
              <Pressable onPress={() => setShowVehiclePicker(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            {!user ? (
              <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
                <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
                  Sign in to manage multiple vehicles and sync your health data.
                </Text>
                <Pressable
                  onPress={() => { setShowVehiclePicker(false); router.push("/(driver)/auth"); }}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? palette.brandPressed : palette.brand,
                    borderRadius: radii.lg,
                    paddingVertical: spacing.md + 2,
                    alignItems: "center",
                  })}
                >
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    Sign In / Register
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {vehicles.map((v) => (
                  <Pressable
                    key={v._id}
                    onPress={() => {
                      if (selectedVehicle?._id === v._id) {
                        setShowVehiclePicker(false);
                        return;
                      }
                      setPendingVehicle(v);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.md,
                      padding: spacing.md,
                      borderRadius: radii.lg,
                      backgroundColor: pressed ? palette.homeBackground : palette.surface,
                      borderWidth: 1.5,
                      borderColor: selectedVehicle?._id === v._id ? palette.brand : palette.border,
                    })}
                  >
                    <Icon name="Car" size={20} color={selectedVehicle?._id === v._id ? palette.brand : palette.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                        {v.nickname || `${v.make} ${v.model}`}
                      </Text>
                      <Text style={{ ...typography.caption, color: palette.textMuted }}>
                        {v.plateNumber} · {v.fuelType}
                      </Text>
                    </View>
                    {selectedVehicle?._id === v._id && (
                      <Icon name="CheckCircle" size={18} color={palette.brand} />
                    )}
                  </Pressable>
                ))}

                <Pressable
                  onPress={() => { setShowVehiclePicker(false); router.push("/(driver)/manage-vehicles"); }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.md,
                    borderRadius: radii.lg,
                    borderWidth: 1.5,
                    borderColor: palette.brand,
                    backgroundColor: pressed ? palette.brandSoft : "transparent",
                  })}
                >
                  <Icon name="Settings" size={16} color={palette.brand} />
                  <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                    Manage Vehicles
                  </Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Switch Vehicle confirmation — same icon-circle popup style as the
          "Complete your insurance details" reminder on Manage Vehicles. */}
      <Modal visible={pendingVehicle != null} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.xl,
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: 15,
              padding: spacing.xl,
              gap: spacing.lg,
              width: "100%",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Car" size={32} color={palette.brand} />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                Switch Vehicle
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {pendingVehicle
                  ? `Switch to ${pendingVehicle.nickname || `${pendingVehicle.make} ${pendingVehicle.model}`} (${pendingVehicle.plateNumber})?`
                  : ""}
              </Text>
              {/* The recorder keeps the vehicle it started with, so say so
                  rather than letting the driver assume the switch moved it. */}
              {pendingVehicle && isTripActive() ? (
                <Text
                  style={{
                    ...typography.caption,
                    color: palette.warning,
                    textAlign: "center",
                  }}
                >
                  The trip in progress stays recorded against{" "}
                  {selectedVehicle?.plateNumber ?? "the current vehicle"}.
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: "row", gap: spacing.md, width: "100%" }}>
              <Pressable
                onPress={() => setPendingVehicle(null)}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md + 2,
                  alignItems: "center",
                  borderWidth: 1.5,
                  borderColor: palette.border,
                  backgroundColor: pressed ? palette.homeBackground : "transparent",
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  if (pendingVehicle) {
                    selectVehicle(pendingVehicle);
                  }
                  setPendingVehicle(null);
                  setShowVehiclePicker(false);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md + 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? palette.brandPressed : palette.brand,
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Switch</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Insurance renewal reminder — shown on tapping Insurance while the selected
          vehicle's policy is expiring soon (see insuranceExpiringSoon). Same icon-circle
          popup style as the other confirmations on this screen; "Got it" both closes this
          and continues into the normal Insurance flow, rather than requiring a second tap. */}
      <Modal visible={renewalReminderVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.xl,
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: 15,
              padding: spacing.xl,
              gap: spacing.lg,
              width: "100%",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="ShieldAlert" size={32} color={palette.brand} />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                Insurance needs renewal
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {vehicleInsurance?.insuranceExpireMonth
                  ? `Your policy expires ${vehicleInsurance.insuranceExpireMonth}. Renew it soon to stay covered.`
                  : "Your policy is expiring soon. Renew it to stay covered."}
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setRenewalReminderVisible(false);
                void proceedToInsuranceFlow();
              }}
              style={({ pressed }) => ({
                width: "100%",
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: "center",
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* No-vehicle reminder — shown on tapping Insurance with nothing on file at all (e.g.
          right after deleting the only vehicle). Same icon-circle popup style as the other
          Insurance reminders on this screen; "Add Vehicle" closes this and sends the driver
          straight to Manage Vehicles with the Add form already open. */}
      <Modal visible={noVehicleReminderVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.xl,
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: 15,
              padding: spacing.xl,
              gap: spacing.lg,
              width: "100%",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Car" size={32} color={palette.brand} />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                Add a vehicle first
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                You need at least one vehicle on file before you can use Insurance features.
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setNoVehicleReminderVisible(false);
                router.push({ pathname: "/(driver)/manage-vehicles", params: { addVehicle: "1" } });
              }}
              style={({ pressed }) => ({
                width: "100%",
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: "center",
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Add Vehicle</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* OBD-II connect modal */}
      <Modal visible={showObd} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.xxl,
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: 15,
              padding: spacing.xxl,
              width: "100%",
              gap: spacing.lg,
              alignItems: "center",
            }}
          >
            {/* Icon */}
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: pairResult
                  ? isRealPairResult ? palette.successSoft : palette.warningSoft
                  : palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={
                  pairResult
                    ? isRealPairResult ? "BluetoothConnected" : "FlaskConical"
                    : "Plug"
                }
                size={32}
                color={pairResult ? (isRealPairResult ? palette.success : palette.warning) : palette.brand}
              />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                {pairResult
                  ? isRealPairResult ? "Connected!" : "Using Simulated Data"
                  : "Connect OBD-II"}
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {pairResult
                  ? isRealPairResult
                    ? `Connected to ${pairResult.deviceName || "your ELM327 adapter"} (${pairResult.source === "ble" ? "BLE" : "classic Bluetooth"}). Trips will use live sensor data from your car.`
                    : "No physical adapter was reachable, so this session will use realistic simulated OBD-II data instead of your car's real sensors."
                  : pairingObd
                  ? "Scanning for your OBD-II adapter over Bluetooth…"
                  : "Pair an OBD-II adapter to let the app read live data from your vehicle and track its real health."}
              </Text>
              {/* In Expo Go / web the native Bluetooth module isn't loaded, so
                  pairing uses a realistic on-device simulation instead. */}
              {!pairResult && !isRealBleSupported() && !pairingObd && (
                <Text
                  style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}
                >
                  Bluetooth scanning needs a dev build — simulated telemetry will be used here.
                </Text>
              )}
            </View>

            {pairResult ? (
              <Pressable
                onPress={() => {
                  setShowObd(false);
                  setPairResult(null);
                }}
                style={({ pressed }) => ({
                  width: "100%",
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md + 2,
                  alignItems: "center",
                  backgroundColor: pressed ? palette.brandPressed : palette.brand,
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Continue</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", gap: spacing.md, width: "100%" }}>
                <Pressable
                  disabled={pairingObd}
                  onPress={() => {
                    // User chose not to connect a sensor — vehicle is "manual",
                    // triage will run at Tier-1 (questionnaire only).
                    setShowObd(false);
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: radii.lg,
                    paddingVertical: spacing.md + 2,
                    alignItems: "center",
                    borderWidth: 1.5,
                    borderColor: palette.border,
                    backgroundColor: pressed ? palette.homeBackground : "transparent",
                    opacity: pairingObd ? 0.5 : 1,
                  })}
                >
                  <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Skip</Text>
                </Pressable>

                <Pressable
                  disabled={pairingObd}
                  onPress={handlePairObd}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: radii.lg,
                    paddingVertical: spacing.md + 2,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.sm,
                    backgroundColor: pressed ? palette.brandPressed : palette.brand,
                    opacity: pairingObd ? 0.85 : 1,
                  })}
                >
                  {pairingObd && <ActivityIndicator size="small" color={palette.textOnBrand} />}
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    {pairingObd ? "Connecting…" : "Pair OBD-II"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <ClaimUploadReminderModal />
    </View>
  );
}

function HealthAlertPill({ text, danger = true }: { text: string; danger?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.pill,
        backgroundColor: danger ? palette.surfaceMuted : palette.successSoft,
        borderWidth: 1,
        borderColor: danger ? palette.border : palette.success + "33",
      }}
    >
      <Icon name={danger ? "AlertTriangle" : "CheckCircle"} size={16} color={danger ? palette.danger : palette.success} />
      <Text style={{ ...typography.caption, color: palette.text, fontWeight: "500" }}>{text}</Text>
    </View>
  );
}

function TripCard({
  vehicleId,
  driverId,
  onNeedObd,
}: {
  vehicleId: string;
  driverId: string;
  onNeedObd: () => void;
}) {
  const [tripActive, setTripActive] = useState(isTripActive());

  // The recorder is module state: a home instance further down the stack keeps
  // whatever value it mounted with, so re-read it every time this screen is shown.
  useFocusEffect(
    useCallback(() => {
      setTripActive(isTripActive());
    }, [])
  );

  function handlePress() {
    if (isTripActive()) {
      setTripActive(true);
      router.push("/(driver)/active-trip");
      return;
    }
    if (!isElm327Paired()) {
      onNeedObd();
      return;
    }
    if (!driverId) {
      // Submitting a trip needs a session, so stop before recording one rather
      // than failing at the end of the drive.
      router.push("/(driver)/auth");
      return;
    }
    if (!vehicleId) {
      // Without a plate the trip would be recorded, and later submitted, against
      // an empty vehicle id.
      router.push("/(driver)/manage-vehicles");
      return;
    }
    startTrip(vehicleId, driverId);
    setTripActive(true);
    router.push("/(driver)/active-trip");
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        padding: spacing.lg,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        borderWidth: 1.5,
        borderColor: tripActive ? palette.success : palette.brand,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radii.md,
          backgroundColor: tripActive ? palette.successSoft : palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={tripActive ? "Activity" : "Play"}
          size={20}
          color={tripActive ? palette.success : palette.brand}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          {tripActive ? "Trip in progress" : "Record a Trip"}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {tripActive
            ? "OBD & sensor data being collected — tap to view"
            : "Collect OBD + sensor data to update vehicle health"}
        </Text>
      </View>
      <Icon name="ChevronRight" size={18} color={palette.textMuted} />
    </Pressable>
  );
}
