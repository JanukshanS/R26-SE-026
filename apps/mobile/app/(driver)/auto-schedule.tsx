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
      name: "Brake Pads",
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

// Generic guidance only. This screen is reachable from the parts store with no
// health context at all, so it cannot state a remaining-life figure for the
// driver's car — the component detail screen shows the measured one.
const ASSISTANT_TEXT: Record<ComponentKey, string> = {
  brake:
    "Brake pads are a wear item — go by the health score on the component screen rather than a fixed interval. Fitting is around LKR 2,500 on top of the part price shown above.",
  engine:
    "An oil and filter change is the usual first service. The labour is around LKR 14,800 on top of the oil price shown above.",
  tire:
    "Rotating tyres evens out wear and extends their life. Rotation is around LKR 1,500.",
  battery:
    "A load test is the quickest way to confirm a battery's condition before replacing it. A test is around LKR 500.",
};

/** Next upcoming Saturday, formatted "Sat, 4 Jul 2026". */
function nextSaturdayLabel(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AutoScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { component, partName, partSubtitle, partPrice } = useLocalSearchParams<{
    component: ComponentKey;
    partName?: string;
    partSubtitle?: string;
    partPrice?: string;
  }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  // The part the driver actually picked in the store, when they came from there.
  const suggestions = SUGGESTIONS_BY_COMPONENT[key].map((s) =>
    s.type === "part" && partName
      ? {
          ...s,
          name: partName,
          subtitle: partSubtitle ?? s.subtitle,
          price: partPrice ?? s.price,
        }
      : s
  );
  const assistantText = ASSISTANT_TEXT[key];
  const scheduleDate = nextSaturdayLabel();

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
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
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
            {/* A suggestion, not an availability check — nothing here queries
                the garage's calendar. */}
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              Suggested: {scheduleDate}
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
        <Text
          style={{
            ...typography.caption,
            color: palette.textMuted,
            textAlign: "center",
          }}
        >
          Booking and online payment aren&apos;t available yet — nothing has been scheduled.
          Contact the garage directly to arrange a date.
        </Text>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => ({
            borderRadius: radii.lg,
            paddingVertical: spacing.md,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: palette.border,
            backgroundColor: pressed ? palette.homeBackground : "transparent",
          })}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>Go Back</Text>
        </Pressable>
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
