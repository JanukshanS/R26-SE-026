import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "@theme/index";
import "@lib/supabase";
import "react-native-reanimated";

export default function RootLayout() {
  // Supabase restores any persisted session on its own (imported above), so
  // there's nothing to warm here — guests proceed immediately, and a restored
  // session fills in via onAuthStateChange inside the (driver) provider.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
            // Declared once here rather than per group: only (emergency) and
            // (onboarding) used to set this, so the same push felt different
            // depending on which part of the app you were in.
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(driver)" />
          <Stack.Screen name="(emergency)" />
          <Stack.Screen name="(provider)" />
          <Stack.Screen name="(insurance)" />
        </Stack>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
