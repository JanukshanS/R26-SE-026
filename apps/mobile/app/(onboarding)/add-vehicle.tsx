import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { normalizePlate, plateError } from "@lib/plate-number";
import { useT } from "@lib/i18n";

/**
 * Optional vehicle step shown right after account creation (the user is already
 * authenticated, so this persists via the vehicles API). Skippable — the app
 * stays frictionless and the vehicle can be added later from the profile.
 */
export default function AddVehicleScreen() {
  // Saves through the context rather than calling the vehicles API directly: the
  // context refreshes its vehicle list after the insert, and Home renders from that
  // list. Going straight to the API left the row in the database but the list empty,
  // so Home showed "No vehicle added" until the app was restarted.
  const t = useT();
  const { addVehicle } = useVehicle();
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError("");
    if (!brand.trim() || !model.trim()) {
      setError(t("onboarding.vehicle.brandModelRequired"));
      return;
    }
    const plateProblem = plateError(registration);
    if (plateProblem) {
      setError(plateProblem);
      return;
    }
    setSubmitting(true);
    try {
      const vehicle = await addVehicle({
        make: brand.trim(),
        model: model.trim(),
        year: year ? Number(year) : undefined,
        plateNumber: normalizePlate(registration),
        fuelType: "petrol",
        currentMileage: 0,
        isDefault: true,
      });
      // Insurer/policy are captured next and attached to THIS vehicle by id (not the
      // profile, and not re-derived by guessing "the default vehicle" later) so a driver
      // with a second car can give it a different insurer without ever touching the first.
      router.replace({
        pathname: "/(onboarding)/add-insurer",
        params: { vehicleId: vehicle._id },
      });
    } catch (err) {
      setError((err as Error).message ?? t("onboarding.vehicle.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={submitting ? t("onboarding.vehicle.saving") : t("onboarding.vehicle.save")}
            disabled={submitting}
            onPress={handleSave}
          />
          <Button
            title={t("onboarding.vehicle.skip")}
            variant="secondary"
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      {/* No back control: add-account replaced itself on the way here, so the only
          screen behind this one is the pre-signup welcome wall. */}
      <HeaderBar showBack={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>{t("onboarding.vehicle.title")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        {t("onboarding.vehicle.subtitle")}
      </Text>
      <TextField
        label={t("onboarding.vehicle.brandLabel")}
        value={brand}
        onChangeText={setBrand}
        placeholder={t("onboarding.vehicle.brandPlaceholder")}
        autoCapitalize="words"
      />
      <TextField
        label={t("onboarding.vehicle.modelLabel")}
        value={model}
        onChangeText={setModel}
        placeholder={t("onboarding.vehicle.modelPlaceholder")}
        autoCapitalize="words"
      />
      <TextField
        label={t("onboarding.vehicle.yearLabel")}
        value={year}
        onChangeText={setYear}
        placeholder="2018"
        keyboardType="number-pad"
        maxLength={4}
      />
      <TextField
        label={t("onboarding.vehicle.plateLabel")}
        helperText={t("onboarding.vehicle.plateHelper")}
        value={registration}
        onChangeText={setRegistration}
        placeholder="CAB-1234"
        autoCapitalize="characters"
      />
      {error ? <ErrorState title={t("onboarding.vehicle.saveFailedTitle")} message={error} /> : null}
    </Screen>
  );
}
