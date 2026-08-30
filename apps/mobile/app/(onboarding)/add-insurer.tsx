import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
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
import { useT } from "@lib/i18n";

export default function AddInsurerScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [policy, setPolicy] = useState("");
  const [licence, setLicence] = useState("");
  const [nic, setNic] = useState("");
  const [companiesError, setCompaniesError] = useState("");
  const [expireMonth, setExpireMonth] = useState("");
  const [error, setError] = useState("");
  const [policyError, setPolicyError] = useState("");
  const [licenceError, setLicenceError] = useState("");
  const [nicError, setNicError] = useState("");
  const [expireMonthError, setExpireMonthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A stale response — from a superseded retry, or after the screen is gone —
  // must not write state. loadId supersedes, mounted stops writes entirely.
  const loadId = useRef(0);
  const mounted = useRef(true);

  const loadCompanies = useCallback(() => {
    const id = ++loadId.current;
    const isCurrent = () => mounted.current && id === loadId.current;
    setCompaniesLoading(true);
    setCompaniesError("");
    void listInsuranceCompanies()
      .then((list) => {
        if (isCurrent()) setCompanies(list);
      })
      .catch(() => {
        if (isCurrent()) setCompaniesError(t("onboarding.insurer.companiesLoadFailed"));
      })
      .finally(() => {
        if (isCurrent()) setCompaniesLoading(false);
      });
  }, [t]);

  useEffect(() => {
    loadCompanies();
    return () => {
      mounted.current = false;
    };
  }, [loadCompanies]);

  async function handleSave() {
    setError("");
    setPolicyError("");

    // Fields stay optional (Skip / Continue as guest bypass this screen entirely) — only
    // enforce the format once the driver has actually typed something into a field. All
    // three are checked up front (not one-at-a-time with an early return) so every
    // invalid field shows its own error below it at once, not just the first one found.
    const nextLicenceError =
      licence.trim() && !isValidLicenceNumber(licence.trim())
        ? t("onboarding.insurer.licenceFormat")
        : "";
    const nextNicError =
      nic.trim() && !isValidNicNumber(nic.trim())
        ? t("onboarding.insurer.nicFormat")
        : "";
    const nextExpireMonthError =
      expireMonth.trim() && !isValidExpireMonth(expireMonth.trim())
        ? t("onboarding.insurer.expiryFormat")
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
          ? t("onboarding.insurer.stillLoading")
          : t("onboarding.insurer.providerRequired")
      );
      return;
    }
    // Licence/NIC belong to the driver (profiles); insurer/policy belong to a specific
    // vehicle (a driver's two cars can have different insurers), so they're attached to
    // the vehicle id passed in from the previous Add Vehicle step — never re-derived by
    // guessing "the default vehicle", which could resolve to a different, older vehicle.
    // Without that id there is nothing to attach the insurer to, so stop before saving
    // anything rather than navigating away as if it had been saved.
    if (!vehicleId) {
      setError(t("onboarding.insurer.vehicleRequired"));
      return;
    }
    setSubmitting(true);
    try {
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
          setNicError(t("onboarding.insurer.nicTaken"));
        } else if (apiErr.message.includes("licence_number")) {
          setLicenceError(t("onboarding.insurer.licenceTaken"));
        } else if (apiErr.message.includes("policy_number")) {
          setPolicyError(t("onboarding.insurer.policyTaken"));
        } else {
          setError(t("onboarding.insurer.duplicateGeneric"));
        }
        return;
      }
      setError((err as Error).message ?? t("onboarding.insurer.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={submitting ? t("onboarding.insurer.saving") : t("onboarding.insurer.save")}
            disabled={submitting}
            onPress={handleSave}
          />
          <Button
            title={t("onboarding.insurer.skip")}
            variant="secondary"
            disabled={submitting}
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>{t("onboarding.insurer.title")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        {t("onboarding.insurer.subtitle")}
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, ...typography.body, fontWeight: "500" }}>
          {t("onboarding.insurer.providerLabel")}
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
              {provider || t("onboarding.insurer.providerPlaceholder")}
            </Text>
          )}
          <Icon name="ChevronDown" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <TextField
        label={t("onboarding.insurer.policyLabel")}
        value={policy}
        onChangeText={(t) => {
          setPolicy(t);
          setPolicyError("");
        }}
        placeholder={t("onboarding.insurer.policyPlaceholder")}
        autoCapitalize="characters"
        editable={Boolean(provider)}
        error={policyError}
        helperText={provider ? undefined : t("onboarding.insurer.selectProviderFirst")}
      />
      <TextField
        label={t("onboarding.insurer.licenceLabel")}
        value={licence}
        onChangeText={(t) => {
          setLicence(formatLicenceNumber(t));
          setLicenceError("");
        }}
        placeholder={t("onboarding.insurer.licencePlaceholder")}
        autoCapitalize="characters"
        maxLength={8}
        error={licenceError}
      />
      <TextField
        label={t("onboarding.insurer.nicLabel")}
        value={nic}
        onChangeText={(t) => {
          setNic(formatNicNumber(t));
          setNicError("");
        }}
        placeholder={t("onboarding.insurer.nicPlaceholder")}
        keyboardType="numbers-and-punctuation"
        maxLength={12}
        error={nicError}
      />
      <TextField
        label={t("onboarding.insurer.expiryLabel")}
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
        helperText={provider ? undefined : t("onboarding.insurer.selectProviderFirst")}
      />

      {companiesError ? (
        <ErrorState
          title={t("onboarding.insurer.companiesLoadFailedTitle")}
          message={companiesError}
          onRetry={loadCompanies}
        />
      ) : null}
      {error ? <ErrorState title={t("onboarding.insurer.saveFailedTitle")} message={error} /> : null}

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
                {t("onboarding.insurer.pickerTitle")}
              </Text>
              <Pressable
                onPress={() => setShowProviderPicker(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("onboarding.insurer.close")}
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
                  {t("onboarding.insurer.pickerLoadFailed")}
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
