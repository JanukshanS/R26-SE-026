import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { FEATURES } from "@lib/features";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="add-account" />
      <Stack.Screen name="add-vehicle" />
      <Stack.Protected guard={FEATURES.insurance}>
        <Stack.Screen name="add-insurer" />
      </Stack.Protected>
    </Stack>
  );
}
