import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, spacing, typography } from "@theme/index";

export default function PersonalDetailsScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <Screen
      footer={
        <>
          <Button
            title="Next Step"
            onPress={() => router.push("/(onboarding)/add-insurer")}
          />
          <Button
            title="Skip"
            variant="secondary"
            onPress={() => router.push("/(onboarding)/add-insurer")}
          />
        </>
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Personal details</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        We use this data to predict and dispatch the right help.
      </Text>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Janukshan Sivakumar"
        autoCapitalize="words"
      />
      <TextField
        label="Email Address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextField
        label="Date of Birth"
        value={dob}
        onChangeText={setDob}
        placeholder="YYYY-MM-DD"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
      />
      <TextField
        label="Re-enter Password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Repeat your password"
        secureTextEntry
      />
    </Screen>
  );
}
