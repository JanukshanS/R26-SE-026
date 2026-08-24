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
    />
  );
}
