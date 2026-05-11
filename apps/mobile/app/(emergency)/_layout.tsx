import { Stack } from "expo-router";
import { palette } from "@theme/index";
import { EmergencyProvider } from "@lib/emergencyContext";

export default function EmergencyLayout() {
  return (
    <EmergencyProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
          animation: "slide_from_right",
        }}
      />
    </EmergencyProvider>
  );
}
