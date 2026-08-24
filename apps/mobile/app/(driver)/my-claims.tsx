import { useCallback, useState, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { listMyClaims, type ClaimSummary } from "@lib/claims-api";

/** `captures.status` values from the claims-privacy backend, in driver-facing terms. */
function statusLabel(status: string): string {
  if (status === "uploading") return "In Progress";
  if (status === "processing") return "Submitted";
  if (status === "pending_review") return "Pending Review";
  if (status === "approved") return "Approved";
  return status;
}

export default function MyClaimsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useVehicle();
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Bumped per load and again on blur/unmount, so a response from a previous
  // visit or a superseded retry cannot overwrite the current list.
  const loadId = useRef(0);
  const focused = useRef(true);

  // Shared by focus and by the error state's Try again button, so a failed load
  // is recoverable without backing out of the screen and returning to it.
  const load = useCallback(() => {
    setError("");
    // Signed out, listMyClaims() resolves to [] — which would render as
    // "No claims yet." rather than "you are not signed in".
    if (!user) {
      setClaims([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++loadId.current;
    const isCurrent = () => focused.current && id === loadId.current;
    void listMyClaims()
      .then((result) => {
        if (isCurrent()) setClaims(result);
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Could not reach the claims service."
        );
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      load();
      return () => {
        focused.current = false;
      };
    }, [load])
  );

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
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>My Claims</Text>
          {user && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{user.name}</Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {!user ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="User" size={48} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              Sign in to see the claims filed on your account.
            </Text>
            <Pressable
              onPress={() => router.push("/(driver)/auth")}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              style={({ pressed }) => ({
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xl,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                Sign In / Register
              </Text>
            </Pressable>
          </View>
        ) : loading ? (
          <ActivityIndicator size="large" color={palette.brand} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="TriangleAlert" size={40} color={palette.danger} />
            <Text style={{ ...typography.body, color: palette.text, textAlign: "center" }}>
              Couldn&apos;t load your claims
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
              {error}
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
              Check your connection and try again — no claim has been lost.
            </Text>
            <Pressable
              onPress={load}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={({ pressed }) => ({
                backgroundColor: pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xl,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Try again</Text>
            </Pressable>
          </View>
        ) : claims.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 60, gap: spacing.md }}>
            <Icon name="FileText" size={48} color={palette.border} />
            <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
              No claims yet.
            </Text>
          </View>
        ) : (
          claims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radii.sm,
        backgroundColor: palette.homeBackground,
      }}
    >
      <Text style={{ ...typography.micro, color: palette.text, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function ClaimCard({ claim }: { claim: ClaimSummary }) {
  const dateLine = claim.capturedAtDisplayLocal ?? new Date(claim.createdAt).toLocaleString();
  const chips = [claim.policyNumber, claim.vehicleRegNo].filter(Boolean) as string[];

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
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
          <Icon name="FileText" size={22} color={palette.brand} />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>
              {claim.vehicleModel || "Vehicle claim"}
            </Text>
            <View
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
                borderRadius: radii.pill,
                backgroundColor: palette.brandSoft,
              }}
            >
              <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "700" }}>
                {statusLabel(claim.status)}
              </Text>
            </View>
          </View>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{dateLine}</Text>
        </View>
      </View>

      {chips.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            gap: spacing.sm,
            flexWrap: "wrap",
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: palette.border,
          }}
        >
          {chips.map((chip) => (
            <Chip key={chip} label={chip} />
          ))}
        </View>
      )}

      {claim.locationLabel && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.xs }}>
          <Icon name="MapPin" size={14} color={palette.textMuted} style={{ marginTop: 2 }} />
          <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
            {claim.locationLabel}
          </Text>
        </View>
      )}
    </View>
  );
}
