import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LanguagePicker } from "@components/ui/language-picker";
import { BottomNavBar } from "@components/ui/bottom-nav-bar";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { INSURANCE_CARD_BORDER_ACCENT } from "@/features/guided-capture/capture-ui-theme";
import { useVehicle } from "@lib/vehicleContext";
import { unpairElm327 } from "@lib/elm327";
import { endTrip, isTripActive } from "@lib/tripRecorder";
import { listMyClaims } from "@lib/claims-api";
import { useTabBack } from "@lib/useTabBack";
import {
  formatLicenceNumber,
  formatNicNumber,
  isValidLicenceNumber,
  isValidNicNumber,
} from "@lib/insurer-field-format";

export default function ProfileScreen() {
  const { canGoBack, goBack } = useTabBack();
  const insets = useSafeAreaInsets();
  const { user, vehicles, updateProfile, logout } = useVehicle();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [location, setLocation] = useState(user?.location ?? "");
  // NIC and licence live on the profile and gate the insurance flow, but had
  // nowhere to be entered except deep inside Manage Vehicles.
  const [licenceNumber, setLicenceNumber] = useState(user?.licenceNumber ?? "");
  const [nicNumber, setNicNumber] = useState(user?.nicNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [claimsCount, setClaimsCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listMyClaims()
        .then((claims) => {
          if (!cancelled) setClaimsCount(claims.length);
        })
        .catch(() => {
          if (!cancelled) setClaimsCount(null);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
        <View
          style={{
            paddingTop: insets.top + spacing.lg,
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.md,
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
          <Text style={{ ...typography.body, color: palette.text }}>Profile</Text>
        </View>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xxl }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: palette.brandSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="User" size={36} color={palette.brand} />
          </View>
          <Text style={{ ...typography.h2, color: palette.text }}>Not signed in</Text>
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
            Sign in to manage your vehicles and track health data.
          </Text>
          <Pressable
            onPress={() => router.push("/(driver)/auth")}
            style={({ pressed }) => ({
              backgroundColor: pressed ? palette.brandPressed : palette.brand,
              borderRadius: radii.lg,
              paddingVertical: spacing.md + 2,
              paddingHorizontal: spacing.xxl,
              alignItems: "center",
            })}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
              Sign In / Register
            </Text>
          </Pressable>
        </View>
        <BottomNavBar activeTab="profile" />
      </View>
    );
  }

  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSave() {
    if (!name.trim()) { setError("Name cannot be empty"); return; }
    // Both fields are optional (the profile shows "Not added" when empty), so only
    // validate a non-empty value — matches the Add Insurer screen's same rule using
    // the same shared format, which is why these two checks were silently having no
    // effect: nothing here was ever calling them.
    if (nicNumber.trim() && !isValidNicNumber(nicNumber.trim())) {
      setError("Enter a valid NIC number — 12 digits, or 9 digits followed by V.");
      return;
    }
    if (licenceNumber.trim() && !isValidLicenceNumber(licenceNumber.trim())) {
      setError("Enter a valid driving licence number — 1 letter followed by 7 digits.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        location: location.trim(),
        licenceNumber: licenceNumber.trim(),
        nicNumber: nicNumber.trim(),
      });
      setSuccess(true);
      setEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message ?? "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  function handleEditToggle() {
    // Seed on open as well as on cancel: the initial state was captured before
    // the session finished restoring, so opening the form with stale "" values
    // would save empty phone/location over the stored ones.
    setName(user?.name ?? "");
    setPhone(user?.phone ?? "");
    setLocation(user?.location ?? "");
    setError("");
    setEditing(!editing);
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header card — same orange used for the Insurance flow's status
            badges (INSURANCE_CARD_BORDER_ACCENT), so the two match; replaces
            the plain top row + identity row with one designed panel:
            identity, Edit, and the two most sensitive ID fields so they
            don't need their own row further down. */}
        <View
          style={{
            backgroundColor: INSURANCE_CARD_BORDER_ACCENT,
            borderRadius: radii.xl,
            padding: spacing.lg,
            gap: spacing.md,
            boxShadow: "0 8px 20px rgba(252, 124, 77, 0.35)",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {canGoBack && (
                <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
                  <Icon name="ChevronLeft" size={18} color={palette.textOnBrand} />
                </Pressable>
              )}
              <Text style={{ ...typography.micro, color: palette.textOnBrand, fontWeight: "700" }}>
                DRIVER PROFILE
              </Text>
            </View>
            <Pressable
              onPress={handleEditToggle}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radii.pill,
                backgroundColor: pressed ? palette.homeBackground : palette.surface,
              })}
            >
              <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
                {editing ? "Cancel" : "Edit"}
              </Text>
            </Pressable>
          </View>

          {!editing && (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: palette.surface,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: "700", color: palette.brand }}>
                    {initials}
                  </Text>
                </View>
                <Text style={{ flex: 1, ...typography.h1, color: palette.textOnBrand }}>
                  {user.name}
                </Text>
              </View>

              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.25)" }} />

              <View style={{ flexDirection: "row" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...typography.micro, color: "rgba(255,255,255,0.75)" }}>NIC</Text>
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    {user.nicNumber ?? "Not added"}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...typography.micro, color: "rgba(255,255,255,0.75)" }}>LICENCE</Text>
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    {user.licenceNumber ?? "Not added"}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Success banner */}
        {success && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: radii.md,
              backgroundColor: palette.successSoft,
            }}
          >
            <Icon name="CheckCircle" size={16} color={palette.success} />
            <Text style={{ ...typography.caption, color: palette.success, fontWeight: "600" }}>
              Profile updated successfully
            </Text>
          </View>
        )}

        {/* Edit form */}
        {editing && (
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: radii.lg,
              padding: spacing.lg,
              gap: spacing.md,
              boxShadow: "0 2px 10px rgba(15, 15, 15, 0.06)",
            }}
          >
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>Edit Profile</Text>
            <Field label="Full Name *" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
            <Field label="Email" value={user.email} editable={false} placeholder="" />
            <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+94 77 123 4567" keyboardType="phone-pad" />
            <Field label="Location" value={location} onChangeText={setLocation} placeholder="Malabe, Sri Lanka" autoCapitalize="words" />
            <Field
              label="NIC number"
              value={nicNumber}
              onChangeText={(t) => setNicNumber(formatNicNumber(t))}
              placeholder="200012345678"
              autoCapitalize="characters"
            />
            <Field
              label="Driving licence number"
              value={licenceNumber}
              onChangeText={(t) => setLicenceNumber(formatLicenceNumber(t))}
              placeholder="B1234567"
              autoCapitalize="characters"
            />

            {error ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: radii.md,
                  backgroundColor: palette.dangerSoft,
                }}
              >
                <Icon name="AlertCircle" size={14} color={palette.danger} />
                <Text style={{ ...typography.caption, color: palette.danger, flex: 1 }}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => ({
                backgroundColor: saving ? palette.textMuted : pressed ? palette.brandPressed : palette.brand,
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: spacing.sm,
              })}
            >
              {saving && <ActivityIndicator size="small" color={palette.textOnBrand} />}
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                Save Changes
              </Text>
            </Pressable>
          </View>
        )}

        {!editing && (
          <>
            {/* Stats row — plain white cards, separate from the orange header. */}
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Pressable
                onPress={() => router.push("/(driver)/manage-vehicles")}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: pressed ? palette.homeBackground : palette.surface,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                  gap: 2,
                  boxShadow: "0 2px 8px rgba(15, 15, 15, 0.05)",
                })}
              >
                <Text style={{ ...typography.body, color: palette.text }}>My Vehicles</Text>
                <Text style={{ fontSize: 34, fontWeight: "800", color: palette.text }}>
                  {vehicles.length}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>registered</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/(driver)/my-claims")}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: pressed ? palette.homeBackground : palette.surface,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                  gap: 2,
                  boxShadow: "0 2px 8px rgba(15, 15, 15, 0.05)",
                })}
              >
                <Text style={{ ...typography.body, color: palette.text }}>Claims</Text>
                <Text style={{ fontSize: 34, fontWeight: "800", color: palette.text }}>
                  {claimsCount ?? "—"}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>submitted</Text>
              </Pressable>
            </View>

            {/* Account Details — email/phone/location as plain label-left,
                value-right rows; NIC/Licence already live in the header. */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.micro, color: palette.textMuted, fontWeight: "700", marginLeft: spacing.xs }}>
                ACCOUNT DETAILS
              </Text>
              <View
                style={{
                  backgroundColor: palette.surface,
                  borderRadius: radii.lg,
                  overflow: "hidden",
                  boxShadow: "0 2px 10px rgba(15, 15, 15, 0.06)",
                }}
              >
                <AccountRow label="Email" value={user.email} />
                <AccountRow label="Phone" value={user.phone} onAdd={handleEditToggle} />
                <AccountRow label="Location" value={user.location} onAdd={handleEditToggle} />
                <LanguagePicker variant="row" />
              </View>
            </View>

            {/* Coming soon — dashed placeholders, no icons, matching a
                deliberately quieter/disabled treatment.
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <ComingSoonCard label="Privacy Policy" />
              <ComingSoonCard label="Help & Support" />
            </View>
            */}

            {/* Log Out — solid danger red fill with white text, so it's
                unmistakably the one destructive action on this screen. This
                is the only Log Out button in the app — My Vehicles doesn't
                have its own. */}
            <Pressable
              onPress={async () => {
                // A recording left running would keep sampling under the previous
                // driver's id — same teardown order as Home's Log out.
                if (isTripActive()) await endTrip().catch(() => {});
                unpairElm327();
                await logout();
                router.replace("/");
              }}
              accessibilityRole="button"
              accessibilityLabel="Log out"
              style={({ pressed }) => ({
                alignItems: "center",
                paddingVertical: spacing.md,
                borderRadius: radii.lg,
                backgroundColor: palette.danger,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Log Out</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <BottomNavBar activeTab="profile" />
    </View>
  );
}

function AccountRow({
  label, value, onAdd, divider = true,
}: { label: string; value?: string | null; onAdd?: () => void; divider?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: spacing.lg,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: palette.border,
      }}
    >
      <Text style={{ ...typography.body, color: palette.textMuted }}>{label}</Text>
      {value ? (
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{value}</Text>
      ) : (
        <Pressable onPress={onAdd} hitSlop={8}>
          <Text style={{ ...typography.bodyStrong, color: palette.brand }}>+ Add</Text>
        </Pressable>
      )}
    </View>
  );
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: palette.border,
        padding: spacing.lg,
        gap: 2,
      }}
    >
      <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>{label}</Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>Soon</Text>
    </View>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, editable = true,
}: {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
  editable?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        editable={editable}
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: editable ? palette.border : palette.homeBackground,
          borderRadius: radii.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          ...typography.body,
          color: editable ? palette.text : palette.textMuted,
          backgroundColor: editable ? palette.surface : palette.homeBackground,
        }}
      />
    </View>
  );
}
