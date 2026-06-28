import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  createProvider,
  PROVIDER_TYPES,
  providerTypeLabel,
  type ProviderType,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";

/**
 * Provider onboarding — a self-serve registration that creates a REAL,
 * dispatchable provider record and links it to the auth account:
 *
 *   register(role="provider")  →  createProvider(GPS)  →  updateMe(providerId)
 *
 * Existing providers can switch to "Sign in" and, if their account already
 * carries a providerId, they're routed straight to the dashboard.
 */
export default function ProviderOnboardingScreen() {
  const { register, login, updateMe } = useVehicle();

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [type, setType] = useState<ProviderType>("MOBILE_MECHANIC");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError("Your name (or business name) is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        const user = await login(email.trim(), password);
        if (!user.providerId) {
          setError(
            "This account isn't set up as a provider yet. Switch to Register to create your provider profile."
          );
          return;
        }
        router.replace("/(provider)/available");
        return;
      }

      // Register: create the account, then the dispatch record, then link them.
      await register(name.trim(), email.trim(), password, phone.trim() || undefined, "provider");

      const loc = await getCurrentDriverLocation();
      const created = await createProvider({
        name: name.trim(),
        type,
        location: { latitude: loc.latitude, longitude: loc.longitude },
        phone: phone.trim() || undefined,
        vehiclePlate: vehiclePlate.trim() || undefined,
      });

      await updateMe({ providerId: created.id });
      router.replace("/(provider)/available");
    } catch (err) {
      setError((err as Error).message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title={
              submitting
                ? "Please wait…"
                : mode === "register"
                  ? "Create provider account"
                  : "Sign in"
            }
            disabled={submitting}
            onPress={handleSubmit}
          />
          <Pressable
            onPress={() => {
              setMode(mode === "register" ? "login" : "register");
              setError("");
            }}
            style={{ alignItems: "center", paddingVertical: spacing.sm }}
          >
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {mode === "register"
                ? "Already a provider? "
                : "New here? "}
              <Text style={{ color: palette.brand, fontWeight: "700" }}>
                {mode === "register" ? "Sign In" : "Register"}
              </Text>
            </Text>
          </Pressable>
        </>
      }
    >
      <HeaderBar />

      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...typography.h1, color: palette.text }}>
          {mode === "register" ? "Become a provider" : "Provider sign in"}
        </Text>
        <Text style={{ ...typography.body, color: palette.textMuted }}>
          {mode === "register"
            ? "Register to receive roadside jobs near you. We use your current location to place you on the map."
            : "Sign in to your provider account to go online and receive jobs."}
        </Text>
      </View>

      {mode === "register" && (
        <TextField
          label="Name / Business name"
          value={name}
          onChangeText={setName}
          placeholder="Colombo Mobile Mechanic"
          autoCapitalize="words"
        />
      )}

      <TextField
        label="Email Address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
      />

      {mode === "register" && (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: palette.text, ...typography.body, fontWeight: "500" }}>
              Service type
            </Text>
            <View style={{ gap: spacing.sm }}>
              {PROVIDER_TYPES.map((pt) => {
                const selected = pt === type;
                return (
                  <Pressable
                    key={pt}
                    onPress={() => setType(pt)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.85 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: spacing.lg,
                      paddingVertical: 14,
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: selected ? palette.brand : palette.border,
                      backgroundColor: selected ? palette.brandSoft : palette.surface,
                    })}
                  >
                    <Text
                      style={{
                        ...typography.body,
                        color: selected ? palette.brand : palette.text,
                        fontWeight: selected ? "700" : "400",
                      }}
                    >
                      {providerTypeLabel(pt)}
                    </Text>
                    {selected ? (
                      <Icon name="Check" size={18} color={palette.brand} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <TextField
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            placeholder="+94 77 123 4567"
            keyboardType="phone-pad"
          />

          <TextField
            label="Vehicle plate (optional)"
            value={vehiclePlate}
            onChangeText={setVehiclePlate}
            placeholder="WP CAB-1234"
            autoCapitalize="characters"
          />

          <Card variant="muted" style={{ flexDirection: "row", gap: spacing.sm }}>
            <Icon name="Info" size={18} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
              Your capabilities are set automatically from your service type. You
              can go online once your profile is created.
            </Text>
          </Card>
        </>
      )}

      {error ? (
        <ErrorState
          title={mode === "register" ? "Could not create account" : "Sign in failed"}
          message={error}
        />
      ) : null}
    </Screen>
  );
}
