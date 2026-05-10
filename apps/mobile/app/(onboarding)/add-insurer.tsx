import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";

export default function AddInsurerScreen() {
  const [provider, setProvider] = useState("Allianz Insurance Lanka Limited");
  const [policy, setPolicy] = useState("");
  const [licence, setLicence] = useState("");
  const [nic, setNic] = useState("");

  return (
    <Screen
      footer={
        <>
          <Button
            title="Done"
            onPress={() => router.push("/(onboarding)/add-account")}
          />
          <Button
            title="Skip"
            variant="secondary"
            onPress={() => router.push("/(onboarding)/add-account")}
          />
        </>
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Add your Insurer</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        We use this data when you submit an insurance claim in an emergency.
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, ...typography.body, fontWeight: "500" }}>
          Your insurance provider
        </Text>
        <Pressable
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette.border,
            paddingHorizontal: spacing.lg,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
          onPress={() => setProvider("Allianz Insurance Lanka Limited")}
        >
          <Text style={{ color: palette.text, ...typography.body }}>{provider}</Text>
          <Icon name="ChevronDown" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <TextField
        label="Your insurance policy number"
        value={policy}
        onChangeText={setPolicy}
        placeholder="ALCI-254-VP"
        autoCapitalize="characters"
      />
      <TextField
        label="Your Driving Licence Number"
        value={licence}
        onChangeText={setLicence}
        placeholder="B4818153"
        autoCapitalize="characters"
      />
      <TextField
        label="NIC Number"
        value={nic}
        onChangeText={setNic}
        placeholder="200221458936"
        keyboardType="numbers-and-punctuation"
      />

      <Card variant="muted">
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>
          Register Vehicle Photos
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          This step is required for the insurer to compare vehicle images after an accident.
        </Text>
        <Button
          title="Go to Guided Capture"
          variant="secondary"
          size="md"
          onPress={() => {}}
        />
      </Card>
    </Screen>
  );
}
