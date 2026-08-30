import { Modal, Pressable, Text, View } from "react-native";
import { useState } from "react";

import { Icon } from "@components/ui/icon";
import { LOCALE_LABELS, LOCALES, useI18n, type Locale } from "@lib/i18n";
import { palette, radii, spacing, typography } from "@theme/index";

/**
 * Language switcher, in the two shapes the app needs it.
 *
 *   "pill" — a compact chip for screen headers (Welcome, onboarding), where it
 *            has to be reachable before the driver has an account.
 *   "row"  — a settings line for the profile screens, where it sits with the
 *            other account preferences.
 *
 * Both open the same sheet. Options are labelled in their own script, never
 * translated: someone who only reads Tamil finds "தமிழ்", not "Tamil".
 */
export function LanguagePicker({ variant = "pill" }: { variant?: "pill" | "row" }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  const trigger =
    variant === "pill" ? (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("common.language.change")}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radii.pill,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="Globe" size={14} color={palette.textMuted} />
        <Text style={{ ...typography.caption, color: palette.text, fontWeight: "700" }}>
          {LOCALE_LABELS[locale]}
        </Text>
      </Pressable>
    ) : (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.lg,
          backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Icon name="Globe" size={18} color={palette.textMuted} />
          <Text style={{ ...typography.body, color: palette.text }}>{t("common.language.label")}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Text style={{ ...typography.body, color: palette.brand, fontWeight: "600" }}>
            {LOCALE_LABELS[locale]}
          </Text>
          <Icon name="ChevronRight" size={16} color={palette.textMuted} />
        </View>
      </Pressable>
    );

  return (
    <>
      {trigger}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" }}
        >
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: palette.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              padding: spacing.xl,
              gap: spacing.md,
            }}
          >
            <Text style={{ ...typography.h2, color: palette.text }}>{t("common.language.title")}</Text>
            {LOCALES.map((l) => {
              const active = l === locale;
              return (
                <Pressable
                  key={l}
                  onPress={() => {
                    setLocale(l);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.lg,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: active ? palette.brand : palette.border,
                    backgroundColor: active ? palette.brandSoft : pressed ? palette.surfaceMuted : palette.surface,
                  })}
                >
                  <Text
                    style={{
                      ...typography.body,
                      color: palette.text,
                      fontWeight: active ? "700" : "400",
                    }}
                  >
                    {LOCALE_LABELS[l]}
                  </Text>
                  {active && <Icon name="Check" size={18} color={palette.brand} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
