import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import type { VehicleInput } from "@lib/vehicleApi";
import type { Vehicle } from "@lib/vehicleApi";

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;

const EMPTY_FORM: Partial<VehicleInput> = {
  make: "", model: "", year: undefined, plateNumber: "",
  nickname: "", color: "", currentMileage: 0, fuelType: "petrol",
};

export default function ManageVehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { user, vehicles, vehiclesLoading, selectedVehicle, selectVehicle, addVehicle, editVehicle, removeVehicle, setDefault, logout } = useVehicle();

  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<VehicleInput>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openAdd() {
    setEditingVehicle(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(v: Vehicle) {
    setEditingVehicle(v);
    setForm({
      make: v.make, model: v.model, year: v.year,
      plateNumber: v.plateNumber, nickname: v.nickname ?? "",
      color: v.color ?? "", currentMileage: v.currentMileage,
      fuelType: v.fuelType,
    });
    setError("");
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.make || !form.model || !form.plateNumber) {
      setError("Make, model and plate number are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingVehicle) {
        await editVehicle(editingVehicle._id, form);
      } else {
        await addVehicle(form);
      }
      setShowForm(false);
    } catch (err: any) {
      setError(err.message ?? "Failed to save vehicle");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(v: Vehicle) {
    Alert.alert(
      "Delete Vehicle",
      `Remove ${v.nickname || `${v.make} ${v.model}`} (${v.plateNumber})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => removeVehicle(v._id),
        },
      ]
    );
  }

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
          gap: spacing.md,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>My Vehicles</Text>
          {user && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{user.name}</Text>
          )}
        </View>
        <Pressable
          onPress={openAdd}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.brandPressed : palette.brand,
          })}
        >
          <Icon name="Plus" size={16} color={palette.textOnBrand} />
          <Text style={{ ...typography.caption, color: palette.textOnBrand, fontWeight: "700" }}>
            Add
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {vehiclesLoading ? (
          <ActivityIndicator size="large" color={palette.brand} style={{ marginTop: 40 }} />
        ) : vehicles.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="Car" size={48} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              No vehicles yet. Tap "Add" to register your first vehicle.
            </Text>
          </View>
        ) : (
          vehicles.map((v) => (
            <VehicleCard
              key={v._id}
              vehicle={v}
              isSelected={selectedVehicle?._id === v._id}
              onSelect={() => { selectVehicle(v); router.back(); }}
              onEdit={() => openEdit(v)}
              onDelete={() => confirmDelete(v)}
              onSetDefault={() => setDefault(v._id)}
            />
          ))
        )}
      </ScrollView>

      {/* Logout button */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + spacing.md,
          paddingTop: spacing.md,
          paddingHorizontal: spacing.lg,
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        }}
      >
        <Pressable
          onPress={() => { logout(); router.back(); }}
          style={({ pressed }) => ({
            borderRadius: radii.lg,
            paddingVertical: spacing.md,
            alignItems: "center",
            borderWidth: 1.5,
            borderColor: palette.danger,
            backgroundColor: pressed ? palette.dangerSoft : "transparent",
          })}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.danger }}>Log Out</Text>
        </Pressable>
      </View>

      {/* Add / Edit modal */}
      <Modal visible={showForm} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            justifyContent: "flex-end",
          }}
        >
          <View
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
            {/* Modal header */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
                {editingVehicle ? "Edit Vehicle" : "Add Vehicle"}
              </Text>
              <Pressable onPress={() => setShowForm(false)} hitSlop={12}>
                <Icon name="X" size={22} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              <View style={{ gap: spacing.md }}>
                <Row>
                  <Field label="Make *" value={form.make ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, make: v }))} placeholder="Toyota" />
                  <Field label="Model *" value={form.model ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, model: v }))} placeholder="Aqua" />
                </Row>
                <Row>
                  <Field label="Plate Number *" value={form.plateNumber ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, plateNumber: v.toUpperCase() }))} placeholder="CBD-3742" autoCapitalize="characters" />
                  <Field label="Year" value={form.year?.toString() ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, year: v ? parseInt(v) : undefined }))} placeholder="2022" keyboardType="numeric" />
                </Row>
                <Field label="Nickname" value={form.nickname ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, nickname: v }))} placeholder="My Toyota (optional)" />
                <Row>
                  <Field label="Color" value={form.color ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, color: v }))} placeholder="Silver" />
                  <Field label="Mileage (km)" value={form.currentMileage?.toString() ?? "0"} onChangeText={(v) => setForm((f) => ({ ...f, currentMileage: parseInt(v) || 0 }))} keyboardType="numeric" placeholder="0" />
                </Row>

                {/* Fuel type selector */}
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>Fuel Type</Text>
                  <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                    {FUEL_TYPES.map((ft) => (
                      <Pressable
                        key={ft}
                        onPress={() => setForm((f) => ({ ...f, fuelType: ft }))}
                        style={{
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.sm,
                          borderRadius: radii.pill,
                          borderWidth: 1.5,
                          borderColor: form.fuelType === ft ? palette.brand : palette.border,
                          backgroundColor: form.fuelType === ft ? palette.brandSoft : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            ...typography.caption,
                            color: form.fuelType === ft ? palette.brand : palette.textMuted,
                            fontWeight: "600",
                            textTransform: "capitalize",
                          }}
                        >
                          {ft}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {error ? (
                  <Text style={{ ...typography.caption, color: palette.danger }}>{error}</Text>
                ) : null}
              </View>
            </ScrollView>

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => ({
                backgroundColor: saving ? palette.textMuted : pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: spacing.sm,
              })}
            >
              {saving && <ActivityIndicator size="small" color={palette.textOnBrand} />}
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                {editingVehicle ? "Save Changes" : "Add Vehicle"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function VehicleCard({
  vehicle: v, isSelected, onSelect, onEdit, onDelete, onSetDefault,
}: {
  vehicle: Vehicle;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        borderWidth: 2,
        borderColor: isSelected ? palette.brand : palette.border,
        padding: spacing.lg,
        gap: spacing.sm,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radii.md,
            backgroundColor: isSelected ? palette.brandSoft : palette.homeBackground,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="Car" size={22} color={isSelected ? palette.brand : palette.textMuted} />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              {v.nickname || `${v.make} ${v.model}`}
            </Text>
            {v.isDefault && (
              <View
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                  borderRadius: radii.pill,
                  backgroundColor: palette.brandSoft,
                }}
              >
                <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "700" }}>
                  DEFAULT
                </Text>
              </View>
            )}
            {isSelected && (
              <Icon name="CheckCircle" size={16} color={palette.brand} />
            )}
          </View>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {v.make} {v.model} {v.year ? `· ${v.year}` : ""}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 }}>
            <View
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
                borderRadius: radii.sm,
                backgroundColor: palette.homeBackground,
              }}
            >
              <Text style={{ ...typography.micro, color: palette.text, fontWeight: "600" }}>
                {v.plateNumber}
              </Text>
            </View>
            <Text style={{ ...typography.micro, color: palette.textMuted, textTransform: "capitalize" }}>
              {v.fuelType}
            </Text>
            {v.color ? (
              <Text style={{ ...typography.micro, color: palette.textMuted }}>{v.color}</Text>
            ) : null}
          </View>
          {v.currentMileage > 0 && (
            <Text style={{ ...typography.micro, color: palette.textMuted }}>
              {v.currentMileage.toLocaleString()} km
            </Text>
          )}
        </View>
      </View>

      {/* Actions */}
      <View
        style={{
          flexDirection: "row",
          gap: spacing.sm,
          paddingTop: spacing.sm,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        }}
      >
        {!v.isDefault && (
          <Pressable
            onPress={onSetDefault}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: spacing.sm,
              alignItems: "center",
              borderRadius: radii.md,
              backgroundColor: pressed ? palette.brandSoft : "transparent",
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              Set Default
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onEdit}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: spacing.sm,
            alignItems: "center",
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.homeBackground : "transparent",
            borderWidth: 1,
            borderColor: palette.border,
          })}
        >
          <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: spacing.sm,
            alignItems: "center",
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.dangerSoft : "transparent",
            borderWidth: 1,
            borderColor: palette.border,
          })}
        >
          <Text style={{ ...typography.caption, color: palette.danger, fontWeight: "600" }}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: spacing.sm }}>{children}</View>;
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  autoCapitalize?: "none" | "characters" | "words";
}) {
  return (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        placeholderTextColor={palette.textMuted}
        style={{
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
          ...typography.body,
          color: palette.text,
          backgroundColor: palette.surface,
        }}
      />
    </View>
  );
}
