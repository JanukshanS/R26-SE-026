import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { useAutoTripController } from "@hooks/use-auto-trip-controller";
import { FEATURES } from "@lib/features";

/**
 * Owns the engine monitor for the whole (driver) group. Renders nothing — it
 * lives here rather than in a screen because the monitor must outlive any
 * single screen. VehicleProvider now lives at the root layout (so shared
 * components like BottomNavBar work from (insurance) too), but this still
 * has to sit somewhere inside it, and (driver) is the only place this
 * particular monitor is relevant.
 */
function AutoTripController() {
  useAutoTripController();
  return null;
}

export default function DriverLayout() {
  return (
    <>
      {FEATURES.obd && FEATURES.predictiveMaintenance ? <AutoTripController /> : null}
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
        <Stack.Screen name="profile" options={{ animation: "fade" }} />
        <Stack.Screen name="auth" />
        <Stack.Screen name="manage-vehicles" />

        <Stack.Protected guard={FEATURES.predictiveMaintenance}>
          <Stack.Screen name="health" options={{ animation: "fade" }} />
          <Stack.Screen name="component-detail" />
          <Stack.Screen name="fault-detail" />
          <Stack.Screen name="service-records" />
          <Stack.Screen name="add-service-record" />
          <Stack.Screen name="trip-summary" />
          <Stack.Screen name="auto-schedule" />
        </Stack.Protected>
        <Stack.Protected guard={FEATURES.predictiveMaintenance && FEATURES.obd}>
          <Stack.Screen name="active-trip" />
        </Stack.Protected>
        <Stack.Protected guard={FEATURES.marketplace}>
          <Stack.Screen name="marketplace" />
          <Stack.Screen name="order-parts" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={FEATURES.insurance}>
          <Stack.Screen name="my-claims" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
