/**
 * Garage directory: garages registered on Kaduna that chose to be listed,
 * with a Call button. Every call is logged (lib/directoryApi.callGarage) so
 * the admin dashboard can count how many calls the app sends each garage.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { Icon } from "@components/ui/icon";
import { Centered, SearchBox } from "@components/ui/search-box";
import { callGarage, listGarages, type DirectoryGarage } from "@lib/directoryApi";
import { haptics } from "@lib/haptics";
import { useT } from "@lib/i18n";
import { palette, radii, spacing, typography } from "@theme/index";

export default function GaragesScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const [search, setSearch] = useState("");
  const [garages, setGarages] = useState<DirectoryGarage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setGarages(await listGarages(search.trim() || undefined));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  async function call(garage: DirectoryGarage) {
    if (!garage.phone || calling) return;
    haptics.tap();
    setCalling(garage.id);
    try {
      await callGarage(garage);
    } catch (err) {
      Alert.alert(t("driver.directory.callFailedTitle"), (err as Error).message);
    } finally {
      setCalling(null);
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
          gap: spacing.md,
        }}
      >
        <Text style={{ ...typography.h1, color: palette.text }}>{t("driver.directory.garagesTitle")}</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("driver.directory.garagesSubtitle")}</Text>
        <SearchBox value={search} onChange={setSearch} placeholder={t("driver.directory.searchGarages")} />
      </View>

      {loading && !garages ? (
        <Centered>
          <ActivityIndicator size="small" color={palette.brand} />
        </Centered>
      ) : failed ? (
        <Centered>
          <Icon name="CloudOff" size={32} color={palette.textMuted} />
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>{t("driver.directory.loadError")}</Text>
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{t("driver.directory.retry")}</Text>
          </Pressable>
        </Centered>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + NAV_BAR_HEIGHT + spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("driver.directory.garagesCount", { count: garages?.length ?? 0 })}
          </Text>
          {garages && garages.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}>
              <Icon name="Warehouse" size={30} color={palette.textMuted} />
              <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
                {search ? t("driver.directory.noGarageMatch") : t("driver.directory.noGarages")}
              </Text>
            </View>
          ) : (
            garages?.map((g) => <GarageCard key={g.id} garage={g} busy={calling === g.id} onCall={() => call(g)} />)
          )}
        </ScrollView>
      )}

      <BottomNavBar activeTab="garages" />
    </View>
  );
}

function GarageCard({ garage, busy, onCall }: { garage: DirectoryGarage; busy: boolean; onCall: () => void }) {
  const t = useT();
  const initials = garage.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: garage.brandColor ?? palette.brandSoft,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: garage.brandColor ? "#fff" : palette.brand }}>{initials}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }} numberOfLines={1}>
            {garage.name}
          </Text>
          {garage.address ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="MapPin" size={12} color={palette.textMuted} />
              <Text style={{ ...typography.micro, color: palette.textMuted, flex: 1 }} numberOfLines={2}>
                {garage.address}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {garage.services.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {garage.services.slice(0, 6).map((s) => (
            <View key={s} style={{ backgroundColor: palette.surfaceMuted, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ ...typography.micro, color: palette.text }}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {garage.note ? <Text style={{ ...typography.micro, color: palette.textMuted }}>{garage.note}</Text> : null}

      {garage.phone ? (
        <Pressable
          onPress={onCall}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("driver.directory.callA11y", { name: garage.name })}
          style={({ pressed }) => ({
            marginTop: spacing.xs,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            backgroundColor: palette.brand,
            borderRadius: radii.md,
            paddingVertical: spacing.sm + 2,
            opacity: pressed || busy ? 0.75 : 1,
          })}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="Phone" size={16} color="#fff" />}
          <Text style={{ ...typography.bodyStrong, color: "#fff" }}>{t("driver.directory.call")}</Text>
        </Pressable>
      ) : (
        <Text style={{ ...typography.micro, color: palette.textMuted }}>{t("driver.directory.noPhone")}</Text>
      )}
    </View>
  );
}
