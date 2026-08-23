import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { unpairElm327 } from "@lib/elm327";
import { endTrip, isTripActive } from "@lib/tripRecorder";
import { VehicleApiError, type Vehicle, type VehicleInput } from "@lib/vehicleApi";
import { listInsuranceCompanies, type InsuranceCompany } from "@lib/insuranceCompaniesApi";
import { getVehicleInsurance, upsertVehicleInsurance } from "@lib/vehicleInsuranceApi";
import { normalizePlate, plateError } from "@lib/plate-number";
import {
  formatExpireMonth,
  formatLicenceNumber,
  formatNicNumber,
  isValidExpireMonth,
  isValidLicenceNumber,
  isValidNicNumber,
} from "@lib/insurer-field-format";

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;

const EMPTY_FORM: Partial<VehicleInput> = {
  make: "", model: "", year: undefined, plateNumber: "",
  nickname: "", color: "", currentMileage: 0, fuelType: "petrol",
};

export default function ManageVehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { user, vehicles, vehiclesLoading, vehicleError, refreshVehicles, selectedVehicle, selectVehicle, addVehicle, editVehicle, removeVehicle, setDefault, updateMe, logout } = useVehicle();
  // "addVehicle" param renamed on destructure — the context already exposes an
  // `addVehicle` function above, and the two would otherwise collide.
  const { editVehicleId, addVehicle: autoOpenAddParam } = useLocalSearchParams<{
    editVehicleId?: string;
    addVehicle?: string;
  }>();
  const autoOpenedAdd = useRef(false);

  const [showForm, setShowForm] = useState(false);
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
  const [insuranceExpireMonth, setInsuranceExpireMonth] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [policyError, setPolicyError] = useState("");
  const [licenceError, setLicenceError] = useState("");
  const [nicError, setNicError] = useState("");
  const [expireMonthError, setExpireMonthError] = useState("");
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [reminderVisible, setReminderVisible] = useState(false);
  const [missingLabels, setMissingLabels] = useState<string[]>([]);
  const [confirmSaveVisible, setConfirmSaveVisible] = useState(false);
  // Vehicle tapped in the list, awaiting confirmation before actually switching.
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null);
  // Vehicle's Delete button tapped, awaiting confirmation before actually deleting.
  const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState<Vehicle | null>(null);
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
      if (!insurance?.insuranceExpireMonth) missing.push("Your insurance expiry date");
      if (!user?.licenceNumber) missing.push("Your Driving Licence Number");
      if (!user?.nicNumber) missing.push("NIC Number");
      if (missing.length > 0) {
        setMissingLabels(missing);
        setReminderVisible(true);
      }
    })();
  }, [editVehicleId, vehicles, vehiclesLoading, user]);

  // Arriving from Home's Insurance button with no vehicle on file at all: auto-open
  // the Add Vehicle form so there's nothing extra to tap first.
  useEffect(() => {
    if (autoOpenAddParam !== "1" || autoOpenedAdd.current) return;
    autoOpenedAdd.current = true;
    openAdd();
  }, [autoOpenAddParam]);

  function clearFieldErrors() {
    setError("");
    setPolicyError("");
    setLicenceError("");
    setNicError("");
    setExpireMonthError("");
  }

  function openAdd() {
    setEditingVehicle(null);
    setForm(EMPTY_FORM);
    setInsuranceProvider("");
    setInsurancePolicyNumber("");
    setInsuranceExpireMonth("");
    clearFieldErrors();
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
    setInsuranceExpireMonth("");
    clearFieldErrors();
    setShowForm(true);
    try {
      const insurance = await getVehicleInsurance(v._id);
      setInsuranceProvider(insurance?.insuranceProvider ?? "");
      setInsurancePolicyNumber(insurance?.insurancePolicyNumber ?? "");
      setInsuranceExpireMonth(insurance?.insuranceExpireMonth ?? "");
    } catch {
      // best-effort — form still usable, just starts blank for these fields
    }
  }

  function handleSave() {
    if (!form.make || !form.model || !form.plateNumber) {
      setError("Make, model and plate number are required.");
      return;
    }
    const plateProblem = plateError(form.plateNumber ?? "");
    if (plateProblem) {
      setError(plateProblem);
      return;
    }
    // Policy Number/Expiry Month are disabled in the form until a provider is picked, so
    // this shouldn't be reachable in practice — kept as a safety net regardless.
    if (!insuranceProvider && (insurancePolicyNumber.trim() || insuranceExpireMonth.trim())) {
      setError("Select an insurance provider before adding a policy number or expiry date.");
      return;
    }
    // Licence/NIC/Policy Number stay optional — only enforce the format once something's
    // actually been typed, same convention as the Add your Insurer onboarding screen.
    const nextLicenceError =
      licenceNumber.trim() && !isValidLicenceNumber(licenceNumber.trim())
        ? "Must be 1 letter followed by 7 digits (e.g. B4818153)."
        : "";
    const nextNicError =
      nicNumber.trim() && !isValidNicNumber(nicNumber.trim())
        ? "Must be 12 digits, or 9 digits followed by V (e.g. 200221458V)."
        : "";
    const nextExpireMonthError =
      insuranceExpireMonth.trim() && !isValidExpireMonth(insuranceExpireMonth.trim())
        ? "Must be a valid future month in YY/MM format (e.g. 26/09)."
        : "";
    setLicenceError(nextLicenceError);
    setNicError(nextNicError);
    setExpireMonthError(nextExpireMonthError);
    if (nextLicenceError || nextNicError || nextExpireMonthError) {
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
    setPolicyError("");
    try {
      let vehicleId: string;
      if (editingVehicle) {
        await editVehicle(editingVehicle._id, { ...form, plateNumber: normalizePlate(form.plateNumber ?? "") });
        vehicleId = editingVehicle._id;
      } else {
        const vehicle = await addVehicle({ ...form, plateNumber: normalizePlate(form.plateNumber ?? "") });
        vehicleId = vehicle._id;
      }
      await upsertVehicleInsurance(vehicleId, {
        insuranceProvider,
        insurancePolicyNumber,
        insuranceExpireMonth,
      });
    } catch (err: any) {
      // 23505 = Postgres unique-violation — same handling as Add your Insurer, since
      // these fields share the exact same DB constraints. Only policy_number can
      // violate here; licence/NIC belong to the profile write below.
      if (err instanceof VehicleApiError && err.code === "23505") {
        if (err.message.includes("policy_number")) {
          setPolicyError("This Policy Number is already registered to another vehicle.");
        } else {
          setError("One of the details you entered is already registered elsewhere.");
        }
      } else {
        setError(err.message ?? "Failed to save vehicle. Check your connection and try again.");
      }
      setSaving(false);
      return;
    }
    // The vehicle write already went through, so the form is closed before the
    // profile write below: leaving it open on a licence/NIC failure invites a
    // second tap of "Add Vehicle" and a duplicate car (vehicles has no unique
    // plate constraint to catch the retry).
    setShowForm(false);
    try {
      await updateMe({ licenceNumber: licenceNumber.trim(), nicNumber: nicNumber.trim() });
    } catch (err: any) {
      const duplicate =
        err instanceof VehicleApiError && err.code === "23505"
          ? err.message.includes("nic_number")
            ? "This NIC Number is already registered to another account."
            : "This Driving Licence Number is already registered to another account."
          : null;
      Alert.alert(
        "Licence and NIC not saved",
        `${duplicate ?? err.message ?? "The server didn't respond."}\n\nYour vehicle was saved. Tap Edit on it to enter them again.`
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(v: Vehicle) {
    setPendingDeleteVehicle(v);
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
        ) : vehicleError && vehicles.length === 0 ? (
          /* Without this the failed fetch looks like an empty garage, and the
             driver re-registers a car they already have. */
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="TriangleAlert" size={48} color={palette.danger} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              Couldn&apos;t load your vehicles. {vehicleError}
            </Text>
            <Pressable
              onPress={() => { void refreshVehicles(); }}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.brandSoft : "transparent",
              })}
            >
              <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
                Try again
              </Text>
            </Pressable>
          </View>
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
          onPress={async () => {
            // Same teardown as Home: a recording left running would keep sampling
            // under the previous driver's id, and router.back() would drop the
            // signed-out user back inside the authenticated stack.
            if (isTripActive()) await endTrip().catch(() => {});
            unpairElm327();
            await logout();
            router.replace("/");
          }}
          accessibilityRole="button"
          accessibilityLabel="Log out"
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
      {/* statusBarTranslucent + KeyboardAvoidingView: an Android Modal is its own
          window and does not inherit the activity's adjustResize, so without this
          the keyboard covers the lower half of the form - including the submit
          button - with no way to scroll to it. */}
      <Modal
        visible={showForm}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setShowForm(false)}
      >
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1,
            backgroundColor: palette.overlay,
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderTopLeftRadius: 15,
              borderTopRightRadius: 15,
              paddingTop: spacing.lg,
              paddingHorizontal: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.md,
              // Never taller than the sheet's own window; the ScrollView inside
              // takes the remaining space rather than a hardcoded 440px.
              maxHeight: "92%",
            }}
          >
            {/* Modal header */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
                {editingVehicle ? "Edit Vehicle" : "Add Vehicle"}
              </Text>
              <Pressable onPress={() => setShowForm(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="X" size={22} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

                {/* Insurance provider selector — per-vehicle, since a driver's two cars
                    can be insured with different providers/policies. Same bottom-sheet
                    dropdown pattern as the Add your Insurer onboarding screen, rather
                    than an inline pill list, for consistency. */}
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>Insurance Provider</Text>
                  <Pressable
                    style={{
                      backgroundColor: palette.surface,
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette.border,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    onPress={() => setShowProviderPicker(true)}
                  >
                    <Text style={{ color: palette.text, ...typography.body }}>
                      {insuranceProvider || "Select your insurance provider"}
                    </Text>
                    <Icon name="ChevronDown" size={18} color={palette.textMuted} />
                  </Pressable>
                </View>
                <TextField
                  label="Insurance Policy Number"
                  value={insurancePolicyNumber}
                  onChangeText={(t) => {
                    setInsurancePolicyNumber(t);
                    setPolicyError("");
                  }}
                  placeholder="ALCI-254-VP"
                  autoCapitalize="characters"
                  editable={Boolean(insuranceProvider)}
                  error={policyError}
                  helperText={insuranceProvider ? undefined : "Select an insurance provider first."}
                />
                {/* Profile-level (one per driver) — same value regardless of which
                    vehicle is being edited, kept here so it can be completed later
                    if it was skipped during onboarding. Same format/validation as the
                    Add your Insurer onboarding screen (lib/insurer-field-format.ts). */}
                <TextField
                  label="Your Driving Licence Number"
                  value={licenceNumber}
                  onChangeText={(t) => {
                    setLicenceNumber(formatLicenceNumber(t));
                    setLicenceError("");
                  }}
                  placeholder="B4818153"
                  autoCapitalize="characters"
                  maxLength={8}
                  error={licenceError}
                />
                <TextField
                  label="NIC Number"
                  value={nicNumber}
                  onChangeText={(t) => {
                    setNicNumber(formatNicNumber(t));
                    setNicError("");
                  }}
                  placeholder="200221458936"
                  keyboardType="numbers-and-punctuation"
                  maxLength={12}
                  error={nicError}
                />
                <TextField
                  label="Insurance Expiry Month"
                  value={insuranceExpireMonth}
                  onChangeText={(t) => {
                    setInsuranceExpireMonth(formatExpireMonth(t));
                    setExpireMonthError("");
                  }}
                  placeholder="YY/MM"
                  keyboardType="number-pad"
                  maxLength={5}
                  editable={Boolean(insuranceProvider)}
                  error={expireMonthError}
                  helperText={insuranceProvider ? undefined : "Select an insurance provider first."}
                />

              </View>
            </ScrollView>

            {/* Sits with the submit button, not at the end of the scroll area.
                Down there a failed validation rendered off-screen, so tapping
                Save looked like it simply did nothing. */}
            {error ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: radii.md,
                  backgroundColor: palette.dangerSoft,
                }}
              >
                <Icon name="AlertCircle" size={14} color={palette.danger} />
                <Text style={{ ...typography.caption, color: palette.danger, flex: 1 }}>
                  {error}
                </Text>
              </View>
            ) : null}

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
        </KeyboardAvoidingView>
      </Modal>

      {/* Insurance provider picker — same bottom-sheet pattern as Add your Insurer. */}
      <Modal visible={showProviderPicker} transparent animationType="slide">
        <Pressable
          style={{ flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" }}
          onPress={() => setShowProviderPicker(false)}
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
              maxHeight: "70%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
                Select Insurance Provider
              </Text>
              <Pressable
                onPress={() => setShowProviderPicker(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            {companies.length === 0 ? (
              <View style={{ paddingVertical: spacing.xxl, alignItems: "center" }}>
                <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
                  Could not load insurance providers. Check your connection and try again.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ gap: spacing.sm }}>
                  {companies.map(({ companyName: name }) => (
                    <Pressable
                      key={name}
                      onPress={() => {
                        setInsuranceProvider(name);
                        setShowProviderPicker(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.md,
                        padding: spacing.md,
                        borderRadius: radii.lg,
                        backgroundColor: pressed ? palette.homeBackground : palette.surface,
                        borderWidth: 1.5,
                        borderColor: insuranceProvider === name ? palette.brand : palette.border,
                      })}
                    >
                      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
                        {name}
                      </Text>
                      {insuranceProvider === name && (
                        <Icon name="CheckCircle" size={18} color={palette.brand} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Shown when redirected here from Home's Insurance button because required
          details were missing — names the specific fields still needed, in orange. */}
      <Modal visible={reminderVisible} transparent animationType="fade" onRequestClose={() => setReminderVisible(false)}>
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

      {/* Delete Vehicle confirmation — same icon-circle popup style as the other
          confirmations on this screen, replacing the native Alert.alert dialog for
          visual consistency; danger-colored instead of brand since this is destructive. */}
      <Modal visible={pendingDeleteVehicle != null} transparent animationType="fade">
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
              <Icon name="Trash2" size={32} color={palette.brand} />
            </View>

            <View style={{ gap: spacing.sm, alignItems: "center" }}>
              <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
                Delete Vehicle
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {pendingDeleteVehicle
                  ? `Remove ${pendingDeleteVehicle.nickname || `${pendingDeleteVehicle.make} ${pendingDeleteVehicle.model}`} (${pendingDeleteVehicle.plateNumber})?`
                  : ""}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: spacing.md, width: "100%" }}>
              <Pressable
                onPress={() => setPendingDeleteVehicle(null)}
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
                  if (pendingDeleteVehicle) {
                    removeVehicle(pendingDeleteVehicle._id);
                  }
                  setPendingDeleteVehicle(null);
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Delete</Text>
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
