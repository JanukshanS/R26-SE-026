import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "expo-router";

/**
 * Intercept the Android hardware back button while a screen is focused.
 * `handler` returns true to swallow the press (block the default pop).
 *
 * Used to make a screen terminal: home blocks back entirely (you leave only by
 * logging out), and the post-diagnosis screens redirect home instead of
 * re-entering the questionnaire — which would re-submit triage for the same
 * incident. Android only; iOS has no hardware back.
 */
export function useHardwareBack(handler: () => boolean) {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", handler);
      return () => sub.remove();
    }, [handler])
  );
}
