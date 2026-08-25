import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  formatLkr,
  getComponentMarketplace,
  type ComponentKey,
  type ComponentMarketplace,
  type MarketplaceGarage,
  type MarketplacePart,
} from "@lib/maintenanceApi";
import { BottomNavBar } from "@components/ui/bottom-nav-bar";
import { useTabBack } from "@lib/useTabBack";
import { useVehicle } from "@lib/vehicleContext";

const TITLES: Record<ComponentKey, string> = {
  brake: "Order Brake Pads",
  engine: "Order Engine Oil",
  tire: "Order Tyres",
  battery: "Order Battery",
};

const STORE_CATEGORIES: { key: ComponentKey; label: string; icon: IconName; blurb: string }[] = [
  { key: "brake", label: "Brakes", icon: "Disc", blurb: "Pads, discs & kits" },
  { key: "engine", label: "Engine", icon: "Gauge", blurb: "Oil, filters & service kits" },
  { key: "tire", label: "Tyres", icon: "Circle", blurb: "Singles & full sets" },
  { key: "battery", label: "Battery", icon: "Battery", blurb: "12V & HV cells" },
];

const VALID_KEYS = new Set<ComponentKey>(["brake", "engine", "tire", "battery"]);

export default function OrderPartsScreen() {
  const { canGoBack, goBack } = useTabBack();
  const insets = useSafeAreaInsets();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key = VALID_KEYS.has(component as ComponentKey) ? (component as ComponentKey) : undefined;

  if (!key) {
    return <StoreLanding topInset={insets.top} bottomInset={insets.bottom} />;
  }

  return <CategoryStore component={key} topInset={insets.top} bottomInset={insets.bottom} canGoBack={canGoBack} goBack={goBack} />;
}

function CategoryStore({
  component,
  topInset,
  bottomInset,
  canGoBack,
  goBack,
}: {
  component: ComponentKey;
  topInset: number;
  bottomInset: number;
  canGoBack: boolean;
  goBack: () => void;
}) {
  const { selectedVehicle } = useVehicle();
  const [data, setData] = useState<ComponentMarketplace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WITHOUT THIS THE STORE SHOWS PARTS FOR OTHER PEOPLE'S CARS. The backend
  // only filters by fitment when it is told what the vehicle is; given
  // nothing, it cannot filter and returns everything for the component. That
  // put Honda City brake pads in front of a Toyota Aqua owner - which reads as
  // a recommendation, and is only discovered to be wrong at the counter.
  const vehicleDescription = selectedVehicle
    ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim()
    : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getComponentMarketplace(component, vehicleDescription);
    setData(result);
    if (!result) setError("Could not load the parts store. Check your connection and try again.");
    setLoading(false);
  }, [component, vehicleDescription]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <View
        style={{
          paddingTop: topInset + spacing.sm,
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
        {canGoBack ? (
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="ChevronLeft" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>{TITLES[component]}</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: "center", gap: spacing.md }}>
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>{error}</Text>
          <Pressable
            onPress={load}
            style={{
              alignSelf: "center",
              borderRadius: radii.lg,
              borderWidth: 1.5,
              borderColor: palette.brand,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
            }}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.brand }}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.lg,
            paddingBottom: bottomInset + 100,
          }}
        >
          {/* What drivers were actually charged, from their own logged
              services. Shown ABOVE the catalogue deliberately: a listing is a
              quote, this is evidence, and seeing the real range first is what
              makes a listed price meaningful. Hidden entirely when the sample
              is too small - a range built from one or two invoices would read
              as a benchmark without being one. */}
          {data?.observed_prices?.is_reliable &&
          data.observed_prices.low_lkr != null &&
          data.observed_prices.high_lkr != null ? (
            <View
              style={{
                backgroundColor: palette.brandSoft,
                borderRadius: radii.lg,
                padding: spacing.md,
                gap: 4,
              }}
            >
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                What other drivers paid
              </Text>
              <Text style={{ ...typography.h3, color: palette.brand }}>
                {formatLkr(data.observed_prices.low_lkr)} –{" "}
                {formatLkr(data.observed_prices.high_lkr)}
              </Text>
              <Text style={{ ...typography.micro, color: palette.textMuted }}>
                {data.observed_prices.median_lkr != null
                  ? `Typically ${formatLkr(data.observed_prices.median_lkr)} · `
                  : ""}
                {data.observed_prices.note}
              </Text>
            </View>
          ) : null}

          <Text style={{ ...typography.bodyStrong, color: palette.text }}>Suggested parts</Text>
          {data?.parts.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              {data.parts.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  onPress={() =>
                    router.push({
                      pathname: "/(driver)/auto-schedule",
                      params: {
                        component,
                        partName: part.name,
                        partSubtitle: part.brand ?? part.fits_note ?? "",
                        partPrice: formatLkr(part.price_lkr),
                      },
                    })
                  }
                />
              ))}
            </View>
          ) : (
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {vehicleDescription
                ? `No parts listed yet that fit your ${vehicleDescription}. A garage below can source the right part.`
                : "No parts listed for this category yet."}
            </Text>
          )}

          <Text style={{ ...typography.bodyStrong, color: palette.text, marginTop: spacing.sm }}>
            Nearby garages
          </Text>
          {data?.garages.length ? (
            <View style={{ gap: spacing.md }}>
              {data.garages.map((garage) => (
                <GarageCard key={garage.id} garage={garage} component={component} />
              ))}
            </View>
          ) : (
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              No garages listed for this service yet.
            </Text>
          )}
        </ScrollView>
      )}

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: bottomInset + spacing.md,
          paddingTop: spacing.md,
          paddingHorizontal: spacing.lg,
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            borderRadius: radii.lg,
            paddingVertical: spacing.md + 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: palette.brand,
            backgroundColor: pressed ? palette.brandSoft : "transparent",
          })}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.brand }}>Go Back</Text>
        </Pressable>
      </View>
      <BottomNavBar activeTab="store" />
    </View>
  );
}

function StoreLanding({ topInset, bottomInset }: { topInset: number; bottomInset: number }) {
  const { canGoBack, goBack } = useTabBack();
  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <View
        style={{
          paddingTop: topInset + spacing.sm,
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
        {canGoBack ? (
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="ChevronLeft" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>Parts Store</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: bottomInset + 100 }}
      >
        <Text style={{ ...typography.body, color: palette.textMuted }}>
          Browse parts by category. Prices are indicative.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {STORE_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.key}
              accessibilityRole="button"
              accessibilityLabel={cat.label}
              onPress={() =>
                router.push({ pathname: "/(driver)/order-parts", params: { component: cat.key } })
              }
              style={({ pressed }) => ({
                width: "47%",
                backgroundColor: pressed ? palette.homeBackground : palette.surface,
                borderRadius: radii.lg,
                padding: spacing.lg,
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: palette.border,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radii.md,
                  backgroundColor: palette.brandSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={cat.icon} size={22} color={palette.brand} />
              </View>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>{cat.label}</Text>
              <Text style={{ ...typography.micro, color: palette.textMuted }}>{cat.blurb}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <BottomNavBar activeTab="store" />
    </View>
  );
}

function PartCard({ part, onPress }: { part: MarketplacePart; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${part.name}, ${formatLkr(part.price_lkr)}`}
      style={({ pressed }) => ({
        width: "47%",
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: palette.border,
      })}
    >
      <View
        style={{
          height: 90,
          backgroundColor: palette.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="Package" size={36} color={palette.border} />
      </View>

      <View
        style={{
          position: "absolute",
          top: spacing.sm,
          right: spacing.sm,
          backgroundColor: palette.brand,
          borderRadius: radii.sm,
          paddingHorizontal: spacing.sm,
          paddingVertical: 3,
        }}
      >
        <Text style={{ ...typography.micro, color: palette.textOnBrand, fontWeight: "700" }}>
          {formatLkr(part.price_lkr)}
        </Text>
      </View>

      <View style={{ padding: spacing.md, gap: 3 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }} numberOfLines={2}>
          {part.name}
        </Text>
        {part.brand ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }} numberOfLines={1}>
            {part.brand}
          </Text>
        ) : null}
        {part.fits_note ? (
          <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "600" }} numberOfLines={2}>
            {part.fits_note}
          </Text>
        ) : null}
        {part.rating != null ? (
          <Text style={{ ...typography.micro, color: palette.textMuted }}>{part.rating.toFixed(1)} ★</Text>
        ) : null}
        {!part.in_stock ? (
          <Text style={{ ...typography.micro, color: palette.warning }}>Out of stock</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function GarageCard({ garage, component }: { garage: MarketplaceGarage; component: ComponentKey }) {
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/(driver)/auto-schedule",
          params: { component, partName: garage.name, partSubtitle: garage.city ?? "", partPrice: garage.labour_lkr ? formatLkr(garage.labour_lkr) : "Ask garage" },
        })
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: palette.border,
        gap: spacing.xs,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="Wrench" size={18} color={palette.brand} />
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>{garage.name}</Text>
        {garage.verified ? (
          <Text style={{ ...typography.micro, color: palette.brand }}>Verified</Text>
        ) : null}
      </View>
      <Text style={{ ...typography.micro, color: palette.textMuted }}>
        {[garage.city, garage.address].filter(Boolean).join(" · ") || "Location not listed"}
      </Text>
      {garage.rating != null ? (
        <Text style={{ ...typography.micro, color: palette.textMuted }}>{garage.rating.toFixed(1)} ★</Text>
      ) : null}
      {garage.distance_km != null ? (
        <Text style={{ ...typography.micro, color: palette.textMuted }}>~{garage.distance_km} km away</Text>
      ) : null}
      {garage.opening_hours ? (
        <Text style={{ ...typography.micro, color: palette.textMuted }}>{garage.opening_hours}</Text>
      ) : null}
    </Pressable>
  );
}
