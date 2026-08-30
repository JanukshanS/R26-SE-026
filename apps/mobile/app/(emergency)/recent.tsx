import { Pressable, Text, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { QuestionScreen } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, type RecentSign } from "@lib/emergencyContext";
import { useT } from "@lib/i18n";

const OPTIONS: { value: RecentSign; titleKey: string; subtitleKey: string }[] = [
  { value: "HARD_START",         titleKey: "emergency.recent.hardStartTitle",   subtitleKey: "emergency.recent.hardStartSubtitle" },
  { value: "LIGHTS_FLICKER",     titleKey: "emergency.recent.flickerTitle",     subtitleKey: "emergency.recent.flickerSubtitle" },
  { value: "LOSS_OF_POWER",      titleKey: "emergency.recent.lossOfPowerTitle", subtitleKey: "emergency.recent.lossOfPowerSubtitle" },
  { value: "OVERHEATING_BEFORE", titleKey: "emergency.recent.overheatTitle",    subtitleKey: "emergency.recent.overheatSubtitle" },
  { value: "UNUSUAL_NOISE",      titleKey: "emergency.recent.noiseTitle",       subtitleKey: "emergency.recent.noiseSubtitle" },
  { value: "SMELL_BEFORE",       titleKey: "emergency.recent.smellTitle",       subtitleKey: "emergency.recent.smellSubtitle" },
  { value: "NO_SIGNS",           titleKey: "emergency.recent.noSignsTitle",     subtitleKey: "emergency.recent.noSignsSubtitle" },
];

export default function RecentScreen() {
  const t = useT();
  const { recentSigns, toggleRecentSign } = useEmergency();

  return (
    <QuestionScreen
      route="recent"
      prompt={t("emergency.recent.prompt")}
      hint={t("emergency.recent.hint")}
      canNext={recentSigns.size > 0}
    >

      {OPTIONS.map((o) => {
        const active = recentSigns.has(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => toggleRecentSign(o.value)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              backgroundColor: active ? palette.brandSoft : palette.surface,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: active ? 2 : 1,
              borderColor: active ? palette.brand : palette.border,
              padding: spacing.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
            })}
          >
            <View
              style={{
                width: 24, height: 24, borderRadius: 6,
                borderWidth: 2,
                borderColor: active ? palette.brand : palette.border,
                backgroundColor: active ? palette.brand : "transparent",
                alignItems: "center", justifyContent: "center",
              }}
            >
              {active && <Icon name="Check" size={14} color={palette.textOnBrand} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>{t(o.titleKey)}</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>{t(o.subtitleKey)}</Text>
            </View>
          </Pressable>
        );
      })}
    </QuestionScreen>
  );
}
