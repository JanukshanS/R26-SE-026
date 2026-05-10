import { Stack } from "expo-router";
import { palette } from "@theme/index";

export default function EmergencyLayout() {
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
