import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { updateMyProfile, VehicleApiError } from "@lib/vehicleApi";
import { upsertVehicleInsurance } from "@lib/vehicleInsuranceApi";
import { listInsuranceCompanies, type InsuranceCompany } from "@lib/insuranceCompaniesApi";
import {
  formatExpireMonth,
  formatLicenceNumber,
  formatNicNumber,
  isValidExpireMonth,
  isValidLicenceNumber,
  isValidNicNumber,
} from "@lib/insurer-field-format";

export default function AddInsurerScreen() {
  const insets = useSafeAreaInsets();
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [policy, setPolicy] = useState("");
  const [licence, setLicence] = useState("");
  const [nic, setNic] = useState("");
  const [expireMonth, setExpireMonth] = useState("");
  const [error, setError] = useState("");
  const [policyError, setPolicyError] = useState("");
  const [licenceError, setLicenceError] = useState("");
  const [nicError, setNicError] = useState("");
  const [expireMonthError, setExpireMonthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listInsuranceCompanies()
      .then((list) => {
        if (cancelled) return;
        setCompanies(list);
        setProvider((prev) => prev || list[0]?.companyName || "");
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCompaniesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setError("");
    setPolicyError("");

    // Fields stay optional (Skip / Continue as guest bypass this screen entirely) — only
    // enforce the format once the driver has actually typed something into a field. All
    // three are checked up front (not one-at-a-time with an early return) so every
    // invalid field shows its own error below it at once, not just the first one found.
    const nextLicenceError =
      licence.trim() && !isValidLicenceNumber(licence.trim())
        ? "Must be 1 letter followed by 7 digits (e.g. B4818153)."
        : "";
    const nextNicError =
      nic.trim() && !isValidNicNumber(nic.trim())
        ? "Must be 12 digits, or 9 digits followed by V (e.g. 200221458V)."
        : "";
    const nextExpireMonthError =
      expireMonth.trim() && !isValidExpireMonth(expireMonth.trim())
        ? "Must be a valid future month in YY/MM format (e.g. 26/09)."
        : "";
    setLicenceError(nextLicenceError);
    setNicError(nextNicError);
    setExpireMonthError(nextExpireMonthError);
    if (nextLicenceError || nextNicError || nextExpireMonthError) {
      return;
    }

    if (!provider.trim()) {
      setError(
        companiesLoading
          ? "Still loading insurance providers — please wait a moment and try again."
          : "Please select your insurance provider."
      );
      return;
    }
    setSubmitting(true);
    try {
      // Licence/NIC belong to the driver (profiles); insurer/policy belong to a specific
      // vehicle (a driver's two cars can have different insurers), so they're attached to
      // the vehicle id passed in from the previous Add Vehicle step — never re-derived by
      // guessing "the default vehicle", which could resolve to a different, older vehicle.
      await updateMyProfile({
        licenceNumber: licence.trim(),
        nicNumber: nic.trim(),
      });
      if (vehicleId) {
        await upsertVehicleInsurance(vehicleId, {
          insuranceProvider: provider,
          insurancePolicyNumber: policy.trim(),
          insuranceExpireMonth: expireMonth.trim(),
        });
      } else if (__DEV__) {
        console.warn("add-insurer: no vehicleId param — insurer was not attached to any vehicle.");
      }
      router.replace("/(driver)/home");
    } catch (err) {
      // 23505 = Postgres unique-violation. The three unique columns live across two
      // different tables/calls above, so the constraint name in the error message is
      // what tells us which field to blame — there's no single shared error shape here.
      const apiErr = err instanceof VehicleApiError ? err : null;
      if (apiErr?.code === "23505") {
        if (apiErr.message.includes("nic_number")) {
          setNicError("This NIC Number is already registered to another account.");
        } else if (apiErr.message.includes("licence_number")) {
          setLicenceError("This Driving Licence Number is already registered to another account.");
        } else if (apiErr.message.includes("policy_number")) {
          setPolicyError("This Policy Number is already registered to another vehicle.");
        } else {
          setError("One of the details you entered is already registered elsewhere.");
        }
        return;
      }
      setError((err as Error).message ?? "Couldn't save your insurer details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={submitting ? "Saving…" : "Done"}
            disabled={submitting}
            onPress={handleSave}
          />
          <Button
            title="Skip"
            variant="secondary"
            disabled={submitting}
            onPress={() => router.replace("/(driver)/home")}
          />
          {/* Frictionless: never block entry — continue as a guest. */}
          <Button
            title="Continue as guest"
            variant="ghost"
            disabled={submitting}
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Add your Insurer</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        We use this data when you submit an insurance claim in an emergency.
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, ...typography.body, fontWeight: "500" }}>
          Your insurance provider
        </Text>
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
          {companiesLoading ? (
            <ActivityIndicator size="small" color={palette.textMuted} />
          ) : (
            <Text style={{ color: palette.text, ...typography.body }}>
              {provider || "Select your insurance provider"}
            </Text>
          )}
          <Icon name="ChevronDown" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <TextField
        label="Your insurance policy number"
        value={policy}
        onChangeText={(t) => {
          setPolicy(t);
          setPolicyError("");
        }}
        placeholder="Policy Number"
        autoCapitalize="characters"
        editable={Boolean(provider)}
        error={policyError}
        helperText={provider ? undefined : "Select an insurance provider first."}
      />
      <TextField
        label="Your Driving Licence Number"
        value={licence}
        onChangeText={(t) => {
          setLicence(formatLicenceNumber(t));
          setLicenceError("");
        }}
        placeholder="Licence Number"
        autoCapitalize="characters"
        maxLength={8}
        error={licenceError}
      />
      <TextField
        label="NIC Number"
        value={nic}
        onChangeText={(t) => {
          setNic(formatNicNumber(t));
          setNicError("");
        }}
        placeholder="NIC Number"
        keyboardType="numbers-and-punctuation"
        maxLength={12}
        error={nicError}
      />
      <TextField
        label="Insurance Expiry Month"
        value={expireMonth}
        onChangeText={(t) => {
          setExpireMonth(formatExpireMonth(t));
          setExpireMonthError("");
        }}
        placeholder="YY/MM"
        keyboardType="number-pad"
        maxLength={5}
        editable={Boolean(provider)}
        error={expireMonthError}
        helperText={provider ? undefined : "Select an insurance provider first."}
      />

      {error ? <ErrorState title="Couldn't save insurer details" message={error} /> : null}

      {/* <Card variant="muted">
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Register Vehicle Photos
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          This step is required for the insurer to compare vehicle images after an accident.
        </Text>
        <Button
          title="Go to Guided Capture"
          variant="secondary"
          size="md"
          onPress={() => {}}
        />
      </Card> */}

      {/* Insurance provider picker — same bottom-sheet pattern as the Home vehicle picker. */}
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

            {companiesLoading ? (
              <View style={{ paddingVertical: spacing.xxl, alignItems: "center" }}>
                <ActivityIndicator size="small" color={palette.brand} />
              </View>
            ) : companies.length === 0 ? (
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
                      setProvider(name);
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
                      borderColor: provider === name ? palette.brand : palette.border,
                    })}
                  >
                    <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
                      {name}
                    </Text>
                    {provider === name && (
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
    </Screen>
  );
}
