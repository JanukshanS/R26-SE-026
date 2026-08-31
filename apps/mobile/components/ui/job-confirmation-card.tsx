/**
 * The driver's word on a job the provider has just closed.
 *
 * The provider closes their own job, so without this the only record of
 * whether a car was actually fixed comes from the person paid to fix it. "No,
 * still not fixed" is the one signal that marks a dispatch unsuccessful no
 * matter what the provider filed, and it feeds the trust score the ECM divides
 * expected cost by.
 *
 * The stars are secondary and say so: they appear only after the driver has
 * answered the question that matters, and skipping them costs nothing. Most
 * drivers will never rate, which is exactly why a rating nudges trust rather
 * than deciding it (see components/dispatch/src/services/provider-trust.ts).
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import { haptics } from "@lib/haptics";
import { useT } from "@lib/i18n";

export type Stars = 1 | 2 | 3 | 4 | 5;

const ALL_STARS: Stars[] = [1, 2, 3, 4, 5];

export function JobConfirmationCard({
  providerName,
  /** What is already on record. `null` means the driver has not answered. */
  confirmed,
  rating,
  onSubmit,
}: {
  providerName: string;
  confirmed: boolean | null;
  rating: number | null;
  onSubmit: (input: { resolved: boolean; rating?: Stars }) => Promise<void>;
}) {
  const t = useT();
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [stars, setStars] = useState<Stars | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Answered already: show it back and stop asking. The API accepts a
  // correction, but a card that keeps prompting reads as the tap not landing.
  if (confirmed !== null) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon
            name={confirmed ? "CircleCheck" : "CircleAlert"}
            size={18}
            color={confirmed ? palette.success : palette.warning}
          />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            {confirmed
              ? t("emergency.confirm.thanksFixed")
              : t("emergency.confirm.thanksNotFixed")}
          </Text>
        </View>
        {rating !== null && (
          <View style={{ flexDirection: "row", gap: spacing.xs }}>
            {ALL_STARS.map((s) => (
              <Icon
                key={s}
                name="Star"
                size={18}
                color={s <= rating ? palette.warning : palette.border}
                fill={s <= rating ? palette.warning : "transparent"}
              />
            ))}
          </View>
        )}
        {!confirmed && (
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("emergency.confirm.notFixedHint")}
          </Text>
        )}
      </Card>
    );
  }

  async function submit() {
    if (resolved === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ resolved, ...(stars !== null ? { rating: stars } : {}) });
      haptics.success();
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : t("emergency.confirm.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {t("emergency.confirm.title")}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("emergency.confirm.subtitle", { name: providerName })}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <AnswerButton
          label={t("emergency.confirm.yes")}
          icon="CircleCheck"
          tone={palette.success}
          selected={resolved === true}
          disabled={busy}
          onPress={() => { haptics.select(); setResolved(true); }}
        />
        <AnswerButton
          label={t("emergency.confirm.no")}
          icon="CircleAlert"
          tone={palette.warning}
          selected={resolved === false}
          disabled={busy}
          onPress={() => { haptics.select(); setResolved(false); }}
        />
      </View>

      {/* Stars come second and only once the real question is answered, so
          they read as the optional extra they are. */}
      {resolved !== null && (
        <Animated.View entering={FadeIn} style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("emergency.confirm.rateOptional")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {ALL_STARS.map((s) => {
              const on = stars !== null && s <= stars;
              return (
                <Pressable
                  key={s}
                  // A 32px star is under the 44px minimum touch target, and a
                  // mis-tap changes a provider's dispatch score.
                  hitSlop={10}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("emergency.confirm.starA11y", { count: s })}
                  onPress={() => { haptics.select(); setStars(s); }}
                >
                  <Icon
                    name="Star"
                    size={32}
                    color={on ? palette.warning : palette.borderStrong}
                    fill={on ? palette.warning : "transparent"}
                  />
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      )}

      {error && <Text style={{ ...typography.caption, color: palette.danger }}>{error}</Text>}

      <Button
        title={busy ? t("emergency.confirm.submitting") : t("emergency.confirm.submit")}
        disabled={resolved === null || busy}
        onPress={submit}
      />
    </Card>
  );
}

function AnswerButton({
  label,
  icon,
  tone,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  icon: "CircleCheck" | "CircleAlert";
  tone: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.xs,
        paddingVertical: spacing.md,
        borderRadius: radii.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tone : palette.border,
        backgroundColor: selected ? `${tone}1A` : palette.surface,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} size={18} color={selected ? tone : palette.textMuted} />
      <Text
        style={{
          ...typography.body,
          fontWeight: selected ? "700" : "500",
          color: selected ? palette.text : palette.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
