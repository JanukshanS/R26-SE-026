import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, typography } from "@theme/index";
import { createVehicle } from "@lib/vehicleApi";
import { normalizePlate, plateError } from "@lib/plate-number";

/**
 * Optional vehicle step shown right after account creation (the user is already
 * authenticated, so this persists via the vehicles API). Skippable — the app
 * stays frictionless and the vehicle can be added later from the profile.
 */
export default function AddVehicleScreen() {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError("");
    if (!brand.trim() || !model.trim()) {
      setError("Brand and model are required.");
      return;
    }
    const plateProblem = plateError(registration);
    if (plateProblem) {
      setError(plateProblem);
      return;
    }
    setSubmitting(true);
    try {
      const vehicle = await createVehicle({
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
      setError((err as Error).message ?? "Couldn't save your vehicle.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={submitting ? "Saving…" : "Save Vehicle"}
            disabled={submitting}
            onPress={handleSave}
          />
          <Button
            title="Skip for now"
            variant="secondary"
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      {/* No back control: add-account replaced itself on the way here, so the only
          screen behind this one is the pre-signup welcome wall. */}
      <HeaderBar showBack={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>Add your vehicle</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Optional — we use this to dispatch the right help. You can add or change it
        anytime from your profile.
      </Text>
      <TextField
        label="Your vehicle Brand"
        value={brand}
        onChangeText={setBrand}
        placeholder="e.g. Toyota"
        autoCapitalize="words"
      />
      <TextField
        label="Your vehicle Model"
        value={model}
        onChangeText={setModel}
        placeholder="e.g. Aqua"
        autoCapitalize="words"
      />
      <TextField
        label="Year of manufacture"
        value={year}
        onChangeText={setYear}
        placeholder="2018"
        keyboardType="number-pad"
        maxLength={4}
      />
      <TextField
        label="Vehicle registration number"
        helperText="CAB-1234, WP-CAB-1234, or an older 62-1234"
        value={registration}
        onChangeText={setRegistration}
        placeholder="CAB-1234"
        autoCapitalize="characters"
      />
      {error ? <ErrorState title="Couldn't save vehicle" message={error} /> : null}
    </Screen>
  );
}
