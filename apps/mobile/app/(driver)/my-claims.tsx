import { useCallback, useState, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Chip } from "@components/ui/chip";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import { listMyClaims, type ClaimSummary } from "@lib/claims-api";

/** `captures.status` values, in driver-facing terms. */
function statusLabel(status: string): string {
  if (status === "uploading") return "In Progress";
  if (status === "processing") return "Submitted";
  if (status === "pending_review") return "Pending Review";
  if (status === "approved") return "Approved";
  return status;
}

/** Same status set as statusLabel, mapped to the app's shared Badge tones —
 * matches the Insurance screen's soft-tint/no-border pill treatment, using
 * this app's own palette instead of that screen's separate hex constants. */
function statusTone(status: string): "neutral" | "brand" | "warning" | "success" {
  if (status === "processing") return "brand";
  if (status === "pending_review") return "warning";
  if (status === "approved") return "success";
  return "neutral";
}

/** Same tone → color mapping as Badge's own (not exported), reused here to
 * tint each ClaimCard's icon square by status so it reads at a glance
 * before the badge text is even read. */
function iconColorsForTone(tone: "neutral" | "brand" | "warning" | "success") {
  switch (tone) {
    case "success":
      return { bg: palette.successSoft, fg: palette.success };
    case "warning":
      return { bg: palette.warningSoft, fg: palette.warning };
    case "brand":
      return { bg: palette.brandSoft, fg: palette.brand };
    default:
      return { bg: palette.surfaceMuted, fg: palette.textMuted };
  }
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
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          paddingTop: insets.top + spacing.lg,
          gap: spacing.lg,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {/* Same true-pill back/home header as the emergency flow's
            "What's wrong?" screen, followed by a big bold title — plain
            background, no tinted panel. */}
        <HeaderBar />

        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...typography.display, color: palette.text, fontSize: 28 }}>My Claims</Text>
          {user && (
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {loading
                ? user.name
                : `${claims.length} claim${claims.length === 1 ? "" : "s"} submitted`}
            </Text>
          )}
        </View>

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

function ClaimCard({ claim }: { claim: ClaimSummary }) {
  const dateLine = claim.capturedAtDisplayLocal ?? new Date(claim.createdAt).toLocaleString();
  const chips = [claim.policyNumber, claim.vehicleRegNo].filter(Boolean) as string[];
  const iconColors = iconColorsForTone(statusTone(claim.status));

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.xl,
        gap: spacing.md,
        boxShadow: "0 2px 8px rgba(15, 15, 15, 0.05)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.lg,
            backgroundColor: iconColors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="FileText" size={26} color={iconColors.fg} />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: palette.text, flex: 1 }}>
              {claim.vehicleModel || "Vehicle claim"}
            </Text>
            <Badge label={statusLabel(claim.status)} tone={statusTone(claim.status)} uppercase={false} />
          </View>
          <Text style={{ ...typography.body, color: palette.textMuted }}>{dateLine}</Text>
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
          <Icon name="MapPin" size={16} color={palette.textMuted} style={{ marginTop: 2 }} />
          <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
            {claim.locationLabel}
          </Text>
        </View>
      )}
    </View>
  );
}
