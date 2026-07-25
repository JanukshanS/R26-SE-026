import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { getVehicles, updateMyProfile, updateVehicle } from "@lib/vehicleApi";
import { INSURANCE_PROVIDERS } from "@lib/insuranceProviders";

export default function AddInsurerScreen() {
  const insets = useSafeAreaInsets();
  const [provider, setProvider] = useState(INSURANCE_PROVIDERS[0]);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [policy, setPolicy] = useState("");
  const [licence, setLicence] = useState("");
  const [nic, setNic] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError("");
    setSubmitting(true);
    try {
      // Licence/NIC belong to the driver (profiles); insurer/policy belong to a
      // specific vehicle (a driver's two cars can have different insurers), so
      // they're attached to whichever vehicle was just created in the previous
      // Add Vehicle step (its default one) rather than stored on the profile.
      await updateMyProfile({
        licenceNumber: licence.trim(),
        nicNumber: nic.trim(),
      });
      const vehicles = await getVehicles();
      const target = vehicles.find((v) => v.isDefault) ?? vehicles[0];
      if (target) {
        await updateVehicle(target._id, {
          insuranceProvider: provider,
          insurancePolicyNumber: policy.trim(),
        });
      }
      router.replace("/(driver)/home");
    } catch (err) {
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
          <Text style={{ color: palette.text, ...typography.body }}>{provider}</Text>
          <Icon name="ChevronDown" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <TextField
        label="Your insurance policy number"
        value={policy}
        onChangeText={setPolicy}
        placeholder="ALCI-254-VP"
        autoCapitalize="characters"
      />
      <TextField
        label="Your Driving Licence Number"
        value={licence}
        onChangeText={setLicence}
        placeholder="B4818153"
        autoCapitalize="characters"
      />
      <TextField
        label="NIC Number"
        value={nic}
        onChangeText={setNic}
        placeholder="200221458936"
        keyboardType="numbers-and-punctuation"
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
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
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

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ gap: spacing.sm }}>
                {INSURANCE_PROVIDERS.map((name) => (
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
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
