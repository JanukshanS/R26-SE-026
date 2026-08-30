import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LanguagePicker } from "@components/ui/language-picker";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { ProviderBottomNavBar, PROVIDER_NAV_BAR_HEIGHT } from "@components/ui/provider-bottom-nav-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  getProvider,
  providerTypeLabel,
  updateProviderStatus,
  updateProviderProfile,
  type ProviderRecord,
} from "@lib/dispatchApi";
import { useT } from "@lib/i18n";

export default function ProviderProfileScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user, logout } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [saving, setSaving] = useState(false);
  // Read at focus time, not a useFocusEffect dep — a ref avoids re-subscribing
  // the focus effect on every keystroke while still seeing the latest value.
  const editingRef = useRef(false);
  editingRef.current = editing;

  const load = useCallback(async () => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const me = await getProvider(providerId);
      setProvider(me);
      setName(me.name);
      setPhone(me.phone ?? "");
      setVehiclePlate(me.vehiclePlate ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  // Same reasoning as (provider)/services.tsx: skip the refetch while the
  // form is open for editing, so switching tabs and back doesn't silently
  // discard an in-progress, unsaved edit.
  useFocusEffect(
    useCallback(() => {
      if (editingRef.current) return;
      void load();
    }, [load])
  );

  async function save() {
    if (!provider) return;
    if (!name.trim()) {
      Alert.alert(
        t("provider.profile.nameRequiredTitle"),
        t("provider.profile.nameRequiredBody")
      );
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProviderProfile(provider.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        vehiclePlate: vehiclePlate.trim() || undefined,
      });
      setProvider(updated);
      setEditing(false);
    } catch (err) {
      Alert.alert(t("provider.action.saveFailedTitle"), (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    if (provider && provider.status !== "OFFLINE") {
      try {
        await updateProviderStatus(provider.id, "OFFLINE");
      } catch {
        /* best-effort */
      }
    }
    try {
      await logout();
    } catch {
      /* logout already clears local state best-effort */
    }
    router.replace("/");
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ ...typography.h2, color: palette.text }}>{t("provider.profile.title")}</Text>
        {provider && !editing && (
          <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("provider.profile.editA11y")}>
            <Icon name="Pencil" size={20} color={palette.brand} />
          </Pressable>
        )}
      </View>

      <Screen
        edges={["bottom"]}
        contentContainerStyle={{ paddingBottom: PROVIDER_NAV_BAR_HEIGHT + spacing.xl }}
      >
        {!providerId ? (
          <Card><Text style={{ ...typography.body, color: palette.textMuted }}>{t("provider.setup.prompt")}</Text></Card>
        ) : loading ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <ActivityIndicator size="small" color={palette.brand} />
          </Card>
        ) : error ? (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
            <Text style={{ ...typography.bodyStrong, color: palette.danger }}>{t("provider.profile.loadErrorTitle")}</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{error}</Text>
            <Button title={t("provider.action.retry")} variant="secondary" size="md" onPress={load} />
          </Card>
        ) : provider ? (
          <>
            <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md }}>
              <View
                style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: palette.brandSoft,
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Icon name="UserRound" size={32} color={palette.brand} />
              </View>
              <Text style={{ ...typography.h3, color: palette.text }}>{provider.name}</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {providerTypeLabel(provider.type, t)}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <StatTile icon="ShieldCheck" label={t("provider.metric.trustScore")} value={`${Math.round(provider.trustScore * 100)}%`} />
              <StatTile icon="Briefcase" label={t("provider.metric.totalJobs")} value={String(provider.totalJobs)} />
              <StatTile
                icon="Star"
                label={t("provider.metric.avgRating")}
                value={provider.averageRating !== null ? provider.averageRating.toFixed(1) : "—"}
              />
            </View>

            <Card style={{ gap: spacing.md }}>
              <Field
                label={t("provider.field.nameLabel")}
                value={name}
                onChangeText={setName}
                editable={editing}
              />
              <Field
                label={t("provider.profile.phoneLabel")}
                value={phone}
                onChangeText={setPhone}
                editable={editing}
                keyboardType="phone-pad"
                placeholder="+94 77 123 4567"
              />
              <Field
                label={t("provider.profile.plateLabel")}
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                editable={editing}
                autoCapitalize="characters"
                placeholder="WP CAB-1234"
              />
            </Card>

            {editing && (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={t("provider.action.cancel")}
                    variant="secondary"
                    onPress={() => {
                      setEditing(false);
                      setName(provider.name);
                      setPhone(provider.phone ?? "");
                      setVehiclePlate(provider.vehiclePlate ?? "");
                    }}
                    disabled={saving}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={saving ? t("provider.action.saving") : t("provider.profile.save")}
                    onPress={save}
                    disabled={saving}
                  />
                </View>
              </View>
            )}

            <View
              style={{
                backgroundColor: palette.surface,
                borderRadius: radii.lg,
                overflow: "hidden",
              }}
            >
              <LanguagePicker variant="row" />
            </View>

            <Pressable
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel={t("provider.action.logout")}
              style={({ pressed }) => ({
                alignItems: "center",
                paddingVertical: spacing.md,
                borderRadius: radii.lg,
                backgroundColor: palette.dangerSoft,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.danger }}>{t("provider.profile.logoutButton")}</Text>
            </Pressable>
          </>
        ) : null}
      </Screen>

      <ProviderBottomNavBar activeTab="profile" />
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
}) {
  return (
    <Card style={{ flex: 1, alignItems: "center", gap: spacing.xs }}>
      <Icon name={icon} size={18} color={palette.brand} />
      <Text style={{ ...typography.bodyStrong, color: palette.text }}>{value}</Text>
      <Text style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}>{label}</Text>
    </Card>
  );
}

function Field({
  label,
  value,
  onChangeText,
  editable,
  keyboardType,
  autoCapitalize,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  editable: boolean;
  keyboardType?: "phone-pad" | "default";
  autoCapitalize?: "characters" | "none" | "sentences";
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      {editable ? (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          underlineColorAndroid="transparent"
          style={{
            ...typography.body,
            color: palette.text,
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        />
      ) : (
        <Text style={{ ...typography.body, color: palette.text }}>{value || "—"}</Text>
      )}
    </View>
  );
}
