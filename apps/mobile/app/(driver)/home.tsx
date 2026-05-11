import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Card } from "@components/ui/card";
import { Icon, type IconName } from "@components/ui/icon";
import { QuickAction } from "@components/ui/quick-action";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  FALLBACK_HEALTH,
  getVehicleHealth,
  rulToLabel,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { isElm327Paired, pairElm327, unpairElm327 } from "@lib/elm327";

const VEHICLE_ID = "CBD-3742";
const BOTTOM_SCROLL_PADDING = 112;

type TabDef = { key: string; label: string; icon: IconName };

const TABS_LEFT: TabDef[] = [
  { key: "home", label: "Home", icon: "House" },
  { key: "maintenance", label: "Maintenance", icon: "Wrench" },
];
const TABS_RIGHT: TabDef[] = [
  { key: "store", label: "Store", icon: "Store" },
  { key: "profile", label: "Profile", icon: "User" },
];

export default function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const bottomReserve = BOTTOM_SCROLL_PADDING + insets.bottom;

  const [health, setHealth] = useState<VehicleHealthResponse>(FALLBACK_HEALTH);
  const [loadingHealth, setLoadingHealth] = useState(true);
  // Show the OBD-pair modal only the first time per session AND only if we
  // haven't already paired (avoid nagging users who paired earlier).
  const [showObd, setShowObd] = useState(() => !isElm327Paired());

  useEffect(() => {
    getVehicleHealth(VEHICLE_ID)
      .then(setHealth)
      .catch(() => setHealth(FALLBACK_HEALTH))
      .finally(() => setLoadingHealth(false));
  }, []);

  const alertComponents = (["brake", "engine", "tire", "battery"] as const).filter(
    (k) => health.components[k].status !== "Good"
  );

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
              Hi <Text style={{ fontWeight: "700" }}>Janukshan!</Text>
            </Text>
          </View>

          {/* Log out — unpairs the ELM327 + drops the user back at the
              welcome screen. When JWT lands this is where we'd clear the
              stored token + cancel any Socket.IO subscriptions. */}
          <Pressable
            onPress={() => {
              unpairElm327();
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
        </View>

        <Pressable
          onPress={() => {
            if (process.env.EXPO_OS === "ios") {
              Haptics.selectionAsync().catch(() => {});
            }
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ flex: 1, ...typography.display, color: palette.text, fontSize: 28 }}>
            Toyota Aqua
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
              {VEHICLE_ID}
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
                  color:
                    health.overall_health_pct >= 75
                      ? palette.success
                      : health.overall_health_pct >= 50
                      ? palette.warning
                      : palette.danger,
                  lineHeight: 52,
                }}
              >
                {Math.round(health.overall_health_pct)}%
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs * 0.9 }}
            >
              {alertComponents.length > 0 ? (
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

        <View style={{ gap: spacing.md }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Quick Actions</Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            {/* Quick actions = fast-path dispatch to the nearest provider of
                the relevant type. No diagnostic questions; we know what's
                needed. Routes through (emergency)/quick-dispatch which runs
                the full incident -> triage -> dispatch pipeline. */}
            <QuickAction
              icon="Disc"
              label="Tyre"
              onPress={() => router.push({
                pathname: "/(emergency)/quick-dispatch",
                params:   { intent: "FLAT_TIRE", label: "Flat tire" },
              })}
            />
            <QuickAction
              icon="Fuel"
              label="Fuel"
              onPress={() => router.push({
                pathname: "/(emergency)/quick-dispatch",
                params:   { intent: "FUEL_EMPTY", label: "Fuel delivery" },
              })}
            />
            <QuickAction
              icon="KeyRound"
              label="Locksmith"
              onPress={() => router.push({
                pathname: "/(emergency)/quick-dispatch",
                params:   { intent: "LOCKOUT", label: "Locksmith" },
              })}
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction icon="Truck" label="Service" />
            <QuickAction icon="Package" label="Order parts" onPress={() => router.push({ pathname: "/(driver)/order-parts", params: { component: "brake" } })} />
            <QuickAction icon="ShieldCheck" label="Insurance" />
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

      <BottomNavBar />

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
                backgroundColor: palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Plug" size={32} color={palette.brand} />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                Connect OBD-II
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                To allow app to monitor your vehicle state you need to connect the OBD-II data
                with this app.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: spacing.md, width: "100%" }}>
              <Pressable
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
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Skip</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  // Simulate Bluetooth ELM327 pairing. Persists for the session
                  // so subsequent triage submissions read live OBD telemetry
                  // and run at Tier-2 (OBD-enhanced) on the dispatch backend.
                  pairElm327(VEHICLE_ID);
                  setShowObd(false);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md + 2,
                  alignItems: "center",
                  backgroundColor: pressed ? palette.brandPressed : palette.brand,
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                  Pair OBD-II
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

function BottomNavBar() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom,
        backgroundColor: palette.surface,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        ...Platform.select({
          ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 4 },
          android: { elevation: 12 },
        }),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.xs,
        }}
      >
        {TABS_LEFT.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={tab.key === "home"} />
        ))}
        <EmergencyCenterButton />
        {TABS_RIGHT.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={false} />
        ))}
      </View>
    </View>
  );
}

function EmergencyCenterButton() {
  return (
    <Pressable
      onPress={() => {
        if (process.env.EXPO_OS === "ios") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }
        router.push("/(emergency)/safety-check");
      }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.88 : 1,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: palette.brand,
        alignItems: "center",
        justifyContent: "center",
        marginTop: -28,
        ...Platform.select({
          ios: { shadowColor: palette.brand, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10 },
          android: { elevation: 6 },
        }),
      })}
    >
      <Icon name="Siren" size={26} color={palette.textOnBrand} />
    </Pressable>
  );
}

function TabItem({ tab, active }: { tab: TabDef; active: boolean }) {
  return (
    <Pressable
      onPress={() => {
        if (process.env.EXPO_OS === "ios") Haptics.selectionAsync().catch(() => {});
        if (tab.key === "maintenance") router.push("/(driver)/health");
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        gap: 2,
        minWidth: 62,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name={tab.icon} size={22} color={active ? palette.brand : palette.textMuted} />
      <Text
        style={{
          ...typography.micro,
          fontSize: 10,
          fontWeight: "600",
          color: active ? palette.brand : palette.textMuted,
          textAlign: "center",
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {tab.label}
      </Text>
    </Pressable>
  );
}
