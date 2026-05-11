import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, vehicles, updateProfile, logout, authLoading } = useVehicle();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [location, setLocation] = useState(user?.location ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
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
          <Text style={{ ...typography.h3, color: palette.text }}>Profile</Text>
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
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim(), location: location.trim() });
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
    if (editing) {
      // cancel — reset fields
      setName(user.name);
      setPhone(user.phone ?? "");
      setLocation(user.location ?? "");
      setError("");
    }
    setEditing(!editing);
  }

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
        <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>Profile</Text>
        <Pressable
          onPress={handleEditToggle}
          style={({ pressed }) => ({
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radii.md,
            backgroundColor: pressed ? palette.homeBackground : "transparent",
          })}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
            {editing ? "Cancel" : "Edit"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar + name */}
        <View style={{ alignItems: "center", paddingVertical: spacing.lg, gap: spacing.md }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: palette.brand,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 28, fontWeight: "700", color: palette.textOnBrand }}>
              {initials}
            </Text>
          </View>
          {!editing && (
            <>
              <Text style={{ ...typography.h2, color: palette.text }}>{user.name}</Text>
              <Text style={{ ...typography.body, color: palette.textMuted }}>{user.email}</Text>
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

        {/* Info / edit card */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {editing ? "Edit Profile" : "Account Details"}
          </Text>

          {editing ? (
            <View style={{ gap: spacing.md }}>
              <Field label="Full Name *" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
              <Field label="Email" value={user.email} editable={false} placeholder="" />
              <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+94 77 123 4567" keyboardType="phone-pad" />
              <Field label="Location" value={location} onChangeText={setLocation} placeholder="Malabe, Sri Lanka" autoCapitalize="words" />

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
          ) : (
            <View style={{ gap: spacing.sm }}>
              <InfoRow icon="Mail" label="Email" value={user.email} />
              <InfoRow icon="Phone" label="Phone" value={user.phone ?? "—"} />
              <InfoRow icon="MapPin" label="Location" value={user.location ?? "—"} />
            </View>
          )}
        </View>

        {/* Vehicles summary */}
        <Pressable
          onPress={() => router.push("/(driver)/manage-vehicles")}
          style={({ pressed }) => ({
            backgroundColor: pressed ? palette.homeBackground : palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
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
            <Icon name="Car" size={22} color={palette.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>My Vehicles</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {vehicles.length === 0
                ? "No vehicles added"
                : `${vehicles.length} vehicle${vehicles.length > 1 ? "s" : ""} registered`}
            </Text>
          </View>
          <Icon name="ChevronRight" size={18} color={palette.textMuted} />
        </Pressable>

        {/* App info */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <MenuRow icon="Shield" label="Privacy Policy" onPress={() => {}} />
          <MenuRow icon="HelpCircle" label="Help & Support" onPress={() => {}} divider={false} />
        </View>
      </ScrollView>

      {/* Logout */}
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
          onPress={() => { logout(); router.back(); }}
          style={({ pressed }) => ({
            borderRadius: radii.lg,
            paddingVertical: spacing.md,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: spacing.sm,
            borderWidth: 1.5,
            borderColor: palette.danger,
            backgroundColor: pressed ? palette.dangerSoft : "transparent",
          })}
        >
          <Icon name="LogOut" size={18} color={palette.danger} />
          <Text style={{ ...typography.bodyStrong, color: palette.danger }}>Log Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs }}>
      <Icon name={icon as any} size={16} color={palette.textMuted} />
      <Text style={{ ...typography.caption, color: palette.textMuted, width: 64 }}>{label}</Text>
      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>{value}</Text>
    </View>
  );
}

function MenuRow({ icon, label, onPress, divider = true }: { icon: string; label: string; onPress: () => void; divider?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.lg,
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: palette.border,
      })}
    >
      <Icon name={icon as any} size={18} color={palette.textMuted} />
      <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>{label}</Text>
      <Icon name="ChevronRight" size={16} color={palette.textMuted} />
    </Pressable>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, editable = true,
}: {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad";
  autoCapitalize?: "none" | "words" | "sentences";
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
