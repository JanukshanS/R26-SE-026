/**
 * "What's wrong?" - the single entry point to getting help.
 *
 * Replaces the old safety-check -> intent pair, which asked about damage and
 * then offered three cohorts (Engine / Brake / Gear). Two problems with that:
 *
 *   1. Q1_intent was never asked. It was inferred from cohort + damage, so a
 *      dent on a car with a healthy engine submitted as ENGINE_PROBLEM, and
 *      WEIRD_BEHAVIOR - a class the tree is trained on - could never be sent.
 *
 *   2. Dispatch defines ten fast-path intents that skip ML entirely
 *      (Q1_FAST_INTENTS, short-circuited in triage-engine.ts). The app reached
 *      four of them. Lost keys, wrong fuel, blown fuse, dead bulb, flood
 *      recovery and fuel-leak/fire were working backend capabilities with no
 *      way to ask for them.
 *
 * Fast intents dispatch straight away. The five ML intents still enter the full
 * adaptive questionnaire - this screen takes no traffic away from the model,
 * because the backend was never going to run ML on a fast intent anyway.
 */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { haptics } from "@lib/haptics";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { nextRoute, stepPath, type Q1MLIntent } from "@lib/emergencyFlow";

type Tile = {
  label: string;
  icon: IconName;
  /** Fast-path intent submitted straight to dispatch. */
  fast?: string;
  /** ML intent that enters the questionnaire. */
  ml?: Q1MLIntent;
  /** Routes via safety-check so the 1990 ambulance line comes first. */
  crash?: boolean;
  /** Red treatment - a life-safety problem, not just a stranded car. */
  urgent?: boolean;
};

/**
 * Fast path. Every one of these maps to a service type in
 * FAST_PATH_INTENT_TO_SERVICE and bypasses the ML tree in the backend.
 * Ordered by how often we expect them, with the two life-safety tiles last so
 * they sit together under their own red treatment.
 */
const FAST: Tile[] = [
  { label: "Flat tyre",    icon: "Disc",          fast: "FLAT_TIRE" },
  { label: "Out of fuel",  icon: "Fuel",          fast: "FUEL_EMPTY" },
  { label: "Locked out",   icon: "LockKeyhole",   fast: "LOCKOUT" },
  { label: "Lost my key",  icon: "KeyRound",      fast: "KEY_LOST" },
  { label: "Wrong fuel",   icon: "Droplets",      fast: "FUEL_WRONG" },
  { label: "Blown fuse",   icon: "Zap",           fast: "BLOWN_FUSE" },
  { label: "Light bulb",   icon: "Lightbulb",     fast: "LIGHT_BULB" },
  { label: "Stuck in flood", icon: "Waves",       fast: "STUCK_FLOOD" },
  { label: "Accident",     icon: "TriangleAlert", crash: true, urgent: true },
  { label: "Fuel leak / fire", icon: "Flame",     fast: "FUEL_LEAK_FIRE_RISK", urgent: true },
];

/** These five enter the adaptive questionnaire. */
const DIAGNOSE: Tile[] = [
  { label: "Won't start",     icon: "CircleOff",   ml: "WONT_START" },
  { label: "Engine trouble",  icon: "Cog",         ml: "ENGINE_PROBLEM" },
  { label: "Brakes",          icon: "CircleStop",  ml: "BRAKE_ISSUE" },
  { label: "Gears / clutch",  icon: "Settings2",   ml: "GEAR_ISSUE" },
  { label: "Not sure",        icon: "CircleHelp",  ml: "WEIRD_BEHAVIOR" },
];

export default function WhatsWrongScreen() {
  const { setQ1Intent } = useEmergency();

  function choose(tile: Tile) {
    haptics.select();

    if (tile.crash) {
      // A crash is the one intent where an extra screen is worth it: safety-check
      // carries the 1990 ambulance line, and someone injured needs that before
      // they need a tow.
      router.push("/(emergency)/safety-check");
      return;
    }

    if (tile.fast) {
      router.push({
        pathname: "/(emergency)/quick-dispatch",
        params: { intent: tile.fast, label: tile.label },
      });
      return;
    }

    if (tile.ml) {
      setQ1Intent(tile.ml);
      // Computed from the value we just picked rather than from context, which
      // hasn't re-rendered yet.
      const next = nextRoute(
        { q1Intent: tile.ml, engineState: null, runningIssue: null },
        "whats-wrong"
      );
      if (next) router.push(stepPath(next));
    }
  }

  return (
    <Screen>
      <HeaderBar />

      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...typography.display, color: palette.text }}>What&apos;s wrong?</Text>
        <Text style={{ ...typography.body, color: palette.textMuted }}>
          Pick the closest one. We&apos;ll sort out the details after help is on its way.
        </Text>
      </View>

      <TileGrid tiles={FAST} onPick={choose} delayFrom={0} />

      <View style={{ gap: spacing.md }}>
        <Text style={{ ...typography.h3, color: palette.text }}>Not sure what it is?</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          A few quick questions and we&apos;ll work out what you need. You can skip
          them at any point and we&apos;ll send help with what we have.
        </Text>
        <TileGrid tiles={DIAGNOSE} onPick={choose} delayFrom={FAST.length} />
      </View>
    </Screen>
  );
}

function TileGrid({
  tiles, onPick, delayFrom,
}: {
  tiles: Tile[];
  onPick: (t: Tile) => void;
  delayFrom: number;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
      {tiles.map((tile, i) => (
        <Animated.View
          key={tile.label}
          entering={FadeInDown.delay((delayFrom + i) * 40).springify()}
          // Three per row, with the gap accounted for.
          style={{ flexBasis: "30%", flexGrow: 1 }}
        >
          <ProblemTile tile={tile} onPress={() => onPick(tile)} />
        </Animated.View>
      ))}
    </View>
  );
}

function ProblemTile({ tile, onPress }: { tile: Tile; onPress: () => void }) {
  const fg = tile.urgent ? palette.danger : palette.brand;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tile.label}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        // Comfortably past the 44pt minimum - this gets tapped in the rain.
        minHeight: 96,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.lg,
        borderCurve: "continuous",
        backgroundColor: tile.urgent ? palette.dangerSoft : palette.surface,
        borderWidth: 1,
        borderColor: tile.urgent ? palette.danger : palette.border,
      })}
    >
      <Icon name={tile.icon} size={26} color={fg} />
      <Text
        style={{
          ...typography.caption,
          fontWeight: "600",
          color: palette.text,
          textAlign: "center",
        }}
        numberOfLines={2}
      >
        {tile.label}
      </Text>
    </Pressable>
  );
}
