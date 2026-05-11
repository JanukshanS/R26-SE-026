import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login, register, authLoading } = useVehicle();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError("");
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        if (!name.trim()) { setError("Name is required"); return; }
        await register(name.trim(), email.trim(), password, phone.trim() || undefined);
      }
      // Go to manage-vehicles so the user can add their first vehicle
      router.replace("/(driver)/manage-vehicles");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
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
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {mode === "login" ? "Sign In" : "Create Account"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand mark */}
        <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: palette.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="Car" size={36} color={palette.brand} />
          </View>
          <Text style={{ ...typography.h2, color: palette.text }}>
            {mode === "login" ? "Welcome back" : "Get started"}
          </Text>
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
            {mode === "login"
              ? "Sign in to manage your vehicles"
              : "Create an account to track multiple vehicles"}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          {mode === "register" && (
            <Field label="Full Name" value={name} onChangeText={setName} placeholder="Janukshan Perera" autoCapitalize="words" />
          )}
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
          {mode === "register" && (
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+94 77 123 4567" keyboardType="phone-pad" />
          )}

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
              <Icon name="AlertCircle" size={16} color={palette.danger} />
              <Text style={{ ...typography.caption, color: palette.danger, flex: 1 }}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={authLoading}
            style={({ pressed }) => ({
              backgroundColor: authLoading ? palette.textMuted : pressed ? palette.brandPressed : palette.brand,
              borderRadius: radii.lg,
              paddingVertical: spacing.md + 2,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: spacing.sm,
              marginTop: spacing.sm,
            })}
          >
            {authLoading && <ActivityIndicator size="small" color={palette.textOnBrand} />}
            <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
              {mode === "login" ? "Sign In" : "Create Account"}
            </Text>
          </Pressable>
        </View>

        {/* Toggle mode */}
        <Pressable
          onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          style={{ alignItems: "center", paddingVertical: spacing.md }}
        >
          <Text style={{ ...typography.body, color: palette.textMuted }}>
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <Text style={{ color: palette.brand, fontWeight: "700" }}>
              {mode === "login" ? "Register" : "Sign In"}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        secureTextEntry={secureTextEntry}
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          ...typography.body,
          color: palette.text,
          backgroundColor: palette.surface,
        }}
      />
    </View>
  );
}
