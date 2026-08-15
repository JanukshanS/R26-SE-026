import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { VehicleProvider } from "@lib/vehicleContext";
import { useAutoTripController } from "@hooks/use-auto-trip-controller";

/**
 * Owns the engine monitor for the whole (driver) group. Renders nothing — it
 * lives here rather than in a screen because the monitor must outlive any
 * single screen, and it needs `useVehicle()`, so it has to sit inside
 * VehicleProvider.
 */
function AutoTripController() {
  useAutoTripController();
  return null;
}

export default function DriverLayout() {
  return (
    <VehicleProvider>
      <AutoTripController />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
    </VehicleProvider>
  );
}
