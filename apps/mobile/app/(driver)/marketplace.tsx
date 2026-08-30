/**
 * The store: everything on one screen, with Parts and Garages as switchable
 * panels.
 *
 * This replaces a category grid that made a driver choose a component before
 * seeing anything. Browsing is not the same task as acting on a worn part -
 * someone opening the store usually wants to look around, and the old flow
 * asked them to answer a question they had not come to ask. Entering from a
 * health screen still goes to the per-component view (order-parts), which
 * carries the advice and price benchmark that only make sense there.
 *
 * FITMENT IS ON BY DEFAULT, BUT IT IS A SWITCH. Showing a part that cannot go
 * on this car is a wrong answer that only reveals itself at the counter, so
 * the filter starts on. It is not the only question people have though -
 * checking what a part costs in general, or pricing a car they are thinking of
 * buying, needs the full shelf - and a permanently-on filter made those
 * impossible while looking identical to an unfiltered list. The label always
 * states which of the two is on screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  browseMarketplace,
  formatLkr,
  type MarketplaceBrowse,
  type MarketplaceGarage,
  type MarketplacePart,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";
import { useT } from "@lib/i18n";

type Panel = "parts" | "garages";

const COMPONENT_LABEL_KEYS: Record<string, string> = {
  brake: "driver.marketplace.componentBrake",
  engine: "driver.marketplace.componentEngine",
  tire: "driver.marketplace.componentTire",
  battery: "driver.marketplace.componentBattery",
};

const COMPONENT_ICON: Record<string, IconName> = {
  brake: "Disc",
  engine: "Gauge",
  tire: "Circle",
  battery: "Battery",
};

export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { selectedVehicle } = useVehicle();

  const [panel, setPanel] = useState<Panel>("parts");
  const [component, setComponent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<MarketplaceBrowse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // On by default: showing a driver a part that will not fit their car is a
  // worse failure than making them tap once to widen the search.
  const [fitOnly, setFitOnly] = useState(true);

  const vehicleDescription = selectedVehicle
    ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim()
    : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const result = await browseMarketplace({
      component: component ?? undefined,
      vehicle: fitOnly ? vehicleDescription : undefined,
      search: search.trim() || undefined,
    });
    setData(result);
    setFailed(result === null);
    setLoading(false);
  }, [component, vehicleDescription, search, fitOnly]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  // Chips come from the FIRST unfiltered response and are then held steady:
  // rebuilding them from every response would make a chip vanish the moment
  // you tapped it, since the response then only contains that component.
  const [chips, setChips] = useState<string[]>([]);
  useEffect(() => {
    if (!component && !search && data?.components.length) setChips(data.components);
  }, [component, search, data, fitOnly]);

  const parts = data?.parts ?? [];
  const garages = data?.garages ?? [];

  const countLabel = useMemo(() => {
    if (loading) return "";
    return panel === "parts"
      ? t("driver.marketplace.partsCount", { count: parts.length })
      : t("driver.marketplace.garagesCount", { count: garages.length });
  }, [loading, panel, parts.length, garages.length, t]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      {/* Header */}
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
        <Text style={{ ...typography.h1, color: palette.text }}>{t("driver.marketplace.title")}</Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            backgroundColor: palette.surfaceMuted,
            borderRadius: radii.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <Icon name="Search" size={18} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={panel === "parts" ? t("driver.marketplace.searchParts") : t("driver.marketplace.searchGarages")}
            placeholderTextColor={palette.textMuted}
            style={{ flex: 1, ...typography.body, color: palette.text, paddingVertical: 2 }}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Icon name="X" size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Panel switch */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: palette.surfaceMuted,
            borderRadius: radii.pill,
            padding: 4,
          }}
        >
          {(["parts", "garages"] as Panel[]).map((key) => {
            const active = panel === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPanel(key)}
                style={{
                  flex: 1,
                  paddingVertical: spacing.sm + 2,
                  borderRadius: radii.pill,
                  alignItems: "center",
                  backgroundColor: active ? palette.surface : "transparent",
                }}
              >
                <Text
                  style={{
                    ...typography.bodyStrong,
                    color: active ? palette.brand : palette.textMuted,
                  }}
                >
                  {key === "parts" ? t("driver.marketplace.panelParts") : t("driver.marketplace.panelGarages")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Category chips */}
      {chips.length > 0 ? (
        <View style={{ backgroundColor: palette.surface, paddingBottom: spacing.sm }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
          >
            <Chip label={t("driver.marketplace.chipAll")} active={component === null} onPress={() => setComponent(null)} />
            {chips.map((key) => (
              <Chip
                key={key}
                label={t(COMPONENT_LABEL_KEYS[key] ?? key)}
                icon={COMPONENT_ICON[key]}
                active={component === key}
                onPress={() => setComponent(component === key ? null : key)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={palette.brand} />
        </View>
      ) : failed ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md }}>
          <Icon name="CloudOff" size={32} color={palette.textMuted} />
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
            {t("driver.marketplace.loadError")}
          </Text>
          <Pressable onPress={load}>
            <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{t("driver.marketplace.retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: insets.bottom + NAV_BAR_HEIGHT + spacing.xl,
          }}
        >
          {/* Fitment switch.
              Filtering to the selected car is the right default - a part that
              cannot go on this vehicle is a wrong answer that only reveals
              itself at the counter. But it is not the only question people
              have: checking what a part costs in general, pricing a car they
              are thinking of buying, or sourcing for someone else all need the
              full shelf, and a permanently-on filter made those impossible
              while looking identical to an unfiltered list.

              So it stays on by default and becomes a deliberate choice to turn
              off, with the label always saying which of the two you are
              looking at. */}
          {panel === "parts" && vehicleDescription ? (
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
              <Icon
                name={fitOnly ? "CircleCheck" : "Info"}
                size={14}
                color={fitOnly ? palette.brand : palette.textMuted}
              />
              <Text
                style={{
                  ...typography.micro,
                  color: fitOnly ? palette.brand : palette.textMuted,
                  flex: 1,
                }}
              >
                {fitOnly
                  ? t("driver.marketplace.fitOnlyOn", { vehicle: vehicleDescription })
                  : t("driver.marketplace.fitOnlyOff")}
              </Text>
              <Switch
                value={fitOnly}
                onValueChange={setFitOnly}
                trackColor={{ false: palette.border, true: palette.brand }}
                thumbColor={palette.surface}
                accessibilityLabel={t("driver.marketplace.fitSwitchA11y", { vehicle: vehicleDescription })}
              />
            </View>
          ) : null}

          {countLabel ? (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{countLabel}</Text>
          ) : null}

          {panel === "parts" ? (
            parts.length ? (
              parts.map((part) => <PartRow key={part.id} part={part} />)
            ) : (
              <EmptyState
                icon="PackageSearch"
                message={
                  search
                    ? t("driver.marketplace.noPartsSearch", { query: search })
                    : fitOnly && vehicleDescription
                      ? t("driver.marketplace.noPartsForVehicle", { vehicle: vehicleDescription })
                      : t("driver.marketplace.noParts")
                }
                actionLabel={
                  !search && fitOnly && vehicleDescription ? t("driver.marketplace.showAllParts") : undefined
                }
                onAction={
                  !search && fitOnly && vehicleDescription ? () => setFitOnly(false) : undefined
                }
              />
            )
          ) : garages.length ? (
            garages.map((garage) => <GarageRow key={garage.id} garage={garage} />)
          ) : (
            <EmptyState
              icon="MapPinOff"
              message={search ? t("driver.marketplace.noGaragesSearch", { query: search }) : t("driver.marketplace.noGarages")}
            />
          )}
        </ScrollView>
      )}

      <BottomNavBar activeTab="store" />
    </View>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: IconName;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.pill,
        borderWidth: 1.5,
        borderColor: active ? palette.brand : palette.border,
        backgroundColor: active ? palette.brand : palette.surface,
      }}
    >
      {icon ? (
        <Icon name={icon} size={13} color={active ? palette.textOnBrand : palette.textMuted} />
      ) : null}
      <Text
        style={{
          ...typography.caption,
          fontWeight: "700",
          color: active ? palette.textOnBrand : palette.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PartRow({ part }: { part: MarketplacePart }) {
  const t = useT();
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/(driver)/auto-schedule",
          params: {
            component: part.component,
            partName: part.name,
            partSubtitle: part.brand ?? part.fits_note ?? "",
            partPrice: formatLkr(part.price_lkr),
          },
        })
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: spacing.md,
        gap: 6,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radii.md,
            backgroundColor: palette.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={COMPONENT_ICON[part.component] ?? "Package"} size={18} color={palette.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }} numberOfLines={2}>
            {part.name}
          </Text>
          {part.brand ? (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{part.brand}</Text>
          ) : null}
        </View>
        <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
          {formatLkr(part.price_lkr)}
        </Text>
      </View>

      {part.fits_note ? (
        <Text style={{ ...typography.micro, color: palette.textMuted }} numberOfLines={1}>
          {t("driver.marketplace.fitsNote", { note: part.fits_note })}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text
          style={{
            ...typography.micro,
            color: part.in_stock ? palette.success : palette.danger,
            fontWeight: "700",
          }}
        >
          {part.in_stock ? t("driver.marketplace.inStock") : t("driver.marketplace.outOfStock")}
        </Text>
        {part.supplier ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }} numberOfLines={1}>
            · {part.supplier}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function GarageRow({ garage }: { garage: MarketplaceGarage }) {
  const t = useT();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: spacing.md,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }} numberOfLines={1}>
          {garage.name}
        </Text>
        {garage.verified ? <Icon name="BadgeCheck" size={16} color={palette.success} /> : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
        {garage.city ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }}>{garage.city}</Text>
        ) : null}
        {garage.distance_km != null ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }}>
            {t("driver.marketplace.distanceAway", { km: garage.distance_km })}
          </Text>
        ) : null}
        {garage.rating != null ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }}>
            · {garage.rating.toFixed(1)} ★
          </Text>
        ) : null}
      </View>

      {garage.opening_hours ? (
        <Text style={{ ...typography.micro, color: palette.textMuted }}>
          {t("driver.marketplace.openingHours", { hours: garage.opening_hours })}
        </Text>
      ) : null}
    </View>
  );
}

function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  message: string;
  // An empty shelf caused by a filter is not really empty, and saying so
  // without offering the way out leaves the driver to guess that the switch
  // above is what did it.
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}>
      <Icon name={icon} size={30} color={palette.textMuted} />
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
