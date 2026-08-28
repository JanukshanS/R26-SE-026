import { useEffect, useState } from "react";
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
import { getMyUser } from "@lib/vehicleApi";
import {
  createProvider,
  PROVIDER_TYPES,
  providerTypeLabel,
  type ProviderType,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";
import {
  clearPendingGoogleProviderFlow,
  isPendingGoogleProviderFlow,
  markPendingGoogleProviderFlow,
} from "@lib/pending-google-provider-flow";

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
  const { register, login, updateMe, loginWithGoogle, refreshUser, user } = useVehicle();

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [type, setType] = useState<ProviderType>("MOBILE_MECHANIC");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set once Google sign-in succeeds for an account that is NOT yet a provider.
  // The account exists at that point, so the remaining task is the provider
  // profile itself - which Google cannot supply, since it has no idea what kind
  // of service someone offers or where they are.
  const [googleAccount, setGoogleAccount] = useState<{ name: string; email: string } | null>(null);

  /**
   * Shared by both the button-press continuation below and the mount-time
   * effect that follows it: read the profile and either land on the
   * dashboard (existing provider) or show the remaining profile fields (new
   * provider). Split out because the Google redirect can remount this screen
   * (see pending-google-provider-flow.ts) between the button press and this
   * running — whichever instance is actually live needs to be able to run it.
   */
  async function completeGoogleSignIn() {
    const me = await getMyUser();
    if (!me) {
      setError("Signed in, but your profile could not be loaded. Please try again.");
      return;
    }
    if (me.providerId) {
      // Already a provider - this was a sign-in, not a sign-up.
      router.replace("/(provider)/available");
      return;
    }
    // New provider. The account now exists, but Google cannot tell us what
    // service they offer or where they are, so the profile step remains.
    setGoogleAccount({ name: me.name ?? "", email: me.email ?? "" });
    setName((prev) => prev || me.name || "");
    setMode("register");
  }

  // Picks up a Google flow that was interrupted by the root-screen remount
  // described in pending-google-provider-flow.ts — a fresh mount of this
  // screen finishes what the original button press started.
  useEffect(() => {
    if (!isPendingGoogleProviderFlow()) return;
    clearPendingGoogleProviderFlow();
    setSubmitting(true);
    completeGoogleSignIn()
      .catch((err) => setError((err as Error).message ?? "Google sign-in failed."))
      .finally(() => setSubmitting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Google sign-in doubles as sign-up: there is no separate "register" with an
   * OAuth provider, the account simply exists afterwards. So the only question
   * is whether this account is ALREADY a provider.
   */
  async function handleGoogle() {
    setError("");
    setSubmitting(true);
    markPendingGoogleProviderFlow();
    try {
      await loginWithGoogle();
      // Read the profile DIRECTLY rather than from context state. The context
      // updates asynchronously via onAuthStateChange, so `user` here would
      // still hold the pre-sign-in value and the branch below would be wrong.
      // If the root-screen remount already handed this off to the effect
      // above, this is a harmless redundant check reaching the same result.
      await completeGoogleSignIn();
      clearPendingGoogleProviderFlow();
    } catch (err) {
      setError((err as Error).message ?? "Google sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    setError("");

    // With a Google account the password fields are gone - the account already
    // exists, and only the provider profile is still missing.
    if (!googleAccount && (!email.trim() || !password)) {
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
      // A Google account already exists, so only the last two steps are needed.
      if (!googleAccount) {
        await register(name.trim(), email.trim(), password, phone.trim() || undefined, "provider");
      }

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
          {/* Hidden once signed in with Google: register-vs-sign-in is an
              email/password distinction, and offering it here would suggest the
              account still needs creating when it already exists. */}
          {!googleAccount && (
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
          )}
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

      {/* Google covers BOTH sign-up and sign-in: with OAuth there is no separate
          registration step, the account simply exists afterwards. So this button
          is shown in either mode. Once a Google account is signed in, the auth
          fields below disappear and only the provider profile remains. */}
      {!googleAccount && (
        <>
          <Pressable
            onPress={handleGoogle}
            disabled={submitting}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderWidth: 1.5,
              borderColor: palette.border,
              backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
              borderRadius: radii.lg,
              paddingVertical: spacing.md,
              opacity: submitting ? 0.6 : 1,
            })}
          >
            <Icon name="LogIn" size={18} color={palette.text} />
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Continue with Google
            </Text>
          </Pressable>

          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
            <Text style={{ ...typography.caption, color: palette.textMuted }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
          </View>
        </>
      )}

      {googleAccount && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            backgroundColor: palette.successSoft,
            borderRadius: radii.md,
            padding: spacing.md,
          }}
        >
          <Icon name="CircleCheck" size={18} color={palette.success} />
          <Text style={{ ...typography.caption, color: palette.text, flex: 1 }}>
            Signed in as {googleAccount.email}. Just your service details left.
          </Text>
        </View>
      )}

      {(mode === "register" || googleAccount) && (
        <TextField
          label="Name / Business name"
          value={name}
          onChangeText={setName}
          placeholder="Colombo Mobile Mechanic"
          autoCapitalize="words"
        />
      )}

      {!googleAccount && (
        <>
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
        </>
      )}

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
