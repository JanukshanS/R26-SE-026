import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, typography } from "@theme/index";

type Choice = "major" | "minor" | "none" | null;

export default function SafetyCheckScreen() {
  const [choice, setChoice] = useState<Choice>(null);

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          disabled={!choice}
          onPress={() => router.push("/(emergency)/diagnosis-sound")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Safety Check</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Is there visible damage to your vehicle?
      </Text>

      <OptionCard
        badge="Yes"
        badgeTone="danger"
        title="Major (Accident/Crash)"
        selected={choice === "major"}
        onPress={() => setChoice("major")}
      />
      <OptionCard
        badge="Yes"
        badgeTone="warning"
        title="Minor (Dent/Scratch)"
        selected={choice === "minor"}
        onPress={() => setChoice("minor")}
      />
      <OptionCard
        badge="No"
        badgeTone="success"
        title="No Visible Damage"
        selected={choice === "none"}
        onPress={() => setChoice("none")}
      />
    </Screen>
  );
}
