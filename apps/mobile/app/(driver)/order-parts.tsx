import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { ComponentKey } from "@lib/maintenanceApi";

interface Part {
  id: string;
  name: string;
  year: number;
  mileage: string;
  age: string;
  model: string;
  price: string;
  rating?: number;
}

const PARTS_BY_COMPONENT: Record<ComponentKey, Part[]> = {
  brake: [
    { id: "1", name: "Break Pads", year: 2026, mileage: "10,000 Km", age: "1 year ago", model: "Toyota AquaPlus", price: "LKR 12,000" },
    { id: "2", name: "Break Pads", year: 2025, mileage: "15,000 Km", age: "3 days ago", model: "Toyota AquaPlus", price: "LKR 12,800" },
    { id: "3", name: "Break Pads", year: 2026, mileage: "10,000 Km", age: "45 days ago", model: "Toyota AquaPlus", price: "LKR 12,000" },
    { id: "4", name: "Break Pads", year: 2024, mileage: "12,000 Km", age: "2 months ago", model: "Toyota AquaPlus", price: "LKR 11,500" },
  ],
  engine: [
    { id: "1", name: "Engine Oil 5W-30", year: 2026, mileage: "5,000 Km", age: "1 week ago", model: "Toyota AquaPlus", price: "LKR 4,500" },
    { id: "2", name: "Engine Oil 0W-20", year: 2026, mileage: "5,000 Km", age: "2 weeks ago", model: "Toyota AquaPlus", price: "LKR 5,200" },
    { id: "3", name: "Oil Filter", year: 2026, mileage: "5,000 Km", age: "1 week ago", model: "Toyota AquaPlus", price: "LKR 850" },
    { id: "4", name: "Full Service Kit", year: 2025, mileage: "10,000 Km", age: "1 month ago", model: "Toyota AquaPlus", price: "LKR 9,800" },
  ],
  tire: [
    { id: "1", name: "Tyre 175/65R15", year: 2026, mileage: "50,000 Km", age: "New", model: "Toyota AquaPlus", price: "LKR 8,500" },
    { id: "2", name: "Tyre 185/60R15", year: 2026, mileage: "60,000 Km", age: "New", model: "Toyota AquaPlus", price: "LKR 9,200" },
    { id: "3", name: "Tyre 175/65R15", year: 2025, mileage: "50,000 Km", age: "6 months ago", model: "Toyota AquaPlus", price: "LKR 7,800" },
    { id: "4", name: "Tyre Set (4)", year: 2026, mileage: "50,000 Km", age: "New", model: "Toyota AquaPlus", price: "LKR 32,000" },
  ],
  battery: [
    { id: "1", name: "Battery 12V 45Ah", year: 2026, mileage: "—", age: "New", model: "Toyota AquaPlus", price: "LKR 18,500" },
    { id: "2", name: "Battery 12V 55Ah", year: 2026, mileage: "—", age: "New", model: "Toyota AquaPlus", price: "LKR 22,000" },
    { id: "3", name: "HV Battery Cell", year: 2025, mileage: "—", age: "3 months ago", model: "Toyota AquaPlus", price: "LKR 45,000" },
    { id: "4", name: "Battery 12V 45Ah", year: 2025, mileage: "—", age: "1 year ago", model: "Toyota AquaPlus", price: "LKR 16,000" },
  ],
};

const TITLES: Record<ComponentKey, string> = {
  brake: "Order Breakpads",
  engine: "Order Engine Oil",
  tire: "Order Tyres",
  battery: "Order Battery",
};

export default function OrderPartsScreen() {
  const insets = useSafeAreaInsets();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  const parts = PARTS_BY_COMPONENT[key];

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
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
          {TITLES[key]}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 100,
        }}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Suggested parts</Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {parts.map((part) => (
            <PartCard key={part.id} part={part} />
          ))}
        </View>
      </ScrollView>

      {/* Go Back button */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + spacing.md,
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
    </View>
  );
}

function PartCard({ part }: { part: Part }) {
  return (
    <Pressable
      style={({ pressed }) => ({
        width: "47%",
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: palette.border,
      })}
    >
      {/* Image placeholder */}
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

      {/* Price badge */}
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
          {part.price}
        </Text>
      </View>

      <View style={{ padding: spacing.md, gap: 3 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }} numberOfLines={1}>
          {part.name}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon name="Calendar" size={11} color={palette.textMuted} />
          <Text style={{ ...typography.micro, color: palette.textMuted }}>{part.year}</Text>
        </View>

        {part.mileage !== "—" && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="Gauge" size={11} color={palette.textMuted} />
            <Text style={{ ...typography.micro, color: palette.textMuted }}>{part.mileage}</Text>
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon name="Clock" size={11} color={palette.textMuted} />
          <Text style={{ ...typography.micro, color: palette.textMuted }}>{part.age}</Text>
        </View>

        <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "600" }} numberOfLines={1}>
          {part.model}
        </Text>
      </View>
    </Pressable>
  );
}
