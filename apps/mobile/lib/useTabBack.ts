import { useCallback } from "react";
import { router } from "expo-router";
import { useHardwareBack } from "@lib/useHardwareBack";

/**
 * Back behaviour for the screens that double as tab destinations
 * (health, order-parts, profile).
 *
 * The tab bar switches with `router.replace`, so when one of these is showing
 * as a tab root there is nothing on the stack behind it. That made two things
 * broken in the same way: the header chevron called `router.back()` and
 * silently did nothing, and the Android hardware back button found nothing to
 * pop and closed the app.
 *
 * The same screens are also ordinary push targets - home's Service action
 * pushes `/health`, and the insurance screen pushes `/order-parts` and
 * `/profile` - so the chevron can't simply be deleted. Hence `canGoBack`:
 * show the chevron only when there is a real screen to go back to, and
 * otherwise fall back to the home tab, which is what a tab bar implies and
 * what the platform's own apps do.
 */
export function useTabBack(): { canGoBack: boolean; goBack: () => void } {
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(driver)/home");
  }, []);

  // Swallow the press either way: unhandled, Android would exit the app.
  useHardwareBack(
    useCallback(() => {
      goBack();
      return true;
    }, [goBack])
  );

  return { canGoBack: router.canGoBack(), goBack };
}
