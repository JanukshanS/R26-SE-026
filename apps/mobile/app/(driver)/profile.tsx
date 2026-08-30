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
import { useT } from "@lib/i18n";
import {
  formatLicenceNumber,
  formatNicNumber,
  isValidLicenceNumber,
  isValidNicNumber,
} from "@lib/insurer-field-format";

export default function ProfileScreen() {
  const { canGoBack, goBack } = useTabBack();
  const insets = useSafeAreaInsets();
  const t = useT();
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
            <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("driver.profile.back")}>
              <Icon name="ChevronLeft" size={24} color={palette.text} />
            </Pressable>
          ) : null}
          <Text style={{ ...typography.body, color: palette.text }}>{t("driver.profile.title")}</Text>
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
          <Text style={{ ...typography.h2, color: palette.text }}>{t("driver.profile.signedOutTitle")}</Text>
          <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
            {t("driver.profile.signedOutBody")}
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
              {t("driver.profile.signIn")}
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
    if (!name.trim()) { setError(t("driver.profile.errorNameRequired")); return; }
    // Both fields are optional (the profile shows "Not added" when empty), so only
    // validate a non-empty value — matches the Add Insurer screen's same rule using
    // the same shared format, which is why these two checks were silently having no
    // effect: nothing here was ever calling them.
    if (nicNumber.trim() && !isValidNicNumber(nicNumber.trim())) {
      setError(t("driver.profile.errorNic"));
      return;
    }
    if (licenceNumber.trim() && !isValidLicenceNumber(licenceNumber.trim())) {
      setError(t("driver.profile.errorLicence"));
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
      setError(err.message ?? t("driver.profile.errorUpdateFailed"));
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
                <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("driver.profile.back")}>
                  <Icon name="ChevronLeft" size={18} color={palette.textOnBrand} />
                </Pressable>
              )}
              <Text style={{ ...typography.micro, color: palette.textOnBrand, fontWeight: "700" }}>
                {t("driver.profile.headerEyebrow")}
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
                {editing ? t("driver.profile.cancel") : t("driver.profile.edit")}
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
                  <Text style={{ ...typography.micro, color: "rgba(255,255,255,0.75)" }}>{t("driver.profile.nicLabel")}</Text>
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    {user.nicNumber ?? t("driver.profile.notAdded")}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...typography.micro, color: "rgba(255,255,255,0.75)" }}>{t("driver.profile.licenceLabel")}</Text>
                  <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
                    {user.licenceNumber ?? t("driver.profile.notAdded")}
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
              {t("driver.profile.updatedBanner")}
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
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>{t("driver.profile.editHeading")}</Text>
            <Field label={t("driver.profile.fieldName")} value={name} onChangeText={setName} placeholder={t("driver.profile.fieldNamePlaceholder")} autoCapitalize="words" />
            <Field label={t("driver.profile.fieldEmail")} value={user.email} editable={false} placeholder="" />
            <Field label={t("driver.profile.fieldPhone")} value={phone} onChangeText={setPhone} placeholder={t("driver.profile.fieldPhonePlaceholder")} keyboardType="phone-pad" />
            <Field label={t("driver.profile.fieldLocation")} value={location} onChangeText={setLocation} placeholder={t("driver.profile.fieldLocationPlaceholder")} autoCapitalize="words" />
            <Field
              label={t("driver.profile.fieldNic")}
              value={nicNumber}
              onChangeText={(t) => setNicNumber(formatNicNumber(t))}
              placeholder="200012345678"
              autoCapitalize="characters"
            />
            <Field
              label={t("driver.profile.fieldLicence")}
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
                {t("driver.profile.saveChanges")}
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
                <Text style={{ ...typography.body, color: palette.text }}>{t("driver.profile.statVehicles")}</Text>
                <Text style={{ fontSize: 34, fontWeight: "800", color: palette.text }}>
                  {vehicles.length}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("driver.profile.statVehiclesUnit")}</Text>
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
                <Text style={{ ...typography.body, color: palette.text }}>{t("driver.profile.statClaims")}</Text>
                <Text style={{ fontSize: 34, fontWeight: "800", color: palette.text }}>
                  {claimsCount ?? "—"}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("driver.profile.statClaimsUnit")}</Text>
              </Pressable>
            </View>

            {/* Account Details — email/phone/location as plain label-left,
                value-right rows; NIC/Licence already live in the header. */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.micro, color: palette.textMuted, fontWeight: "700", marginLeft: spacing.xs }}>
                {t("driver.profile.accountHeading")}
              </Text>
              <View
                style={{
                  backgroundColor: palette.surface,
                  borderRadius: radii.lg,
                  overflow: "hidden",
                  boxShadow: "0 2px 10px rgba(15, 15, 15, 0.06)",
                }}
              >
                <AccountRow label={t("driver.profile.fieldEmail")} value={user.email} />
                <AccountRow label={t("driver.profile.fieldPhone")} value={user.phone} onAdd={handleEditToggle} />
                <AccountRow label={t("driver.profile.fieldLocation")} value={user.location} onAdd={handleEditToggle} />
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
              accessibilityLabel={t("driver.profile.logoutA11y")}
              style={({ pressed }) => ({
                alignItems: "center",
                paddingVertical: spacing.md,
                borderRadius: radii.lg,
                backgroundColor: palette.danger,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.profile.logout")}</Text>
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
  const t = useT();
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
          <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{t("driver.profile.addValue")}</Text>
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
