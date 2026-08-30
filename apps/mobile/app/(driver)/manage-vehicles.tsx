import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Chip } from "@components/ui/chip";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { VehicleApiError, type Vehicle, type VehicleInput } from "@lib/vehicleApi";
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
import { normalizePlate, plateError } from "@lib/plate-number";
import { useT } from "@lib/i18n";
import { haptics } from "@lib/haptics";
import {
  formatExpireMonth,
  formatLicenceNumber,
  formatNicNumber,
  isValidExpireMonth,
  isValidLicenceNumber,
  isValidNicNumber,
} from "@lib/insurer-field-format";

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric"] as const;

/**
 * Registering a used car walks through one component per screen. The engine is
 * absent on purpose: engines are not replaced on a schedule, so "km since it was
 * fitted" has no meaning for one. Engine condition is judged from how it runs,
 * and engine oil is tracked separately on its own interval.
 */
const BASELINE_STEPS = [
  { key: "tire" as ComponentKey, labelKey: "driver.vehicles.stepTire", labelLowerKey: "driver.vehicles.stepTireLower", icon: "CircleDot" as const },
  { key: "brake" as ComponentKey, labelKey: "driver.vehicles.stepBrake", labelLowerKey: "driver.vehicles.stepBrakeLower", icon: "Disc" as const },
  { key: "battery" as ComponentKey, labelKey: "driver.vehicles.stepBattery", labelLowerKey: "driver.vehicles.stepBatteryLower", icon: "BatteryCharging" as const },
];

const CONDITION_OPTIONS = [
  {
    value: "new" as VehicleCondition,
    titleKey: "driver.vehicles.conditionNewTitle",
    blurbKey: "driver.vehicles.conditionNewBlurb",
  },
  {
    value: "used" as VehicleCondition,
    titleKey: "driver.vehicles.conditionUsedTitle",
    blurbKey: "driver.vehicles.conditionUsedBlurb",
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
  const t = useT();
  const { user, vehicles, vehiclesLoading, vehicleError, refreshVehicles, selectedVehicle, selectVehicle, addVehicle, editVehicle, removeVehicle, setDefault, updateMe } = useVehicle();
  // "addVehicle" param renamed on destructure — the context already exposes an
  // `addVehicle` function above, and the two would otherwise collide.
  const { editVehicleId, addVehicle: autoOpenAddParam } = useLocalSearchParams<{
    editVehicleId?: string;
    addVehicle?: string;
  }>();
  const autoOpenedAdd = useRef(false);

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
      if (!insurance?.insuranceProvider) missing.push("driver.vehicles.missingProvider");
      if (!insurance?.insurancePolicyNumber) missing.push("driver.vehicles.missingPolicyNumber");
      if (!insurance?.insuranceExpireMonth) missing.push("driver.vehicles.missingExpiry");
      if (!user?.licenceNumber) missing.push("driver.vehicles.missingLicence");
      if (!user?.nicNumber) missing.push("driver.vehicles.missingNic");
      if (missing.length > 0) {
        setMissingLabels(missing);
        setReminderVisible(true);
        haptics.error();
      }
    })();
  }, [editVehicleId, vehicles, vehiclesLoading, user]);

  useEffect(() => {
    // Powers the live estimate on the component screens. Null is fine: the
    // server still infers correctly, we just cannot preview the number.
    void getComponentLifespans().then(setLifespans);
  }, []);

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
    setStep(STEP_DETAILS);
    setCondition("used");
    setAnswers(BLANK_ANSWERS);
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
        setError(t("driver.vehicles.errorRequiredFields"));
        return;
      }
      setError("");
    }
    setStep((n) => n + 1);
  }

  function handleSave() {
    if (!form.make || !form.model || !form.plateNumber) {
      setError(t("driver.vehicles.errorRequiredFields"));
      return;
    }
    const plateProblemKey = plateError(form.plateNumber ?? "");
    if (plateProblemKey) {
      setError(t(plateProblemKey));
      return;
    }
    // Policy Number/Expiry Month are disabled in the form until a provider is picked, so
    // this shouldn't be reachable in practice — kept as a safety net regardless.
    if (!insuranceProvider && (insurancePolicyNumber.trim() || insuranceExpireMonth.trim())) {
      setError(t("driver.vehicles.errorProviderFirst"));
      return;
    }
    // Licence/NIC/Policy Number stay optional — only enforce the format once something's
    // actually been typed, same convention as the Add your Insurer onboarding screen.
    const nextLicenceError =
      licenceNumber.trim() && !isValidLicenceNumber(licenceNumber.trim())
        ? t("driver.vehicles.errorLicenceFormat")
        : "";
    const nextNicError =
      nicNumber.trim() && !isValidNicNumber(nicNumber.trim())
        ? t("driver.vehicles.errorNicFormat")
        : "";
    const nextExpireMonthError =
      insuranceExpireMonth.trim() && !isValidExpireMonth(insuranceExpireMonth.trim())
        ? t("driver.vehicles.errorExpiryFormat")
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
      // Only written when the driver actually picked a provider. Writing
      // regardless created an empty vehicle_insurance row for every new
      // vehicle; gating on the FORM (edit-only) instead would break arriving
      // here from Home's Insurance button, which opens the add form expecting
      // to fill exactly these fields in.
      if (insuranceProvider) {
        await upsertVehicleInsurance(vehicleId, {
          insuranceProvider,
          insurancePolicyNumber,
          insuranceExpireMonth,
        });
      }
    } catch (err: any) {
      // 23505 = Postgres unique-violation — same handling as Add your Insurer, since
      // these fields share the exact same DB constraints. Only policy_number can
      // violate here; licence/NIC belong to the profile write below.
      if (err instanceof VehicleApiError && err.code === "23505") {
        if (err.message.includes("policy_number")) {
          setPolicyError(t("driver.vehicles.errorPolicyDuplicate"));
        } else {
          setError(t("driver.vehicles.errorDuplicate"));
        }
      } else {
        setError(err.message ?? t("driver.vehicles.errorSaveFailed"));
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
            ? t("driver.vehicles.errorNicDuplicate")
            : t("driver.vehicles.errorLicenceDuplicate")
          : null;
      Alert.alert(
        t("driver.vehicles.profileSaveFailedTitle"),
        t("driver.vehicles.profileSaveFailedBody", {
          message: duplicate ?? err.message ?? t("driver.vehicles.profileSaveFailedFallback"),
        })
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
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.lg,
          gap: spacing.lg,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {/* Same true-pill back/home header as My Claims and the emergency
            flow's "What's wrong?" screen; Add replaces the home shortcut
            since it's the one action this screen actually needs. */}
        <HeaderBar
          right={
            <Pressable
              onPress={openAdd}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.pill,
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
              })}
            >
              <Icon name="Plus" size={16} color={palette.textOnBrand} />
              <Text style={{ ...typography.caption, color: palette.textOnBrand, fontWeight: "700" }}>
                {t("driver.vehicles.add")}
              </Text>
            </Pressable>
          }
        />

        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...typography.display, color: palette.text, fontSize: 28 }}>{t("driver.vehicles.title")}</Text>
          {user && (
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {vehiclesLoading
                ? user.name
                : t("driver.vehicles.registeredCount", { count: vehicles.length })}
            </Text>
          )}
        </View>

        {vehiclesLoading ? (
          <ActivityIndicator size="large" color={palette.brand} style={{ marginTop: 40 }} />
        ) : vehicleError && vehicles.length === 0 ? (
          /* Without this the failed fetch looks like an empty garage, and the
             driver re-registers a car they already have. */
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="TriangleAlert" size={48} color={palette.danger} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              {t("driver.vehicles.loadFailed", { message: vehicleError })}
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
                {t("driver.vehicles.retry")}
              </Text>
            </Pressable>
          </View>
        ) : vehicles.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="Car" size={48} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              {t("driver.vehicles.emptyBody")}
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
              overflow: "hidden",
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.md,
              // Never taller than the sheet's own window; the ScrollView inside
              // takes the remaining space rather than a hardcoded 440px.
              maxHeight: "92%",
            }}
          >
            {/* Modal header — tinted brandSoft bar, same treatment as the
                (driver) screens' headers; clipped to the sheet's own rounded
                top corners by the parent's overflow: hidden. Still carries the
                multi-step Add flow's title/step count — only Edit collapses to
                a single static title. */}
            <View
              style={{
                backgroundColor: palette.brandSoft,
                paddingTop: spacing.lg,
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.lg,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.h3, color: palette.text }}>
                  {editingVehicle
                    ? t("driver.vehicles.formTitleEdit")
                    : step === STEP_DETAILS
                      ? t("driver.vehicles.formTitleAdd")
                      : step === STEP_CONDITION
                        ? t("driver.vehicles.formTitleCondition")
                        : t(BASELINE_STEPS[step - STEP_FIRST_COMPONENT]?.labelKey ?? "")}
                </Text>
                {!editingVehicle && (
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>
                    {t("driver.vehicles.stepCounter", { current: step + 1, total: lastStep + 1 })}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => setShowForm(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("driver.vehicles.close")}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: palette.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="X" size={18} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
                {(editingVehicle || step === STEP_DETAILS) && (
                <>
                <Text style={{ ...typography.micro, color: palette.textMuted, fontWeight: "600" }}>
                  {t("driver.vehicles.sectionDetails")}
                </Text>
                <Row>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldMake")} value={form.make ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, make: v }))} placeholder="Toyota" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldModel")} value={form.model ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, model: v }))} placeholder="Aqua" />
                  </View>
                </Row>
                <Row>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldPlate")} value={form.plateNumber ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, plateNumber: v.toUpperCase() }))} placeholder="CBD-3742" autoCapitalize="characters" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldYear")} value={form.year?.toString() ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, year: v ? parseInt(v) : undefined }))} placeholder="2022" keyboardType="numeric" />
                  </View>
                </Row>
                <TextField label={t("driver.vehicles.fieldNickname")} value={form.nickname ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, nickname: v }))} placeholder={t("driver.vehicles.fieldNicknamePlaceholder")} />
                <Row>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldColor")} value={form.color ?? ""} onChangeText={(v) => setForm((f) => ({ ...f, color: v }))} placeholder={t("driver.vehicles.fieldColorPlaceholder")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField label={t("driver.vehicles.fieldMileage")} value={form.currentMileage?.toString() ?? "0"} onChangeText={(v) => setForm((f) => ({ ...f, currentMileage: parseInt(v) || 0 }))} keyboardType="numeric" placeholder="0" />
                  </View>
                </Row>

                {/* Fuel type selector */}
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...typography.body, color: palette.text, fontWeight: "500" }}>{t("driver.vehicles.fieldFuelType")}</Text>
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

                {/* Insurance, licence and NIC are offered on the DETAILS step and
                    when editing — not on the later wizard steps, which are about
                    the vehicle's own condition. Registering is never BLOCKED on
                    paperwork the driver may not have yet: the fields are optional
                    and nothing is written unless a provider is actually chosen
                    (see performSave), so the vehicle row is complete without them.

                    Insurance provider selector — per-vehicle, since a driver's two cars
                    can be insured with different providers/policies. Same bottom-sheet
                    dropdown pattern as the Add your Insurer onboarding screen, rather
                    than an inline pill list, for consistency. */}
                {(editingVehicle || step === STEP_DETAILS) ? (
                  <>
                <Text style={{ ...typography.micro, color: palette.textMuted, fontWeight: "600", marginTop: spacing.sm }}>
                  {t("driver.vehicles.sectionInsurance")}
                </Text>
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...typography.body, color: palette.text, fontWeight: "500" }}>{t("driver.vehicles.fieldProvider")}</Text>
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
                      {insuranceProvider || t("driver.vehicles.providerPlaceholder")}
                    </Text>
                    <Icon name="ChevronDown" size={18} color={palette.textMuted} />
                  </Pressable>
                </View>
                <TextField
                  label={t("driver.vehicles.fieldPolicyNumber")}
                  value={insurancePolicyNumber}
                  onChangeText={(t) => {
                    setInsurancePolicyNumber(t);
                    setPolicyError("");
                  }}
                  placeholder="ALCI-254-VP"
                  autoCapitalize="characters"
                  editable={Boolean(insuranceProvider)}
                  error={policyError}
                  helperText={insuranceProvider ? undefined : t("driver.vehicles.providerFirstHint")}
                />
                <TextField
                  label={t("driver.vehicles.fieldExpiryMonth")}
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
                  helperText={insuranceProvider ? undefined : t("driver.vehicles.providerFirstHint")}
                />

                {/* Your details group — profile-level (one per driver), same
                    value regardless of which vehicle is being edited, kept here
                    so it can be completed later if it was skipped during
                    onboarding. Same format/validation as the Add your Insurer
                    onboarding screen (lib/insurer-field-format.ts). */}
                <Text style={{ ...typography.micro, color: palette.textMuted, fontWeight: "600", marginTop: spacing.sm }}>
                  {t("driver.vehicles.sectionYourDetails")}
                </Text>
                <TextField
                  label={t("driver.vehicles.fieldLicence")}
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
                  label={t("driver.vehicles.fieldNic")}
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
                      {t("driver.vehicles.insuranceLaterNote")}
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
                      {t("driver.vehicles.conditionQuestion")}
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
                            {t(opt.titleKey)}
                          </Text>
                          <Text style={{ ...typography.caption, color: palette.textMuted }}>
                            {t(opt.blurbKey)}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <Text style={{ ...typography.caption, color: palette.textMuted }}>
                      {t("driver.vehicles.conditionLocked")}
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
                          {t("driver.vehicles.replacedQuestion", { component: t(meta.labelLowerKey) })}
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
                          {t("driver.vehicles.notSure")}
                        </Text>
                        <Text style={{ ...typography.caption, color: palette.textMuted }}>
                          {est
                            ? t("driver.vehicles.notSureEstimate", {
                                km: Math.round(est.kmOnComponent).toLocaleString(),
                              })
                            : t("driver.vehicles.notSureFallback")}
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
                          {t("driver.vehicles.knowWhen")}
                        </Text>
                        {answer.known ? (
                          <TextField
                            label={t("driver.vehicles.replacedAtLabel")}
                            value={answer.installKm}
                            onChangeText={(t: string) => setAnswer({ installKm: t.replace(/[^0-9]/g, "") })}
                            placeholder={String(Math.max(Number(form.currentMileage) || 0, 0))}
                            keyboardType="numeric"
                          />
                        ) : (
                          <Text style={{ ...typography.caption, color: palette.textMuted }}>
                            {t("driver.vehicles.replacedAtHint")}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  );
                })()}

              </View>
            </ScrollView>

            {/* Back, on any step past the first of the add flow. */}
            {!editingVehicle && step > STEP_DETAILS && (
              <Pressable
                onPress={() => { setError(""); setStep((n) => Math.max(n - 1, STEP_DETAILS)); }}
                disabled={saving}
                style={{ paddingVertical: spacing.sm, alignItems: "center" }}
              >
                <Text style={{ ...typography.body, color: palette.textMuted }}>{t("driver.vehicles.back")}</Text>
              </Pressable>
            )}

            {/* Sits with the submit button, not at the end of the scroll area.
                Down there a failed validation rendered off-screen, so tapping
                Save looked like it simply did nothing. */}
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
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
                  {editingVehicle
                    ? t("driver.vehicles.saveChanges")
                    : isLastStep
                      ? t("driver.vehicles.addVehicle")
                      : t("driver.vehicles.next")}
                </Text>
              </Pressable>
            </View>
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
                {t("driver.vehicles.providerPickerTitle")}
              </Text>
              <Pressable
                onPress={() => setShowProviderPicker(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("driver.vehicles.close")}
              >
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            {companies.length === 0 ? (
              <View style={{ paddingVertical: spacing.xxl, alignItems: "center" }}>
                <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
                  {t("driver.vehicles.providerLoadFailed")}
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
                {t("driver.vehicles.reminderTitle")}
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {t("driver.vehicles.reminderBody")}
              </Text>
            </View>

            <View style={{ gap: spacing.xs, alignSelf: "stretch" }}>
              {missingLabels.map((label) => (
                <Text
                  key={label}
                  style={{ ...typography.bodyStrong, color: palette.brand, textAlign: "center" }}
                >
                  {`• ${t(label)}`}
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
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.vehicles.gotIt")}</Text>
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
                {t("driver.vehicles.confirmSaveTitle")}
              </Text>
              <Text
                style={{
                  ...typography.body,
                  color: palette.textMuted,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                {t("driver.vehicles.confirmSaveBody")}
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
                <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{t("driver.vehicles.cancel")}</Text>
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.vehicles.save")}</Text>
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
                {t("driver.vehicles.switchTitle")}
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
                  ? t("driver.vehicles.switchBody", {
                      vehicle:
                        pendingVehicle.nickname ||
                        `${pendingVehicle.make} ${pendingVehicle.model}`,
                      plate: pendingVehicle.plateNumber,
                    })
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
                <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{t("driver.vehicles.cancel")}</Text>
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.vehicles.switch")}</Text>
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
                {t("driver.vehicles.deleteTitle")}
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
                  ? t("driver.vehicles.deleteBody", {
                      vehicle:
                        pendingDeleteVehicle.nickname ||
                        `${pendingDeleteVehicle.make} ${pendingDeleteVehicle.model}`,
                      plate: pendingDeleteVehicle.plateNumber,
                    })
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
                <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{t("driver.vehicles.cancel")}</Text>
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
                <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.vehicles.delete")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Petrol/diesel share the generic Car icon (the common case); electric and
 * hybrid get a more specific glyph, same pattern as Home's per-intent quick
 * action icons (Disc/Fuel/KeyRound). */
function vehicleIcon(fuelType: Vehicle["fuelType"]): IconName {
  if (fuelType === "electric") return "Zap";
  if (fuelType === "hybrid") return "Leaf";
  return "Car";
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
  const t = useT();
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        padding: spacing.xl,
        gap: spacing.md,
        boxShadow: "0 2px 8px rgba(15, 15, 15, 0.05)",
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.lg,
            backgroundColor: palette.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={vehicleIcon(v.fuelType)} size={26} color={palette.brand} />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: palette.text, flex: 1 }}>
              {v.nickname || `${v.make} ${v.model}`}
            </Text>
            {isSelected && (
              <Icon name="CheckCircle" size={18} color={palette.brand} />
            )}
            {v.isDefault && <Badge label={t("driver.vehicles.badgeDefault")} tone="brand" />}
          </View>
          <Text style={{ ...typography.body, color: palette.textMuted }}>
            {v.year ? `${v.year} · ` : ""}{v.fuelType.charAt(0).toUpperCase() + v.fuelType.slice(1)}
          </Text>
          {v.currentMileage > 0 && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {v.currentMileage.toLocaleString()} km
            </Text>
          )}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
        <Chip label={v.plateNumber} />
        <Chip label={v.fuelType.charAt(0).toUpperCase() + v.fuelType.slice(1)} />
        {v.color ? (
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{v.color}</Text>
        ) : null}
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
              paddingVertical: spacing.md,
              alignItems: "center",
              borderRadius: radii.md,
              backgroundColor: pressed ? palette.brandSoft : "transparent",
              borderWidth: 1,
              borderColor: palette.border,
            })}
          >
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              {t("driver.vehicles.setDefault")}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onEdit}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: spacing.md,
            alignItems: "center",
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.brandPressed : palette.brand,
          })}
        >
          <Text style={{ ...typography.caption, color: palette.textOnBrand, fontWeight: "600" }}>{t("driver.vehicles.edit")}</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: spacing.md,
            alignItems: "center",
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.brandPressed : palette.brand,
          })}
        >
          <Text style={{ ...typography.caption, color: palette.textOnBrand, fontWeight: "600" }}>{t("driver.vehicles.cardDelete")}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: spacing.sm }}>{children}</View>;
}
