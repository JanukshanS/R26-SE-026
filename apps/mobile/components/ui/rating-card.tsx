/**
 * The driver's star rating for a finished job.
 *
 * This is not decoration. The ECM divides a provider's expected cost by their
 * trust score, and trust is the share of their jobs that both matched the
 * diagnosis AND were not rated below four stars — so these five taps are the
 * only direct say a driver has in who gets dispatched next time. That is why
 * it is shown on the tracking screen the moment the job closes, rather than
 * buried in a history list nobody opens.
 *
 * Rating is optional by design. An unrated job counts as satisfactory (see
 * services/provider-trust.ts): most drivers will never rate, and treating
 * silence as dissatisfaction would drag every provider to the floor.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { palette, spacing, typography } from "@theme/index";
import { haptics } from "@lib/haptics";
import { useT } from "@lib/i18n";

export type Stars = 1 | 2 | 3 | 4 | 5;

const ALL_STARS: Stars[] = [1, 2, 3, 4, 5];

export function RatingCard({
  providerName,
  submitted,
  onSubmit,
}: {
  providerName: string;
  /** A rating already on record — the card becomes a read-only thank-you. */
  submitted: number | null;
  onSubmit: (rating: Stars) => Promise<void>;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Stars | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already rated: show what they said and stop asking. Re-rating is allowed
  // by the API, but a card that keeps prompting after it has been answered
  // reads as the tap not having registered.
  if (submitted !== null) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="CircleCheck" size={18} color={palette.success} />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            {t("emergency.rating.thanksTitle")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {ALL_STARS.map((s) => (
            <Icon
              key={s}
              name="Star"
              size={20}
              color={s <= submitted ? palette.warning : palette.border}
              fill={s <= submitted ? palette.warning : "transparent"}
            />
          ))}
        </View>
      </Card>
    );
  }

  async function submit() {
    if (picked === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(picked);
      haptics.success();
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : t("emergency.rating.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {t("emergency.rating.title")}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("emergency.rating.subtitle", { name: providerName })}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {ALL_STARS.map((s) => {
          const on = picked !== null && s <= picked;
          return (
            <Pressable
              key={s}
              // A 32px star is under the 44px minimum touch target, and a
              // mis-tap here silently changes a provider's dispatch score.
              hitSlop={10}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t("emergency.rating.starA11y", { count: s })}
              onPress={() => {
                haptics.select();
                setPicked(s);
              }}
            >
              <Icon
                name="Star"
                size={34}
                color={on ? palette.warning : palette.borderStrong}
                fill={on ? palette.warning : "transparent"}
              />
            </Pressable>
          );
        })}
      </View>

      {error && (
        <Text style={{ ...typography.caption, color: palette.danger }}>{error}</Text>
      )}

      <Button
        title={busy ? t("emergency.rating.submitting") : t("emergency.rating.submit")}
        disabled={picked === null || busy}
        onPress={submit}
      />
      {busy && <ActivityIndicator size="small" color={palette.brand} />}
    </Card>
  );
}
