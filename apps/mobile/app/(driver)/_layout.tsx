import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { VehicleProvider } from "@lib/vehicleContext";

export default function DriverLayout() {
  return (
    <VehicleProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
    </VehicleProvider>
  );
}
