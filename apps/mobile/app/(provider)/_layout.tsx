import { Stack } from "expo-router";
import { palette } from "@theme/index";

// VehicleProvider now lives at the root layout, so every route group shares
// one instance instead of each mounting its own.
export default function ProviderLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
        animation: "slide_from_right",
      }}
    >
      {/* The four tab destinations cross-fade instead of sliding — same
          reasoning as (driver)/_layout.tsx: they're siblings, not a deeper
          push. active-job and onboarding keep the slide. */}
      <Stack.Screen name="available" options={{ animation: "fade" }} />
      <Stack.Screen name="services" options={{ animation: "fade" }} />
      <Stack.Screen name="history" options={{ animation: "fade" }} />
      <Stack.Screen name="profile" options={{ animation: "fade" }} />
    </Stack>
  );
}
