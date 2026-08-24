import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { BottomNavBar } from "@components/ui/bottom-nav-bar";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { ObdSourceBadge } from "@components/ui/obd-source-badge";
import { QuickAction } from "@components/ui/quick-action";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  NO_DATA_HEALTH,
  getVehicleHealth,
  rulToLabel,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { isElm327Paired, isRealBleSupported, pairElm327Async, unpairElm327 } from "@lib/elm327";
import { useVehicle } from "@lib/vehicleContext";
import type { Vehicle } from "@lib/vehicleApi";
import { getVehicleInsurance, type VehicleInsurance } from "@lib/vehicleInsuranceApi";
import { useHardwareBack } from "@lib/useHardwareBack";
import { isTripActive } from "@lib/tripRecorder";
import { getCachedClaims, listMyClaims } from "@lib/claims-api";
import { loadDismissedClaimId } from "@lib/claim-upload-dedupe";
import { useIncompleteUploadStatus } from "@/features/report-accident/hooks/use-incomplete-upload-status";
import { ClaimUploadReminderModal } from "@/features/report-accident/components/claim-upload-reminder-modal";

const BOTTOM_SCROLL_PADDING = 112;

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const bottomReserve = BOTTOM_SCROLL_PADDING + insets.bottom;

  const { user, logout, selectedVehicle, vehicles, selectVehicle } = useVehicle();
  const incompleteUpload = useIncompleteUploadStatus();

  // Home is the post-auth root: block the Android back button so it can never
  // pop back to the welcome/login screen. The only way off home is Log out.
  useHardwareBack(useCallback(() => true, []));
  const [health, setHealth] = useState<VehicleHealthResponse>(NO_DATA_HEALTH);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [showObd, setShowObd] = useState(() => !isElm327Paired());
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  // Vehicle tapped in the picker, awaiting confirmation before actually switching.
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null);
  // True while the Insurance button's existing-claim check (a network call) is in
  // flight — shown as a spinner in place of the icon so the tap doesn't feel dead.
  const [checkingInsuranceStatus, setCheckingInsuranceStatus] = useState(false);
  // Real BLE pairing is async (scan + connect takes seconds). We show a
  // "Connecting…" state while it runs. pairElm327Async never rejects — it
  // falls back to the on-device simulation when no real dongle is reachable
  // (Expo Go, web, Bluetooth off, or nothing found) — so we don't need an
  // error branch here; we just close the modal once it settles.
  const [pairingObd, setPairingObd] = useState(false);
  // Set once pairElm327Async settles, so the modal can say exactly what
  // happened instead of just closing silently — the user has no other way to
  // know. `source: "none"` means no adapter was reachable; pairing no longer
  // falls back to simulated data, so that is now a real, reportable failure
  // rather than a silent downgrade.
  const [pairResult, setPairResult] = useState<{ source: "ble" | "classic" | "none"; deviceName?: string } | null>(null);
  const isRealPairResult = pairResult?.source === "ble" || pairResult?.source === "classic";

  const vehicleId = selectedVehicle?.plateNumber ?? "CBD-3742";
  const vehicleLabel = selectedVehicle
  ? (selectedVehicle.nickname || `${selectedVehicle.make} ${selectedVehicle.model}`)
  : "Toyota Aqua";

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

  // Licence/NIC live on the profile — all four are required before the Insurance
  // flow is usable for the selected vehicle.
  const missingInsuranceDetails = Boolean(
    selectedVehicle &&
      vehicleInsurance !== undefined &&
      (!vehicleInsurance?.insuranceProvider ||
        !vehicleInsurance?.insurancePolicyNumber ||
        !user?.licenceNumber ||
        !user?.nicNumber)
  );

  const handlePairObd = useCallback(async () => {
    setPairingObd(true);
    try {
      // Tries a real ELM327 dongle over BLE then classic Bluetooth. Returns
      // null when none is reachable — it no longer falls back to simulated
      // data, so a failure here is reported rather than hidden. A successful
      // pairing persists for the session, so later triage submissions read
      // live telemetry and run at Tier-2 on the dispatch backend.
      const info = await pairElm327Async(vehicleId);
      setPairResult(
        info
          ? { source: info.source as "ble" | "classic", deviceName: info.deviceName }
          : { source: "none" }
      );
    } finally {
      setPairingObd(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    setLoadingHealth(true);
    getVehicleHealth(vehicleId)
      .then(setHealth)
      .catch(() => setHealth(NO_DATA_HEALTH))
      .finally(() => setLoadingHealth(false));
  }, [vehicleId]);

  const alertComponents = (["brake", "engine", "tire", "battery"] as const).filter(
    (k) => {
      const s = health.components[k]?.status;
      // Only flag genuine wear (Fair/Poor/Critical). "No data" (no trips yet)
      // and a missing component are not alerts.
      return s != null && s !== "Good" && s !== "No data";
    }
  );
  const noData = health.overall_status === "No data";

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
            <Text style={{ ...typography.caption, color: palette.textMuted }}>Malabe, Srilanka</Text>
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
              {selectedVehicle?.plateNumber ?? vehicleId}
            </Text>
            <Icon name="ChevronDown" size={16} color={palette.brand} />
          </View>
        </Pressable>

        {/* Vehicle health card — taps through to health screen */}
        <Pressable onPress={() => router.push("/(driver)/health")}>
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
              ) : (
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
              )}
            </View>

            <View style={{ alignItems: "flex-start", paddingVertical: spacing.sm * 0.9 }}>
              <Text
                style={{
                  fontSize: 52,
                  fontWeight: "700",
                  color: noData
                    ? palette.textMuted
                    : health.overall_health_pct >= 75
                      ? palette.success
                      : health.overall_health_pct >= 50
                      ? palette.warning
                      : palette.danger,
                  lineHeight: 52,
                }}
              >
                {noData ? "—" : `${Math.round(health.overall_health_pct)}%`}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs * 0.9 }}
            >
              {noData ? (
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
        <TripCard
          onNeedsObd={() => {
            setPairResult(null);
            setShowObd(true);
          }}
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
              <QuickAction icon="Package" label="Order parts" onPress={() => router.push({ pathname: "/(driver)/order-parts", params: { component: "brake" } })} />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(300).springify()} style={{ flex: 1 }}>
              <QuickAction
                icon="ShieldCheck"
                label="Insurance"
                badge={incompleteUpload != null || missingInsuranceDetails}
                loading={checkingInsuranceStatus}
                onPress={() => {
                  void (async () => {
                    // Send the driver to complete missing details instead of letting them into
                    // a flow that can't call/identify an insurer yet.
                    if (missingInsuranceDetails && selectedVehicle) {
                      router.push({
                        pathname: "/(driver)/manage-vehicles",
                        params: { editVehicleId: selectedVehicle._id },
                      });
                      return;
                    }
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
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
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
              borderRadius: radii.xl,
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
              borderRadius: radii.xl,
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
                  ? isRealPairResult ? "Connected!" : "No Adapter Found"
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
                    : "No OBD-II adapter was reachable. Check that the adapter is plugged in, Bluetooth is on, and the adapter is paired in your phone's Bluetooth settings — then try again."
                  : pairingObd
                  ? "Scanning for your OBD-II adapter over Bluetooth…"
                  : "Pair an OBD-II adapter to let the app read live data from your vehicle and track its real health."}
              </Text>
              {/* In Expo Go / web the native Bluetooth module isn't loaded at
                  all, so pairing cannot succeed here by any route. Said plainly
                  rather than implying a simulated session will start — that is
                  no longer what happens. */}
              {!pairResult && !isRealBleSupported() && !pairingObd && (
                <Text
                  style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}
                >
                  Bluetooth needs a dev build — pairing is unavailable in Expo Go and on web.
                </Text>
              )}
            </View>

            {pairResult ? (
              <Pressable
                onPress={() => {
                  // A failed pair returns to the pair/skip buttons so the user
                  // can retry without reopening the modal; a successful one
                  // closes it. Sending "no adapter found" straight to Continue
                  // would read as though the failure had been accepted.
                  if (isRealPairResult) setShowObd(false);
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                  {isRealPairResult ? "Continue" : "Try Again"}
                </Text>
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

function TripCard({ onNeedsObd }: { onNeedsObd: () => void }) {
  const [tripActive, setTripActive] = useState(isTripActive());

  /**
   * VIEW ONLY. This card no longer starts anything.
   *
   * Trips begin when the ENGINE starts and end when it stops — that is the
   * whole point of the feature, and a button that also started one competed
   * with it. A hand-started trip has no engine-start behind it, so it has no
   * honest beginning: it would sit recording a parked car, and the readings it
   * collected would describe an idle engine while claiming to be a drive.
   *
   * So the card reports state and offers a way in to the live screen. Starting
   * is the engine's job.
   */
  function handlePress() {
    if (tripActive) {
      router.push("/(driver)/active-trip");
      return;
    }
    // Nothing to show yet. The one thing the driver can usefully DO about that
    // is connect the adapter, so offer exactly that.
    if (!isElm327Paired()) {
      onNeedsObd();
      return;
    }
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
          {tripActive ? "Trip in progress" : "Track Trip"}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {tripActive
            ? "Recording from your OBD-II adapter — tap to view"
            : isElm327Paired()
              ? "Starts by itself when you start the engine"
              : "Connect your OBD-II adapter to track trips"}
        </Text>
      </View>
      <Icon name="ChevronRight" size={18} color={palette.textMuted} />
    </Pressable>
  );
}
