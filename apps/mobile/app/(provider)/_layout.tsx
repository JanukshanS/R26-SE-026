import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { VehicleProvider } from "@lib/vehicleContext";

export default function ProviderLayout() {
  return (
    <VehicleProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
          animation: "slide_from_right",
        }}
      />
    </VehicleProvider>
  );
}
