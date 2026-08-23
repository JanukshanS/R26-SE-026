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
          animation: "slide_from_right",
        }}
      >
        {/*
          The four tab destinations cross-fade instead of sliding. Tabs are
          siblings, so sliding one in from the right reads as "you went a level
          deeper" when you have only moved across. Everything else in this group
          is a genuine push and keeps the slide.
        */}
        <Stack.Screen name="home" options={{ animation: "fade" }} />
        <Stack.Screen name="health" options={{ animation: "fade" }} />
        <Stack.Screen name="order-parts" options={{ animation: "fade" }} />
        <Stack.Screen name="profile" options={{ animation: "fade" }} />
      </Stack>
    </VehicleProvider>
  );
}
