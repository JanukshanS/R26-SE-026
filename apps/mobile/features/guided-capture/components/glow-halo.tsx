import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

// Floor of the opacity pulse — kept fairly high (not near 0) so the glow never fades
// down to near-invisible between pulses, which read as barely-there at a lower floor.
const GLOW_PULSE_FLOOR = 0.55;

type GlowHaloProps = {
  active: boolean;
  /** Base color the halo pulses in — alpha is appended, so pass a plain hex color. */
  color: string;
  /** How far outside the wrapped element's own edges the halo extends. */
  inset?: number;
  /** The wrapped element's own corner radius + `inset`, so the halo's curve stays
   * concentric with it — pass size/2 + inset for a circular element. */
  borderRadius: number;
};

/** Self-contained "primary action" glow: one plain View hugging the caller's content,
 * just outside its border — not native shadow props, since shadowOpacity/shadowRadius
 * are iOS-only in RN and Android's elevation only ever renders a plain gray shadow,
 * never a colored one. Manages its own pulse animation from `active` so any caller can
 * drop it in without wiring up shared-value/effect boilerplate itself. */
export function GlowHalo({ active, color, inset = 4, borderRadius }: GlowHaloProps) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withSequence(withTiming(1, { duration: 700 }), withTiming(GLOW_PULSE_FLOOR, { duration: 700 })),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [active, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!active) {
    return null;
  }
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -inset,
          left: -inset,
          right: -inset,
          bottom: -inset,
          borderRadius,
          // Same color as the glowing border/element itself, just with alpha appended,
          // so the halo can never drift from what it's meant to match.
          backgroundColor: `${color}B3`,
        },
        pulseStyle,
      ]}
    />
  );
}
