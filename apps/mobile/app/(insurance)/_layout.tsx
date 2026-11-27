import { Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { ensureLocationOn, exitToHome, isLocationOn } from '@/lib/require-location';

export default function InsuranceLayout() {
  const pathname = usePathname();

  // Every insurance step requires location: checked (with the system dialog)
  // each time a step opens, and re-checked without a dialog whenever the app
  // returns to the foreground, in case it was switched off mid-step.
  useEffect(() => {
    void ensureLocationOn().then((status) => {
      if (status !== 'ok') exitToHome(status);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void isLocationOn().then((status) => {
        if (status !== 'ok') exitToHome(status);
      });
    });
    return () => sub.remove();
  }, [pathname]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="upload-accident-details" />
      <Stack.Screen name="guided-capture-intro" />
      <Stack.Screen name="capture" />
      <Stack.Screen name="driving-licence" />
      <Stack.Screen name="drunk-test" />
      <Stack.Screen name="third-party" />
    </Stack>
  );
}
