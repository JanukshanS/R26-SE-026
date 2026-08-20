import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { ErrorState } from "@components/ui/error-state";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getServiceHistory,
  getVehicleHealth,
  type ServiceRecord,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";

type FilterTab = "all" | "replacement" | "service" | "paint" | "system_fix";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all",         label: "All types" },
  { key: "replacement", label: "Replacements" },
  { key: "service",     label: "Service" },
  { key: "paint",       label: "Paint" },
  { key: "system_fix",  label: "System fixes" },
];

const SERVICE_TYPE_COLORS: Record<string, string> = {
  replacement:      palette.danger,
  initial_reading:  palette.warning,
  oil_change:       palette.brand,
  rotation:         palette.brand,
  inspection:       palette.textMuted,
  service:          "#6366F1",
  full_service:     "#6366F1",
  paint:            "#EC4899",
  system_fix:       "#14B8A6",
  new_implementation: "#8B5CF6",
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  replacement:       "Replacement",
  initial_reading:   "Initial Reading",
  oil_change:        "Oil Change",
  rotation:          "Rotation",
  inspection:        "Inspection",
  service:           "Service",
  full_service:      "Full Service",
  paint:             "Paint",
  system_fix:        "System Fix",
  new_implementation:"New Implementation",
};

function matchesTab(record: ServiceRecord, tab: FilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "replacement") return record.service_type === "replacement" || record.service_type === "initial_reading";
  if (tab === "service") return ["service", "full_service", "oil_change", "rotation", "inspection"].includes(record.service_type);
  return record.service_type === tab;
}

function kmToNextService(health: VehicleHealthResponse | null): number | null {
  if (!health) return null;
  const ruls = Object.values(health.components).map((c) => c.predicted_rul_km);
  if (!ruls.length) return null;
  return Math.round(Math.min(...ruls));
}

function alertComponents(health: VehicleHealthResponse | null): string[] {
  if (!health) return [];
  return Object.entries(health.components)
    .filter(([, c]) => c.status !== "Good")
    .map(([key]) => {
      const labels: Record<string, string> = { engine: "Engine", brake: "Brakes", tire: "Tyres", battery: "Battery" };
      return labels[key] ?? key;
    });
}

export default function ServiceRecordsScreen() {
  const insets = useSafeAreaInsets();
  const { selectedVehicle } = useVehicle();
  // No stand-in plate: reading — and, via the FAB, writing — another driver's
  // service history is worse than refusing until a vehicle is selected.
  const vehicleId = selectedVehicle?.plateNumber ?? "";
  const vehicleLabel = selectedVehicle
    ? selectedVehicle.nickname || `${selectedVehicle.make} ${selectedVehicle.model}`
    : "No vehicle selected";

  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [health, setHealth] = useState<VehicleHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  // Only the health call is allowed to fail quietly (the card falls back to "— KM").
  // A failed history call must not render as "no records yet".
  const load = useCallback(() => {
    setError("");
    if (!vehicleId) {
      setRecords([]);
      setHealth(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      getServiceHistory(vehicleId),
      getVehicleHealth(vehicleId).catch(() => null),
    ])
      .then(([recs, h]) => {
        setRecords(recs);
        setHealth(h);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "";
        setError(
          message.includes("signed in")
            ? message
            : "Could not reach the maintenance service. Check your connection and try again."
        );
      })
      .finally(() => setLoading(false));
  }, [vehicleId]);

  useEffect(load, [load]);

  const filtered = records.filter((r) => matchesTab(r, activeTab));
  const nextKm = kmToNextService(health);
  const alerts = alertComponents(health);

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      {/* Header */}
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
          gap: spacing.sm,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>Service Records</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{vehicleLabel}</Text>
        </View>
        {loading && <ActivityIndicator size="small" color={palette.brand} />}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + NAV_BAR_HEIGHT + 80,
        }}
      >
        {/* Next service card */}
        <View
          style={{
            backgroundColor: palette.success,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ ...typography.caption, color: "#FFFFFF", opacity: 0.85 }}>Next Service In</Text>
              {loading ? (
                <View style={{ height: 28, width: 100, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.3)", marginTop: 4 }} />
              ) : (
                <Text style={{ ...typography.h1, color: "#FFFFFF" }}>
                  {nextKm != null ? `${nextKm.toLocaleString()} KM` : "— KM"}
                </Text>
              )}
            </View>
            <View
              style={{
                width: 44, height: 44,
                borderRadius: radii.xl,
                backgroundColor: "rgba(255,255,255,0.2)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Wrench" size={22} color="#FFFFFF" />
            </View>
          </View>

          {alerts.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs }}>
              {alerts.map((label) => (
                <View
                  key={label}
                  style={{
                    backgroundColor: "rgba(255,255,255,0.2)",
                    borderRadius: radii.pill,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.xs,
                  }}
                >
                  <Icon name="AlertTriangle" size={12} color="#FFFFFF" />
                  <Text style={{ ...typography.micro, color: "#FFFFFF" }}>{label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
        >
          {FILTER_TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.pill,
                backgroundColor: activeTab === tab.key ? palette.brand : palette.surface,
                borderWidth: 1,
                borderColor: activeTab === tab.key ? palette.brand : palette.border,
              }}
            >
              <Text
                style={{
                  ...typography.caption,
                  color: activeTab === tab.key ? palette.textOnBrand : palette.textMuted,
                  fontWeight: "600",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Service logs section header */}
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Service logs</Text>

        {/* Records list */}
        {!vehicleId ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }}>
            <Icon name="Car" size={40} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              Select a vehicle first
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
              Service records are kept per vehicle.
            </Text>
            <Pressable
              onPress={() => router.push("/(driver)/manage-vehicles")}
              accessibilityRole="button"
              accessibilityLabel="Manage vehicles"
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                borderWidth: 1.5,
                borderColor: palette.brand,
                backgroundColor: pressed ? palette.brandSoft : "transparent",
              })}
            >
              <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
                Manage Vehicles
              </Text>
            </Pressable>
          </View>
        ) : loading ? (
          [0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                backgroundColor: palette.surface,
                borderRadius: radii.lg,
                padding: spacing.lg,
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: palette.border,
              }}
            >
              <View style={{ height: 16, width: "60%", borderRadius: 4, backgroundColor: palette.border, opacity: 0.5 }} />
              <View style={{ height: 13, width: "40%", borderRadius: 4, backgroundColor: palette.border, opacity: 0.35 }} />
            </View>
          ))
        ) : error ? (
          <ErrorState
            title="Couldn't load your service records"
            message={error}
            onRetry={load}
          />
        ) : filtered.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md }}>
            <Icon name="ClipboardList" size={40} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted }}>No service records yet</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
              Tap the + button to log your first service
            </Text>
          </View>
        ) : (
          filtered.map((record) => (
            <ServiceCard key={record.id} record={record} />
          ))
        )}
      </ScrollView>

      {/* FAB — hidden with no vehicle, since the form it opens would only refuse. */}
      {vehicleId ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add service record"
        onPress={() =>
          router.push({
            pathname: "/(driver)/add-service-record",
            params: { vehicleId },
          })
        }
        style={({ pressed }) => ({
          position: "absolute",
          right: spacing.xl,
          bottom: NAV_BAR_HEIGHT + insets.bottom + spacing.md,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.18,
          shadowRadius: 8,
          elevation: 6,
        })}
      >
        <Icon name="Plus" size={26} color={palette.textOnBrand} />
      </Pressable>
      ) : null}

      <BottomNavBar activeTab="maintenance" />
    </View>
  );
}

function ServiceCard({ record }: { record: ServiceRecord }) {
  const color = SERVICE_TYPE_COLORS[record.service_type] ?? palette.textMuted;
  const label = SERVICE_TYPE_LABELS[record.service_type] ?? record.service_type;
  const dateStr = new Date(record.service_date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: palette.border,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {record.item_name ?? COMPONENT_LABELS[record.component] ?? record.component}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{dateStr}</Text>
        </View>
        <View
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: 3,
            borderRadius: radii.pill,
            backgroundColor: `${color}18`,
          }}
        >
          <Text style={{ ...typography.micro, color }}>{label}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
        {record.garage_name ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="MapPin" size={12} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{record.garage_name}</Text>
          </View>
        ) : null}
        {record.cost_lkr != null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="Banknote" size={12} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              LKR {record.cost_lkr.toLocaleString()}
            </Text>
          </View>
        ) : null}
        {record.is_original ? (
          <View
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radii.pill,
              backgroundColor: record.is_original === "original" ? palette.successSoft : palette.warningSoft,
            }}
          >
            <Text
              style={{
                ...typography.micro,
                color: record.is_original === "original" ? palette.success : palette.warning,
              }}
            >
              {record.is_original}
            </Text>
          </View>
        ) : null}
      </View>

      {record.notes ? (
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{record.notes}</Text>
      ) : null}
    </View>
  );
}

const COMPONENT_LABELS: Record<string, string> = {
  engine:      "Engine",
  brake:       "Brake Pads",
  tire:        "Tyres",
  battery:     "Battery",
  full_service:"Full Service",
};
