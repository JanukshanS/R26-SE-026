import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@theme/index";
import { tokenStore } from "@lib/tokenStore";
import "react-native-reanimated";

export default function RootLayout() {
  // Warm the token cache from secure storage on launch. Rendering is never
  // gated on this — guests proceed immediately, and a restored session simply
  // fills in once the (driver) provider calls /me. No redirect, no login gate.
  useEffect(() => {
    void tokenStore.hydrate();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
