/**
 * Spare parts: what parts shops on Kaduna list, filtered to the driver's car
 * by default, with the shop to call or visit. Read-only for the MVP: no
 * ordering in the app.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { Icon } from "@components/ui/icon";
import { Centered, SearchBox } from "@components/ui/search-box";
import { callShop, formatPrice, listPartCategories, listParts, type CataloguePart } from "@lib/directoryApi";
import { useT } from "@lib/i18n";
import { useVehicle } from "@lib/vehicleContext";
import { palette, radii, spacing, typography } from "@theme/index";


export default function PartsScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { selectedVehicle } = useVehicle();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  // On by default: a part that won't fit the driver's car is the wrong answer.
  const [fitOnly, setFitOnly] = useState(true);
  const [parts, setParts] = useState<CataloguePart[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const vehicleLabel = selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim() : null;
  const fit = fitOnly && selectedVehicle ? { make: selectedVehicle.make, model: selectedVehicle.model, year: selectedVehicle.year } : {};

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setParts(await listParts({ search: search.trim() || undefined, category: category ?? undefined, ...fit }));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, fitOnly, selectedVehicle?.make, selectedVehicle?.model, selectedVehicle?.year]);

  useEffect(() => {
    const id = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  useEffect(() => {
    listPartCategories()
      .then((rows) => setCategories(rows.map((r) => r.category)))
      .catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: palette.surface,
          borderBottomWidth: categories.length ? 0 : 1,
          borderBottomColor: palette.border,
          gap: spacing.md,
        }}
      >
        <Text style={{ ...typography.h1, color: palette.text }}>{t("driver.directory.partsTitle")}</Text>
        <SearchBox value={search} onChange={setSearch} placeholder={t("driver.directory.searchParts")} />
      </View>

      {categories.length > 0 ? (
        <View style={{ backgroundColor: palette.surface, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            <Chip label={t("driver.directory.allCategories")} active={category === null} onPress={() => setCategory(null)} />
            {categories.map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => setCategory(category === c ? null : c)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {loading && !parts ? (
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
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + NAV_BAR_HEIGHT + spacing.xl }} keyboardShouldPersistTaps="handled">
          {vehicleLabel ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                backgroundColor: fitOnly ? palette.brandSoft : palette.surfaceMuted,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              }}
            >
              <Icon name={fitOnly ? "CircleCheck" : "Info"} size={14} color={fitOnly ? palette.brand : palette.textMuted} />
              <Text style={{ ...typography.micro, color: fitOnly ? palette.brand : palette.textMuted, flex: 1 }}>
                {fitOnly ? t("driver.directory.fitOn", { vehicle: vehicleLabel }) : t("driver.directory.fitOff")}
              </Text>
              <Switch
                value={fitOnly}
                onValueChange={setFitOnly}
                trackColor={{ false: palette.border, true: palette.brand }}
                thumbColor={palette.surface}
                accessibilityLabel={t("driver.directory.fitA11y", { vehicle: vehicleLabel })}
              />
            </View>
          ) : null}
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("driver.directory.partsCount", { count: parts?.length ?? 0 })}</Text>
          {parts && parts.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}>
              <Icon name="Package" size={30} color={palette.textMuted} />
              <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
                {fitOnly && vehicleLabel ? t("driver.directory.noPartsForCar", { vehicle: vehicleLabel }) : t("driver.directory.noParts")}
              </Text>
              {fitOnly && vehicleLabel ? (
                <Pressable onPress={() => setFitOnly(false)} accessibilityRole="button">
                  <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{t("driver.directory.showAllParts")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            parts?.map((p) => <PartCard key={p.id} part={p} />)
          )}
        </ScrollView>
      )}

      <BottomNavBar activeTab="parts" />
    </View>
  );
}

function fitsLabel(part: CataloguePart): string | null {
  if (part.universal) return null;
  const f = part.fitments.slice(0, 2).map((x) => {
    const years = x.yearFrom && x.yearTo ? ` ${x.yearFrom}–${x.yearTo}` : x.yearFrom ? ` ${x.yearFrom}+` : "";
    return `${x.make}${x.model ? ` ${x.model}` : ""}${years}`;
  });
  return f.length ? f.join(", ") + (part.fitments.length > 2 ? "…" : "") : null;
}

function PartCard({ part }: { part: CataloguePart }) {
  const t = useT();
  const fits = fitsLabel(part);
  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.md, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }} numberOfLines={2}>
            {part.name}
          </Text>
          <Text style={{ ...typography.micro, color: palette.textMuted }} numberOfLines={1}>
            {[part.brand, part.category, part.oemNumber ?? part.partNumber].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>{formatPrice(part.price, part.shop.currency)}</Text>
          <Text style={{ ...typography.micro, color: part.inStock ? palette.success : palette.textMuted }}>
            {part.inStock ? t("driver.directory.inStock") : t("driver.directory.onOrder")}
          </Text>
        </View>
      </View>
      <Text style={{ ...typography.micro, color: palette.textMuted }}>
        {part.universal ? t("driver.directory.fitsAll") : fits ? t("driver.directory.fits", { list: fits }) : ""}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Icon name="Store" size={14} color={palette.textMuted} />
        <Text style={{ ...typography.micro, color: palette.text, flex: 1 }} numberOfLines={1}>
          {part.shop.name}
          {part.shop.city ? ` · ${part.shop.city}` : ""}
        </Text>
        {part.shop.phone ? (
          <Pressable
            onPress={() => callShop(part.shop.phone!).catch((e) => Alert.alert(t("driver.directory.callFailedTitle"), (e as Error).message))}
            accessibilityRole="button"
            accessibilityLabel={t("driver.directory.callA11y", { name: part.shop.name })}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <Icon name="Phone" size={14} color={palette.brand} />
            <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "600" }}>{t("driver.directory.callShop")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: active ? palette.brand : palette.border,
        backgroundColor: active ? palette.brandSoft : palette.surface,
      }}
    >
      <Text style={{ ...typography.micro, color: active ? palette.brand : palette.text, fontWeight: active ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}
