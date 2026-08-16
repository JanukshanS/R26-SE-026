import { useEffect, useRef, useState } from "react";
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
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import type { Vehicle, VehicleInput } from "@lib/vehicleApi";
import { listInsuranceCompanies, type InsuranceCompany } from "@lib/insuranceCompaniesApi";
import { getVehicleInsurance, upsertVehicleInsurance } from "@lib/vehicleInsuranceApi";
import {
  getComponentLifespans,
  previewInstallKm,
  registerVehicleBaseline,
  type ComponentKey,
  type ComponentLifespans,
  type VehicleCondition,
} from "@lib/maintenanceApi";

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;

/**
 * Registering a used car walks through one component per screen. The engine is
 * absent on purpose: engines are not replaced on a schedule, so "km since it was
 * fitted" has no meaning for one. Engine condition is judged from how it runs,
 * and engine oil is tracked separately on its own interval.
 */
const BASELINE_STEPS = [
  { key: "tire" as ComponentKey, label: "Tyres", icon: "CircleDot" as const },
  { key: "brake" as ComponentKey, label: "Brakes", icon: "Disc" as const },
  { key: "battery" as ComponentKey, label: "Battery", icon: "BatteryCharging" as const },
];

const CONDITION_OPTIONS = [
  {
    value: "new" as VehicleCondition,
    title: "Brand new",
    blurb: "Bought new. Every part starts from zero.",
  },
  {
    value: "used" as VehicleCondition,
    title: "Used",
    blurb: "Already has kilometres on it. We will ask about each part next.",
  },
];

const STEP_DETAILS = 0;
const STEP_CONDITION = 1;
const STEP_FIRST_COMPONENT = 2;

/** What the driver said about one component while filling the form. */
type ComponentAnswer = { known: boolean; installKm: string };
const BLANK_ANSWERS: Record<string, ComponentAnswer> = {
  tire: { known: false, installKm: "" },
  brake: { known: false, installKm: "" },
  battery: { known: false, installKm: "" },
};

const EMPTY_FORM: Partial<VehicleInput> = {
  make: "", model: "", year: undefined, plateNumber: "",
  nickname: "", color: "", currentMileage: 0, fuelType: "petrol",
};

export default function ManageVehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { user, vehicles, vehiclesLoading, selectedVehicle, selectVehicle, addVehicle, editVehicle, removeVehicle, setDefault, updateMe, logout } = useVehicle();
  const { editVehicleId } = useLocalSearchParams<{ editVehicleId?: string }>();

  const [showForm, setShowForm] = useState(false);
  // Add flow only. Editing stays a single page - the registration answers below
  // are deliberately not editable afterwards.
  const [step, setStep] = useState(STEP_DETAILS);
  const [condition, setCondition] = useState<VehicleCondition>("used");
  const [answers, setAnswers] = useState<Record<string, ComponentAnswer>>(BLANK_ANSWERS);
  const [lifespans, setLifespans] = useState<ComponentLifespans | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<VehicleInput>>(EMPTY_FORM);
  // Licence/NIC are profile-level (one per driver, not per vehicle) — shown here for
  // convenience so a driver who skipped them during onboarding can complete them while
  // editing any vehicle, same as the insurance fields below.
  const [licenceNumber, setLicenceNumber] = useState("");
  const [nicNumber, setNicNumber] = useState("");
  // Insurance lives in its own table (vehicle_insurance), not on the vehicle row itself,
  // so it's fetched/saved separately from `form`.
  const [insuranceProvider, setInsuranceProvider] = useState("");
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [reminderVisible, setReminderVisible] = useState(false);
  const [missingLabels, setMissingLabels] = useState<string[]>([]);
  const [confirmSaveVisible, setConfirmSaveVisible] = useState(false);
  // Vehicle tapped in the list, awaiting confirmation before actually switching.
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null);
  const autoOpenedForId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listInsuranceCompanies()
      .then((list) => {
        if (!cancelled) setCompanies(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user) {
      setLicenceNumber(user.licenceNumber ?? "");
      setNicNumber(user.nicNumber ?? "");
    }
  }, [user]);

  // Arriving from Home's Insurance button with a specific vehicle missing required
  // details: auto-open that vehicle's edit form and explain what's missing.
  useEffect(() => {
    if (!editVehicleId || vehiclesLoading || autoOpenedForId.current === editVehicleId) return;
    const target = vehicles.find((v) => v._id === editVehicleId);
    if (!target) return;
    autoOpenedForId.current = editVehicleId;
    void (async () => {
      await openEdit(target);
      const insurance = await getVehicleInsurance(target._id).catch(() => null);
      const missing: string[] = [];
      if (!insurance?.insuranceProvider) missing.push("Your insurance provider");
      if (!insurance?.insurancePolicyNumber) missing.push("Your insurance policy number");
      if (!user?.licenceNumber) missing.push("Your Driving Licence Number");
      if (!user?.nicNumber) missing.push("NIC Number");
      if (missing.length > 0) {
        setMissingLabels(missing);
        setReminderVisible(true);
      }
    })();
  }, [editVehicleId, vehicles, vehiclesLoading, user]);

  useEffect(() => {
    // Powers the live estimate on the component screens. Null is fine: the
    // server still infers correctly, we just cannot preview the number.
    void getComponentLifespans().then(setLifespans);
  }, []);

  function openAdd() {
    setStep(STEP_DETAILS);
    setCondition("used");
    setAnswers(BLANK_ANSWERS);
    setEditingVehicle(null);
    setForm(EMPTY_FORM);
    setInsuranceProvider("");
    setInsurancePolicyNumber("");
    setError("");
    setShowForm(true);
  }

  async function openEdit(v: Vehicle) {
    setEditingVehicle(v);
    setForm({
      make: v.make, model: v.model, year: v.year,
      plateNumber: v.plateNumber, nickname: v.nickname ?? "",
      color: v.color ?? "", currentMileage: v.currentMileage,
      fuelType: v.fuelType,
    });
    setInsuranceProvider("");
    setInsurancePolicyNumber("");
    setError("");
    setShowForm(true);
    try {
      const insurance = await getVehicleInsurance(v._id);
      setInsuranceProvider(insurance?.insuranceProvider ?? "");
      setInsurancePolicyNumber(insurance?.insurancePolicyNumber ?? "");
    } catch {
      // best-effort — form still usable, just starts blank for these two fields
    }
  }

  const lastStep = condition === "used"
    ? STEP_FIRST_COMPONENT + BASELINE_STEPS.length - 1
    : STEP_CONDITION;
  const isLastStep = Boolean(editingVehicle) || step >= lastStep;

  /** km already on a part, for the live estimate shown while choosing. */
  function estimateFor(key: ComponentKey): { installKm: number; kmOnComponent: number } | null {
    const life = lifespans?.expected_life_km?.[key];
    const odo = Number(form.currentMileage) || 0;
    if (!life || odo <= 0) return null;
    return previewInstallKm(odo, life);
  }

  function handleNext() {
    if (step === STEP_DETAILS) {
      if (!form.make || !form.model || !form.plateNumber) {
        setError("Make, model and plate number are required.");
        return;
      }
      setError("");
    }
    setStep((n) => n + 1);
  }

  function handleSave() {
    if (!form.make || !form.model || !form.plateNumber) {
      setError("Make, model and plate number are required.");
      return;
    }
    // Only editing an existing vehicle's data needs confirmation — adding a
    // brand-new vehicle has nothing to overwrite, so it saves immediately.
    if (editingVehicle) {
      setConfirmSaveVisible(true);
      return;
    }
    void performSave();
  }

  async function performSave() {
    setSaving(true);
    setError("");
    try {
      let vehicleId: string;
      if (editingVehicle) {
        await editVehicle(editingVehicle._id, form);
        vehicleId = editingVehicle._id;
      } else {
        const vehicle = await addVehicle(form);
        vehicleId = vehicle._id;

        // Registration answers, keyed on the PLATE - that is what the
        // maintenance service uses as its vehicle id. Best-effort: the server
        // re-derives an estimate from the odometer at request time, so a failed
        // call costs the audit trail, not the health numbers. Recorded once and
        // never editable afterwards.
        const odometerKm = Number(form.currentMileage) || 0;
        const components = condition === "used"
          ? Object.fromEntries(
              BASELINE_STEPS.map(({ key }) => {
                const a = answers[key];
                const km = Number(a?.installKm);
                return [
                  key,
                  a?.known && Number.isFinite(km)
                    ? { known: true as const, installKm: km }
                    : { known: false as const },
                ];
              })
            )
          : undefined;
        void registerVehicleBaseline(vehicle.plateNumber, {
          odometerKm,
          condition,
          components,
        });
      }
      // Insurance and licence/NIC belong to the EDIT form only. Adding a
      // vehicle just registers the vehicle: a driver often has the plate to
      // hand long before the policy document. Writing them here regardless
      // created an empty vehicle_insurance row for every new vehicle and
      // re-saved the profile for no reason.
      if (editingVehicle) {
        await upsertVehicleInsurance(vehicleId, {
          insuranceProvider,
          insurancePolicyNumber,
        });
        await updateMe({ licenceNumber: licenceNumber.trim(), nicNumber: nicNumber.trim() });
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
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
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
              No vehicles yet. Tap &quot;Add&quot; to register your first vehicle.
            </Text>
          </View>
        ) : (
          vehicles.map((v) => (
            <VehicleCard
              key={v._id}
              vehicle={v}
              isSelected={selectedVehicle?._id === v._id}
              onSelect={() => {
                if (selectedVehicle?._id === v._id) {
                  router.back();
                  return;
                }
                setPendingVehicle(v);
              }}
              onEdit={() => void openEdit(v)}
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
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.h3, color: palette.text }}>
                  {editingVehicle
                    ? "Edit Vehicle"
                    : step === STEP_DETAILS
                      ? "Add Vehicle"
                      : step === STEP_CONDITION
                        ? "Vehicle condition"
                        : BASELINE_STEPS[step - STEP_FIRST_COMPONENT]?.label}
                </Text>
                {!editingVehicle && (
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>
                    Step {step + 1} of {lastStep + 1}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => setShowForm(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="X" size={22} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              <View style={{ gap: spacing.md }}>
                {(editingVehicle || step === STEP_DETAILS) && (
                <>
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

                {/* Insurance, licence and NIC are only offered when EDITING.
                    Registering a vehicle should not be blocked on paperwork the
                    driver may not have yet — they add it afterwards by tapping
                    the vehicle. Insurance lives in its own table, so the vehicle
                    row is complete without it. */}
                {editingVehicle ? (
                  <>
                {/* Insurance provider selector — per-vehicle, since a driver's
                    two cars can be insured with different providers/policies. */}
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>Insurance Provider</Text>
                  <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                    {companies.map(({ companyName: name }) => (
                      <Pressable
                        key={name}
                        onPress={() => setInsuranceProvider(name)}
                        style={{
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.sm,
                          borderRadius: radii.pill,
                          borderWidth: 1.5,
                          borderColor: insuranceProvider === name ? palette.brand : palette.border,
                          backgroundColor: insuranceProvider === name ? palette.brandSoft : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            ...typography.caption,
                            color: insuranceProvider === name ? palette.brand : palette.textMuted,
                            fontWeight: "600",
                          }}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Field
                  label="Insurance Policy Number"
                  value={insurancePolicyNumber}
                  onChangeText={setInsurancePolicyNumber}
                  placeholder="ALCI-254-VP"
                  autoCapitalize="characters"
                />
                {/* Profile-level (one per driver) — same value regardless of which
                    vehicle is being edited, kept here so it can be completed later
                    if it was skipped during onboarding. */}
                <Field
                  label="Your Driving Licence Number"
                  value={licenceNumber}
                  onChangeText={setLicenceNumber}
                  placeholder="B4818153"
                  autoCapitalize="characters"
                />
                <Field
                  label="NIC Number"
                  value={nicNumber}
                  onChangeText={setNicNumber}
                  placeholder="200221458936"
                />
                  </>
                ) : (
                  <View
                    style={{
                      flexDirection: "row",
                      gap: spacing.sm,
                      backgroundColor: palette.surfaceMuted,
                      borderRadius: radii.md,
                      padding: spacing.md,
                    }}
                  >
                    <Icon name="Info" size={16} color={palette.textMuted} />
                    <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                      Insurance and licence details are added separately — save the
                      vehicle first, then tap it to add them.
                    </Text>
                  </View>
                )}

                </>
                )}

                {/* ── Step 2: is this car new or used? ──────────────────────
                    Asked once, at registration, and never editable again: it is
                    a statement about the vehicle's history, and letting it move
                    later would let someone quietly rewrite their maintenance
                    position after the fact. */}
                {!editingVehicle && step === STEP_CONDITION && (
                  <View style={{ gap: spacing.md }}>
                    <Text style={{ ...typography.body, color: palette.text }}>
                      Is this a brand-new vehicle, or has it been driven before?
                    </Text>
                    {CONDITION_OPTIONS.map((opt) => {
                      const active = condition === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setCondition(opt.value)}
                          style={{
                            borderWidth: 1.5,
                            borderColor: active ? palette.brand : palette.border,
                            backgroundColor: active ? palette.brandSoft : palette.surface,
                            borderRadius: radii.lg,
                            padding: spacing.md,
                            gap: 2,
                          }}
                        >
                          <Text style={{ ...typography.bodyStrong, color: active ? palette.brand : palette.text }}>
                            {opt.title}
                          </Text>
                          <Text style={{ ...typography.caption, color: palette.textMuted }}>
                            {opt.blurb}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <Text style={{ ...typography.caption, color: palette.textMuted }}>
                      This cannot be changed later, so please make sure it is right.
                    </Text>
                  </View>
                )}

                {/* ── Steps 3+: one screen per part ─────────────────────── */}
                {!editingVehicle && step >= STEP_FIRST_COMPONENT && (() => {
                  const meta = BASELINE_STEPS[step - STEP_FIRST_COMPONENT];
                  if (!meta) return null;
                  const answer = answers[meta.key] ?? { known: false, installKm: "" };
                  const est = estimateFor(meta.key);
                  const setAnswer = (patch: Partial<ComponentAnswer>) =>
                    setAnswers((prev) => ({ ...prev, [meta.key]: { ...answer, ...patch } }));
                  return (
                    <View style={{ gap: spacing.md }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <Icon name={meta.icon} size={20} color={palette.brand} />
                        <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
                          When were the {meta.label.toLowerCase()} last replaced?
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => setAnswer({ known: false })}
                        style={{
                          borderWidth: 1.5,
                          borderColor: !answer.known ? palette.brand : palette.border,
                          backgroundColor: !answer.known ? palette.brandSoft : palette.surface,
                          borderRadius: radii.lg,
                          padding: spacing.md,
                          gap: 2,
                        }}
                      >
                        <Text style={{ ...typography.bodyStrong, color: !answer.known ? palette.brand : palette.text }}>
                          Not sure
                        </Text>
                        <Text style={{ ...typography.caption, color: palette.textMuted }}>
                          {est
                            ? `We will assume it was serviced on schedule — about ${Math.round(est.kmOnComponent).toLocaleString()} km on them now.`
                            : "We will estimate it from the odometer."}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => setAnswer({ known: true })}
                        style={{
                          borderWidth: 1.5,
                          borderColor: answer.known ? palette.brand : palette.border,
                          backgroundColor: answer.known ? palette.brandSoft : palette.surface,
                          borderRadius: radii.lg,
                          padding: spacing.md,
                          gap: spacing.xs,
                        }}
                      >
                        <Text style={{ ...typography.bodyStrong, color: answer.known ? palette.brand : palette.text }}>
                          I know when
                        </Text>
                        {answer.known ? (
                          <Field
                            label="Replaced at (km on the odometer)"
                            value={answer.installKm}
                            onChangeText={(t: string) => setAnswer({ installKm: t.replace(/[^0-9]/g, "") })}
                            placeholder={String(Math.max(Number(form.currentMileage) || 0, 0))}
                            keyboardType="numeric"
                          />
                        ) : (
                          <Text style={{ ...typography.caption, color: palette.textMuted }}>
                            Enter the odometer reading when it was fitted.
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  );
                })()}

                {error ? (
                  <Text style={{ ...typography.caption, color: palette.danger }}>{error}</Text>
                ) : null}
              </View>
            </ScrollView>

            {/* Back, on any step past the first of the add flow. */}
            {!editingVehicle && step > STEP_DETAILS && (
              <Pressable
                onPress={() => { setError(""); setStep((n) => Math.max(n - 1, STEP_DETAILS)); }}
                disabled={saving}
                style={{ paddingVertical: spacing.sm, alignItems: "center" }}
              >
                <Text style={{ ...typography.body, color: palette.textMuted }}>Back</Text>
              </Pressable>
            )}

            <Pressable
              onPress={isLastStep ? handleSave : handleNext}
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
                {editingVehicle ? "Save Changes" : isLastStep ? "Add Vehicle" : "Next"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Shown when redirected here from Home's Insurance button because required
          details were missing — names the specific fields still needed, in orange. */}
      <Modal visible={reminderVisible} transparent animationType="fade">
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
            {/* Same icon-circle treatment as the Connect OBD-II popup, for visual consistency. */}
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
                Complete your insurance details
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                Please fill in the following before you can use Insurance features for this
                vehicle:
              </Text>
            </View>

            <View style={{ gap: spacing.xs, alignSelf: "stretch" }}>
              {missingLabels.map((label) => (
                <Text
                  key={label}
                  style={{ ...typography.bodyStrong, color: palette.brand, textAlign: "center" }}
                >
                  {`• ${label}`}
                </Text>
              ))}
            </View>

            <Pressable
              onPress={() => setReminderVisible(false)}
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

      {/* Save Changes confirmation — same icon-circle popup style as the reminder above. */}
      <Modal visible={confirmSaveVisible} transparent animationType="fade">
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
                Save Changes
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                Save these changes to your vehicle details?
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: spacing.md, width: "100%" }}>
              <Pressable
                onPress={() => setConfirmSaveVisible(false)}
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
                  setConfirmSaveVisible(false);
                  void performSave();
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Switch Vehicle confirmation — tapping a vehicle card in this list, same
          icon-circle popup style as the other confirmations on this screen. */}
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
                  router.back();
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
