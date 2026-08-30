import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { ProviderBottomNavBar, PROVIDER_NAV_BAR_HEIGHT } from "@components/ui/provider-bottom-nav-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  getProvider,
  serviceTypeLabel,
  updateProviderProfile,
  type ProviderRecord,
  type ServiceType,
} from "@lib/dispatchApi";
import { ALL_SERVICE_TYPES, PROVIDER_CAPABILITY_MATRIX } from "@lib/providerCapabilityMatrix";
import { useT } from "@lib/i18n";

/**
 * A provider's own capabilities, grouped into their type's default
 * specialization set and everything else they can additionally offer (e.g.
 * a Locksmith who also carries jump-start cables and fuel cans) — dispatch
 * re-checks the same "real service type, not free-form" rule server-side.
 * Toggling a service off also drops its saved time-to-fix; toggling it back
 * on clears to "not set" rather than restoring a stale number.
 */
export default function ProviderServicesScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<ServiceType>>(new Set());
  const [times, setTimes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Read at focus time, not a useFocusEffect dep — a ref avoids re-subscribing
  // the focus effect on every keystroke while still seeing the latest value.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

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
      setSelected(new Set(me.capabilities));
      const nextTimes: Record<string, string> = {};
      for (const [k, v] of Object.entries(me.serviceTimes ?? {})) nextTimes[k] = String(v);
      setTimes(nextTimes);
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  // Re-fetches on every focus (e.g. switching tabs and back) so the screen
  // never shows stale data — but load() unconditionally overwrites `selected`/
  // `times` from the server, which would silently discard an in-progress,
  // unsaved edit if the provider switched tabs without hitting Save first.
  useFocusEffect(
    useCallback(() => {
      if (dirtyRef.current) return;
      void load();
    }, [load])
  );

  const specialization = provider ? PROVIDER_CAPABILITY_MATRIX[provider.type] ?? [] : [];
  const specializationSet = new Set(specialization);
  const additional = ALL_SERVICE_TYPES.filter((s) => !specializationSet.has(s));

  function toggle(service: ServiceType) {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(service)) {
        next.delete(service);
        setTimes((t) => {
          const { [service]: _drop, ...rest } = t;
          return rest;
        });
      } else {
        next.add(service);
      }
      return next;
    });
  }

  function setTime(service: ServiceType, value: string) {
    setDirty(true);
    // Digits only — a minutes field, not free text.
    setTimes((t) => ({ ...t, [service]: value.replace(/[^0-9]/g, "") }));
  }

  async function save() {
    if (!provider) return;
    if (selected.size === 0) {
      Alert.alert(t("provider.services.minOneTitle"), t("provider.services.minOneBody"));
      return;
    }
    setSaving(true);
    try {
      const serviceTimes: Record<string, number> = {};
      for (const service of selected) {
        const raw = times[service];
        const minutes = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(minutes) && minutes > 0) serviceTimes[service] = minutes;
      }
      const updated = await updateProviderProfile(provider.id, {
        capabilities: Array.from(selected),
        serviceTimes,
      });
      setProvider(updated);
      setDirty(false);
      Alert.alert(t("provider.services.savedTitle"), t("provider.services.savedBody"));
    } catch (err) {
      Alert.alert(t("provider.action.saveFailedTitle"), (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.lg,
        }}
      >
        <Text style={{ ...typography.h2, color: palette.text }}>{t("provider.services.title")}</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted, marginTop: 2 }}>
          {t("provider.services.subtitle")}
        </Text>
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
            <Text style={{ ...typography.bodyStrong, color: palette.danger }}>{t("provider.services.loadErrorTitle")}</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{error}</Text>
            <Button title={t("provider.action.retry")} variant="secondary" size="md" onPress={load} />
          </Card>
        ) : (
          <>
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...typography.h3, color: palette.text }}>
                {t("provider.services.specializationHeading", {
                  type: provider
                    ? provider.type.replace(/_/g, " ").toLowerCase()
                    : t("provider.services.specializationFallback"),
                })}
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {t("provider.services.specializationBody")}
              </Text>
            </View>
            <View style={{ gap: spacing.sm }}>
              {specialization.map((service) => (
                <ServiceRow
                  key={service}
                  service={service}
                  on={selected.has(service)}
                  time={times[service] ?? ""}
                  onToggle={() => toggle(service)}
                  onTimeChange={(v) => setTime(service, v)}
                />
              ))}
            </View>

            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              <Text style={{ ...typography.h3, color: palette.text }}>{t("provider.services.additionalHeading")}</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {t("provider.services.additionalBody")}
              </Text>
            </View>
            <View style={{ gap: spacing.sm }}>
              {additional.map((service) => (
                <ServiceRow
                  key={service}
                  service={service}
                  on={selected.has(service)}
                  time={times[service] ?? ""}
                  onToggle={() => toggle(service)}
                  onTimeChange={(v) => setTime(service, v)}
                />
              ))}
            </View>

            <Button
              title={saving ? t("provider.action.saving") : t("provider.services.save")}
              onPress={save}
              disabled={!dirty || saving}
            />
          </>
        )}
      </Screen>

      <ProviderBottomNavBar activeTab="services" />
    </View>
  );
}

function ServiceRow({
  service,
  on,
  time,
  onToggle,
  onTimeChange,
}: {
  service: ServiceType;
  on: boolean;
  time: string;
  onToggle: () => void;
  onTimeChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <Card style={{ gap: spacing.sm }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: on ? palette.brand : palette.border,
            backgroundColor: on ? palette.brand : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {on ? <Icon name="Check" size={14} color={palette.textOnBrand} /> : null}
        </View>
        <Text style={{ ...typography.body, color: palette.text, flex: 1, fontWeight: on ? "600" : "400" }}>
          {serviceTypeLabel(service, t)}
        </Text>
      </Pressable>

      {on && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingLeft: 22 + spacing.md,
          }}
        >
          <Icon name="Clock" size={14} color={palette.textMuted} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("provider.services.typicalTime")}</Text>
          <TextInput
            value={time}
            onChangeText={onTimeChange}
            placeholder={t("provider.services.timePlaceholder")}
            keyboardType="number-pad"
            maxLength={3}
            underlineColorAndroid="transparent"
            style={{
              ...typography.body,
              color: palette.text,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: radii.md,
              paddingHorizontal: spacing.sm,
              paddingVertical: 4,
              width: 60,
              textAlign: "center",
            }}
          />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("provider.services.minutesUnit")}</Text>
        </View>
      )}
    </Card>
  );
}
