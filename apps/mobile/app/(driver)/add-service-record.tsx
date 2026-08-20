import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { logService, type ServiceType } from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";

type ComponentKey = "engine" | "brake" | "tire" | "battery" | "full_service";

const COMPONENT_OPTIONS: { key: ComponentKey; label: string }[] = [
  { key: "engine",      label: "Engine" },
  { key: "brake",       label: "Brakes" },
  { key: "tire",        label: "Tyres" },
  { key: "battery",     label: "Battery" },
  { key: "full_service",label: "General / Other" },
];

interface ServiceTypeOption {
  value: ServiceType;
  label: string;
  color: string;
  resetsWindow: boolean;
}

const SERVICE_TYPE_OPTIONS: ServiceTypeOption[] = [
  { value: "replacement",       label: "Replacement",        color: palette.danger,   resetsWindow: true },
  { value: "service",           label: "Service",            color: "#6366F1",         resetsWindow: false },
  { value: "new_implementation",label: "New Implementation", color: "#8B5CF6",         resetsWindow: false },
  { value: "paint",             label: "Paint",              color: "#EC4899",         resetsWindow: false },
  { value: "system_fix",        label: "System Fix",         color: "#14B8A6",         resetsWindow: false },
  { value: "initial_reading",   label: "Initial Reading",    color: palette.warning,  resetsWindow: true },
  { value: "full_service",      label: "Full Service",       color: "#6366F1",         resetsWindow: false },
  { value: "inspection",        label: "Inspection",         color: palette.textMuted, resetsWindow: false },
];

export default function AddServiceRecordScreen() {
  const insets = useSafeAreaInsets();
  const { vehicleId: paramVehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const { selectedVehicle, vehiclesLoading } = useVehicle();
  // No fallback plate — writing a record against a vehicle the driver doesn't
  // own is worse than refusing the write. The param is only trustworthy when a
  // vehicle is actually selected, since callers derive it from the same source.
  const vehicleId = selectedVehicle ? (paramVehicleId ?? selectedVehicle.plateNumber) : null;

  const [saved, setSaved] = useState(false);

  // Form state
  const [component, setComponent] = useState<ComponentKey>("engine");
  const [serviceType, setServiceType] = useState<ServiceType>("replacement");
  const [itemName, setItemName] = useState("");
  const [isOriginal, setIsOriginal] = useState<"original" | "used" | null>(null);
  const [garageName, setGarageName] = useState("");
  const [costLkr, setCostLkr] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedTypeOption = SERVICE_TYPE_OPTIONS.find((o) => o.value === serviceType);
  const resetsWindow = selectedTypeOption?.resetsWindow ?? false;

  const handleSubmit = async () => {
    if (submitting || !vehicleId) return;
    if (!itemName.trim() && serviceType !== "full_service" && serviceType !== "inspection") {
      Alert.alert("Item name required", "Please enter what was serviced or replaced.");
      return;
    }
    // parseFloat("-") / parseFloat("..") is NaN, which serialises to null and
    // silently drops the cost the driver typed.
    const cost = Number.parseFloat(costLkr);
    setSubmitting(true);
    try {
      await logService(vehicleId, {
        component,
        service_type: serviceType,
        service_date: new Date().toISOString(),
        km_on_component: 0,
        item_name: itemName.trim() || undefined,
        is_original: isOriginal ?? undefined,
        garage_name: garageName.trim() || undefined,
        cost_lkr: Number.isFinite(cost) ? cost : undefined,
        notes: notes.trim() || undefined,
      });
      setSaved(true);
    } catch (err: any) {
      Alert.alert(
        "Couldn't save service record",
        `${err.message ?? "The maintenance service didn't respond."}\n\nYour details are still here — tap Save record to try again.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = () => {
    setItemName("");
    setIsOriginal(null);
    setGarageName("");
    setCostLkr("");
    setNotes("");
    setServiceType("replacement");
    setComponent("engine");
  };

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
        <Pressable
          onPress={() => (saved ? router.replace("/(driver)/service-records") : router.back())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Close" : "Go back"}
        >
          <Icon name={saved ? "X" : "ChevronLeft"} size={24} color={palette.text} />
        </Pressable>
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>Add Service Record</Text>
      </View>

      {!vehicleId ? (
        vehiclesLoading ? (
          <ActivityIndicator size="large" color={palette.brand} style={{ marginTop: 40 }} />
        ) : (
          <NoVehicle insets={insets} />
        )
      ) : saved ? (
        <Step3
          onBack={() => router.replace("/(driver)/service-records")}
          insets={insets}
        />
      ) : (
        <Step1
          component={component}
          setComponent={setComponent}
          serviceType={serviceType}
          setServiceType={setServiceType}
          itemName={itemName}
          setItemName={setItemName}
          isOriginal={isOriginal}
          setIsOriginal={setIsOriginal}
          garageName={garageName}
          setGarageName={setGarageName}
          costLkr={costLkr}
          setCostLkr={setCostLkr}
          notes={notes}
          setNotes={setNotes}
          resetsWindow={resetsWindow}
          submitting={submitting}
          onSubmit={handleSubmit}
          onClear={handleClear}
          insets={insets}
        />
      )}
    </View>
  );
}

// ─── No vehicle selected ──────────────────────────────────────────────────────

function NoVehicle({ insets }: { insets: { bottom: number } }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        paddingTop: 60,
        paddingHorizontal: spacing.lg,
        gap: spacing.md,
        paddingBottom: insets.bottom + spacing.xxxl,
      }}
    >
      <Icon name="Car" size={48} color={palette.border} />
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        Select a vehicle first. A service record has to be logged against one of your vehicles.
      </Text>
      <Pressable
        onPress={() => router.replace("/(driver)/manage-vehicles")}
        style={({ pressed }) => ({
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.xl,
          borderRadius: radii.lg,
          alignItems: "center",
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Choose a vehicle</Text>
      </Pressable>
    </View>
  );
}

// ─── Step 1: Service details ──────────────────────────────────────────────────

function Step1({
  component, setComponent,
  serviceType, setServiceType,
  itemName, setItemName,
  isOriginal, setIsOriginal,
  garageName, setGarageName,
  costLkr, setCostLkr,
  notes, setNotes,
  resetsWindow,
  submitting,
  onSubmit, onClear, insets,
}: {
  component: ComponentKey; setComponent: (c: ComponentKey) => void;
  serviceType: ServiceType; setServiceType: (t: ServiceType) => void;
  itemName: string; setItemName: (v: string) => void;
  isOriginal: "original" | "used" | null; setIsOriginal: (v: "original" | "used" | null) => void;
  garageName: string; setGarageName: (v: string) => void;
  costLkr: string; setCostLkr: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  resetsWindow: boolean;
  submitting: boolean;
  onSubmit: () => void; onClear: () => void;
  insets: { bottom: number };
}) {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.lg,
        paddingBottom: insets.bottom + 100,
      }}
    >
      {/* Warning banner */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.sm,
          backgroundColor: palette.warningSoft,
          borderRadius: radii.md,
          padding: spacing.md,
        }}
      >
        <Icon name="Info" size={16} color={palette.warning} />
        <Text style={{ ...typography.caption, color: palette.warning, flex: 1, fontWeight: "600" }}>
          Accurate details will ensure the vehicle life span prediction is correct.
        </Text>
      </View>

      {/* Component selector */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Component</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {COMPONENT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => setComponent(opt.key)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.pill,
                backgroundColor: component === opt.key ? palette.brand : palette.surface,
                borderWidth: 1.5,
                borderColor: component === opt.key ? palette.brand : palette.border,
              }}
            >
              <Text
                style={{
                  ...typography.caption,
                  fontWeight: "600",
                  color: component === opt.key ? palette.textOnBrand : palette.textMuted,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Service type pills */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Select Service Type</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {SERVICE_TYPE_OPTIONS.map((opt) => {
            const active = serviceType === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setServiceType(opt.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  backgroundColor: active ? opt.color : palette.surface,
                  borderWidth: 1.5,
                  borderColor: active ? opt.color : palette.border,
                }}
              >
                <Text
                  style={{
                    ...typography.caption,
                    fontWeight: "600",
                    color: active ? "#FFFFFF" : palette.textMuted,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {resetsWindow && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              backgroundColor: palette.dangerSoft,
              borderRadius: radii.sm,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
            }}
          >
            <Icon name="RefreshCw" size={12} color={palette.danger} />
            <Text style={{ ...typography.micro, color: palette.danger }}>
              This will reset the health prediction window for the selected component.
            </Text>
          </View>
        )}
      </View>

      {/* Item name */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Replaced / Serviced Item{" "}
          <Text style={{ color: palette.textMuted, fontWeight: "400" }}>(e.g. Brake Pads)</Text>
        </Text>
        <TextInput
          value={itemName}
          onChangeText={setItemName}
          placeholder="Enter item name"
          placeholderTextColor={palette.textMuted}
          style={{
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            color: palette.text,
            backgroundColor: palette.surface,
            ...typography.body,
          }}
        />
      </View>

      {/* Original / Used toggle */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Part Condition</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["original", "used"] as const).map((val) => (
            <Pressable
              key={val}
              onPress={() => setIsOriginal(isOriginal === val ? null : val)}
              style={{
                flex: 1,
                paddingVertical: spacing.md,
                borderRadius: radii.lg,
                alignItems: "center",
                backgroundColor: isOriginal === val ? palette.brand : palette.surface,
                borderWidth: 1.5,
                borderColor: isOriginal === val ? palette.brand : palette.border,
              }}
            >
              <Text
                style={{
                  ...typography.bodyStrong,
                  color: isOriginal === val ? palette.textOnBrand : palette.textMuted,
                  textTransform: "capitalize",
                }}
              >
                {val === "original" ? "Original OEM" : "Used / Non-OEM"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Garage name */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Garage / Workshop{" "}
          <Text style={{ color: palette.textMuted, fontWeight: "400" }}>(optional)</Text>
        </Text>
        <TextInput
          value={garageName}
          onChangeText={setGarageName}
          placeholder="e.g. City Auto Garage"
          placeholderTextColor={palette.textMuted}
          style={{
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            color: palette.text,
            backgroundColor: palette.surface,
            ...typography.body,
          }}
        />
      </View>

      {/* Cost */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Cost (LKR){" "}
          <Text style={{ color: palette.textMuted, fontWeight: "400" }}>(optional)</Text>
        </Text>
        <TextInput
          value={costLkr}
          onChangeText={setCostLkr}
          keyboardType="numeric"
          placeholder="e.g. 8400"
          placeholderTextColor={palette.textMuted}
          style={{
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            color: palette.text,
            backgroundColor: palette.surface,
            ...typography.body,
          }}
        />
      </View>

      {/* Notes */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Note{" "}
          <Text style={{ color: palette.textMuted, fontWeight: "400" }}>(optional)</Text>
        </Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional notes"
          placeholderTextColor={palette.textMuted}
          multiline
          numberOfLines={3}
          style={{
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            color: palette.text,
            backgroundColor: palette.surface,
            ...typography.body,
            minHeight: 80,
            textAlignVertical: "top",
          }}
        />
      </View>

      {/* Save / Clear buttons */}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Pressable
          onPress={onClear}
          disabled={submitting}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: spacing.md + 2,
            borderRadius: radii.lg,
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: palette.border,
            backgroundColor: pressed ? palette.homeBackground : "transparent",
          })}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Clear</Text>
        </Pressable>
        <Pressable
          onPress={onSubmit}
          disabled={submitting}
          style={({ pressed }) => ({
            flex: 2,
            paddingVertical: spacing.md + 2,
            borderRadius: radii.lg,
            alignItems: "center",
            backgroundColor: submitting ? palette.border : pressed ? palette.brandPressed : palette.brand,
            flexDirection: "row",
            justifyContent: "center",
            gap: spacing.sm,
          })}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={palette.textOnBrand} />
          ) : (
            <Icon name="CheckCircle" size={18} color={palette.textOnBrand} />
          )}
          <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
            {submitting ? "Saving…" : "Save record"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Step 3: Success ──────────────────────────────────────────────────────────

function Step3({ onBack, insets }: { onBack: () => void; insets: { bottom: number } }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xxxl,
        gap: spacing.xl,
        paddingBottom: insets.bottom + spacing.xxxl,
      }}
    >
      {/* Checkmark circle */}
      <View
        style={{
          width: 100,
          height: 100,
          borderRadius: 50,
          backgroundColor: palette.successSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="CheckCircle" size={52} color={palette.success} />
      </View>

      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
          Service Record added Successfully!
        </Text>
        <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
          The vehicle health prediction has been updated based on this service record.
        </Text>
      </View>

      <Pressable
        onPress={onBack}
        style={({ pressed }) => ({
          width: "100%",
          paddingVertical: spacing.md + 2,
          borderRadius: radii.lg,
          alignItems: "center",
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Back to main page</Text>
      </Pressable>
    </View>
  );
}
