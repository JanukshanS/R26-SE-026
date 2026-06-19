import { Stack } from 'expo-router';

export default function InsuranceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="upload-accident-details" />
      <Stack.Screen name="guided-capture-intro" />
      <Stack.Screen name="guided-capture-direction" />
      <Stack.Screen name="capture" />
      <Stack.Screen name="driving-licence" />
      <Stack.Screen name="drunk-test" />
      <Stack.Screen name="third-party" />
      <Stack.Screen name="scene-video" />
      <Stack.Screen name="vision-preview" />
    </Stack>
  );
}
