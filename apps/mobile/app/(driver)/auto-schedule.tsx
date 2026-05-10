import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import type { ComponentKey } from "@lib/maintenanceApi";

interface Suggestion {
  id: string;
  type: "part" | "garage";
  name: string;
  subtitle: string;
  detail1: string;
  detail2: string;
  price: string;
  rating?: number;
  badge?: string;
}

const SUGGESTIONS_BY_COMPONENT: Record<ComponentKey, Suggestion[]> = {
  brake: [
    {
      id: "1",
      type: "part",
      name: "Break Pads",
      subtitle: "2026 · Toyota AquaPlus",
      detail1: "15,000 Km",
      detail2: "3 days ago",
      price: "LKR 12,800",
    },
    {
      id: "2",
      type: "garage",
      name: "Auto Mirage",
      subtitle: "Specialized in Hybrid systems",
      detail1: "4.1 ★  Malabe",
      detail2: "100+ jobs",
      price: "LKR 2,500",
      badge: "Top Rated",
    },
  ],
  engine: [
    {
      id: "1",
      type: "part",
      name: "Engine Oil 5W-30",
      subtitle: "2026 · Toyota AquaPlus",
      detail1: "5,000 Km",
      detail2: "1 week ago",
      price: "LKR 4,500",
    },
    {
      id: "2",
      type: "garage",
      name: "Auto Mirage",
      subtitle: "Specialized in Hybrid systems",
      detail1: "4.1 ★  Malabe",
      detail2: "100+ jobs",
      price: "LKR 14,800",
      badge: "Top Rated",
    },
  ],
  tire: [
    {
      id: "1",
      type: "part",
      name: "Tyre 175/65R15",
      subtitle: "2026 · Toyota AquaPlus",
      detail1: "50,000 Km",
      detail2: "New",
      price: "LKR 8,500",
    },
    {
      id: "2",
      type: "garage",
      name: "Tyre Pro Malabe",
      subtitle: "Specialized in tyres & alignment",
      detail1: "4.5 ★  Malabe",
      detail2: "200+ jobs",
      price: "LKR 1,500",
      badge: "Top Rated",
    },
  ],
  battery: [
    {
      id: "1",
      type: "part",
      name: "Battery 12V 45Ah",
      subtitle: "2026 · Toyota AquaPlus",
      detail1: "—",
      detail2: "New",
      price: "LKR 18,500",
    },
    {
      id: "2",
      type: "garage",
      name: "Auto Mirage",
      subtitle: "Specialized in Hybrid systems",
      detail1: "4.1 ★  Malabe",
      detail2: "100+ jobs",
      price: "LKR 500",
      badge: "Top Rated",
    },
  ],
};

const ASSISTANT_TEXT: Record<ComponentKey, string> = {
  brake:
    "And you can use current brakes for about 4 weeks. But better I replace within 3 months. May I schedule on next 3rd Saturday at estimated price is LKR 8,400 (brake pads) + LKR 2,500 (service) with total of LKR 10,900.",
  engine:
    "Your engine oil is showing signs of degradation. I recommend scheduling an oil change within 1 week. Estimated price is LKR 4,500 (oil) + LKR 14,800 (service) with total of LKR 19,300.",
  tire:
    "Your tyres have good remaining life. A rotation is recommended soon to extend tyre longevity. Estimated cost: LKR 1,500 for rotation service.",
  battery:
    "Battery is in good health. No immediate action needed, but a free test can confirm. Estimated test cost: LKR 500.",
};

export default function AutoScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  const suggestions = SUGGESTIONS_BY_COMPONENT[key];
  const assistantText = ASSISTANT_TEXT[key];

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
        <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>Auto Schedule</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 130,
        }}
      >
        {/* Best Suggestions */}
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Best Suggestions</Text>

        <View style={{ gap: spacing.sm }}>
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))}
        </View>

        {/* Service Assistant */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            borderWidth: 1.5,
            borderColor: palette.brand + "66",
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: palette.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Bot" size={18} color={palette.brand} />
            </View>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Service Assistant says
            </Text>
          </View>

          <Text style={{ ...typography.body, color: palette.textMuted, lineHeight: 22 }}>
            {assistantText}
          </Text>

          {/* Scheduled date chip */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: palette.brandSoft,
              alignSelf: "flex-start",
            }}
          >
            <Icon name="CalendarCheck" size={14} color={palette.brand} />
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              Next available: Sat, 17 May 2026
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom actions */}
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
          gap: spacing.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            backgroundColor: pressed ? palette.brandPressed : palette.brand,
            borderRadius: radii.lg,
            paddingVertical: spacing.md + 2,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
          })}
        >
          <Icon name="CreditCard" size={18} color={palette.textOnBrand} />
          <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
            Pay & Schedule
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: radii.lg,
              paddingVertical: spacing.md,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: palette.border,
              backgroundColor: pressed ? palette.homeBackground : "transparent",
            })}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Cancel</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: radii.lg,
              paddingVertical: spacing.md,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: palette.brand,
              backgroundColor: pressed ? palette.brandSoft : "transparent",
            })}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.brand }}>Change date</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SuggestionCard({ suggestion: s }: { suggestion: Suggestion }) {
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      {/* Icon */}
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radii.md,
          backgroundColor: palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={s.type === "garage" ? "Wrench" : "Package"}
          size={22}
          color={palette.brand}
        />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>{s.name}</Text>
          {s.badge && (
            <View
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
                borderRadius: radii.pill,
                backgroundColor: palette.successSoft,
              }}
            >
              <Text style={{ ...typography.micro, color: palette.success, fontWeight: "700" }}>
                {s.badge}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{s.subtitle}</Text>
        <Text style={{ ...typography.micro, color: palette.textMuted }}>
          {s.detail1} · {s.detail2}
        </Text>
      </View>

      <View
        style={{
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          borderRadius: radii.sm,
          backgroundColor: palette.brand,
        }}
      >
        <Text style={{ ...typography.micro, color: palette.textOnBrand, fontWeight: "700" }}>
          {s.price}
        </Text>
      </View>
    </View>
  );
}
