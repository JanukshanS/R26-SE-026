import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { palette } from "@theme/index";
import "react-native-reanimated";

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(driver)" />
        <Stack.Screen name="(emergency)" />
        <Stack.Screen name="(provider)" />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
