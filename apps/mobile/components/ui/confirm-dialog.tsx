/**
 * A confirmation the app renders itself, rather than handing to the OS.
 *
 * `Alert.alert` is the obvious way to ask "are you sure?", and it is the wrong
 * one here: it draws the platform's own dialog, so it arrives in the system
 * font with system button styling and no relationship to the screen behind it.
 * On a screen a stranded driver is staring at, that reads as the app having
 * been interrupted by something else.
 *
 * It also cannot be translated the way the rest of the app is — the button
 * labels are ours but the chrome is the OS's, and on Android the destructive
 * style is ignored entirely, so "Cancel request" and "Keep waiting" render
 * identically. Here the destructive action is unmistakably the red one.
 */
import { Modal, Pressable, Text, View } from "react-native";
import { Button } from "@components/ui/button";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  icon = "TriangleAlert",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  icon?: IconName;
  /** Paints the confirm button red and the icon to match. */
  destructive?: boolean;
  /** Keeps the dialog open and both buttons inert while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const accent = destructive ? palette.danger : palette.brand;
  const accentSoft = destructive ? palette.dangerSoft : palette.brandSoft;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's back button must not dismiss this mid-action, or the caller
      // is left believing the driver declined something already in flight.
      onRequestClose={busy ? () => {} : onCancel}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: palette.overlay,
          justifyContent: "center",
          padding: spacing.lg,
        }}
        // Tapping the scrim is the same as declining — but not while the
        // action is running, for the same reason as above.
        onPress={busy ? undefined : onCancel}
      >
        {/* Swallows taps so pressing the card itself never dismisses it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.xl,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.pill,
                backgroundColor: accentSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={icon} size={20} color={accent} />
            </View>
            <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>{title}</Text>
          </View>

          <Text style={{ ...typography.body, color: palette.textMuted }}>{message}</Text>

          <View style={{ gap: spacing.sm }}>
            <Button
              title={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              disabled={busy}
              onPress={onConfirm}
            />
            <Button
              title={cancelLabel}
              variant="secondary"
              disabled={busy}
              onPress={onCancel}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
