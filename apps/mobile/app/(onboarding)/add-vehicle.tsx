import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, spacing, typography } from "@theme/index";

export default function AddVehicleScreen() {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");

  return (
    <Screen
      footer={
        <Button
          title="Next Step"
          onPress={() => router.push("/(onboarding)/personal-details")}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Add your vehicle</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        We use this data to predict and dispatch the right help.
      </Text>
      <TextField
        label="Your vehicle Brand"
        value={brand}
        onChangeText={setBrand}
        placeholder="e.g. Toyota"
        autoCapitalize="words"
      />
      <TextField
        label="Your vehicle Model"
        value={model}
        onChangeText={setModel}
        placeholder="e.g. Aqua"
        autoCapitalize="words"
      />
      <TextField
        label="Year of manufacture"
        value={year}
        onChangeText={setYear}
        placeholder="2018"
        keyboardType="number-pad"
        maxLength={4}
      />
      <TextField
        label="Vehicle registration number"
        value={registration}
        onChangeText={setRegistration}
        placeholder="ABC-1234"
        autoCapitalize="characters"
      />
    </Screen>
  );
}
